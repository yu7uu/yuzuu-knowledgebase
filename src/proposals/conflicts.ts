import type { ProposalRepository } from './types.ts';
import type { ProposalRequest, SupersedeRequest, UpdateRequest } from './schemas.ts';
import type { Conflict, ConflictCode } from './types.ts';
import { conflict } from './types.ts';
import {
  buildNewItem,
  computeUpdateChanges,
  isEffectiveUpdate,
  mergeUpdateMetadata,
  relationshipKey,
  supersedeTargetMetadata,
} from './diff.ts';
import { sanitize } from './validate.ts';

const SEALED_STATUSES = new Set(['superseded', 'rejected', 'archived']);
const SUPERSEDES = 'SUPERSEDES';

const CONFLICT_PRIORITY: Readonly<Record<ConflictCode, number>> = {
  target_not_found: 0,
  stale_snapshot: 1,
  metadata_conflict: 2,
  id_already_exists: 3,
  superseding_item_not_found: 4,
  superseding_item_not_linked: 5,
  relationship_conflict: 6,
  invalid_resulting_state: 7,
  no_effective_change: 8,
};

interface ConflictCandidate {
  code: ConflictCode;
  message: string;
}

function compareConflicts(a: ConflictCandidate, b: ConflictCandidate): number {
  const priorityDiff =
    (CONFLICT_PRIORITY[a.code] ?? Number.MAX_SAFE_INTEGER) -
    (CONFLICT_PRIORITY[b.code] ?? Number.MAX_SAFE_INTEGER);
  return priorityDiff !== 0 ? priorityDiff : a.message.localeCompare(b.message);
}

async function createConflicts(
  request: ProposalRequest & { operation: 'create' },
  repository: ProposalRepository,
  now: string,
): Promise<Conflict[]> {
  const candidates: ConflictCandidate[] = [];

  const existing = await repository.getById(request.item.id);
  if (existing !== undefined) {
    candidates.push({
      code: 'id_already_exists',
      message: sanitize(`knowledge item "${request.item.id}" already exists in the repository`),
    });
  }

  const built = buildNewItem(request.item, now);
  if (!built.ok) {
    candidates.push({
      code: 'invalid_resulting_state',
      message: sanitize(`proposed item ${request.item.id} is not valid canonical metadata`),
    });
  }

  return candidates.sort(compareConflicts).map((c) => conflict(c.code, c.message));
}

async function relationshipConflicts(
  currentRelationships: { type: string; target: string }[],
  patchRelationships: UpdateRequest['patch']['relationships'],
): Promise<Conflict[]> {
  if (patchRelationships === undefined) {
    return [];
  }
  const candidates: ConflictCandidate[] = [];
  const existing = new Set(
    currentRelationships.map((rel) => relationshipKey(rel.type, rel.target)),
  );

  for (const entry of patchRelationships.add ?? []) {
    if (existing.has(relationshipKey(entry.type, entry.target))) {
      candidates.push({
        code: 'relationship_conflict',
        message: sanitize(
          `relationship ${entry.type} -> ${entry.target} already exists on the target item`,
        ),
      });
    }
  }
  for (const entry of patchRelationships.remove ?? []) {
    if (!existing.has(relationshipKey(entry.type, entry.target))) {
      candidates.push({
        code: 'relationship_conflict',
        message: sanitize(
          `relationship ${entry.type} -> ${entry.target} does not exist on the target item`,
        ),
      });
    }
  }
  return candidates.sort(compareConflicts).map((c) => conflict(c.code, c.message));
}

async function updateConflicts(
  request: UpdateRequest,
  repository: ProposalRepository,
  now: string,
): Promise<Conflict[]> {
  const candidates: ConflictCandidate[] = [];

  const currentItem = await repository.getById(request.targetId);
  if (currentItem === undefined) {
    return [
      conflict(
        'target_not_found',
        sanitize(`knowledge item "${request.targetId}" not found in the repository`),
      ),
    ];
  }

  const currentMetadata = currentItem.metadata;

  if (request.snapshot !== undefined && request.snapshot.updatedAt !== currentMetadata.updated_at) {
    candidates.push({
      code: 'stale_snapshot',
      message: sanitize(
        `knowledge item "${request.targetId}" has changed since the snapshot: expected updated_at ${request.snapshot.updatedAt}, found ${currentMetadata.updated_at}`,
      ),
    });
  }

  if (SEALED_STATUSES.has(currentMetadata.status)) {
    candidates.push({
      code: 'metadata_conflict',
      message: sanitize(
        `knowledge item "${request.targetId}" is ${currentMetadata.status} and cannot be updated`,
      ),
    });
  }

  const merged = mergeUpdateMetadata(currentMetadata, request.patch, now);
  if (!merged.ok) {
    candidates.push({
      code: 'invalid_resulting_state',
      message: sanitize(`the updated metadata for "${request.targetId}" is not valid canonical metadata`),
    });
  }

  const changes = computeUpdateChanges(currentItem, request.patch);
  if (!isEffectiveUpdate(changes)) {
    candidates.push({
      code: 'no_effective_change',
      message: sanitize(`the update for "${request.targetId}" produces no effective change`),
    });
  }

  const relationshipCandidates = await relationshipConflicts(
    currentMetadata.relationships ?? [],
    request.patch.relationships,
  );

  let all = [...candidates, ...relationshipCandidates];
  if (all.some((candidate) => candidate.code !== 'no_effective_change')) {
    all = all.filter((candidate) => candidate.code !== 'no_effective_change');
  }
  all.sort(compareConflicts);
  return all.map((c) => conflict(c.code, c.message));
}

async function supersedeConflicts(
  request: SupersedeRequest,
  repository: ProposalRepository,
  now: string,
): Promise<Conflict[]> {
  const candidates: ConflictCandidate[] = [];

  const target = await repository.getById(request.targetId);
  if (target === undefined) {
    return [
      conflict(
        'target_not_found',
        sanitize(`knowledge item "${request.targetId}" not found in the repository`),
      ),
    ];
  }

  const targetMetadata = target.metadata;

  if (request.snapshot !== undefined && request.snapshot.updatedAt !== targetMetadata.updated_at) {
    candidates.push({
      code: 'stale_snapshot',
      message: sanitize(
        `knowledge item "${request.targetId}" has changed since the snapshot: expected updated_at ${request.snapshot.updatedAt}, found ${targetMetadata.updated_at}`,
      ),
    });
  }

  if (targetMetadata.status === 'superseded') {
    candidates.push({
      code: 'metadata_conflict',
      message: sanitize(`knowledge item "${request.targetId}" is already superseded`),
    });
  }

  if (request.supersedingId !== undefined) {
    const superseder = await repository.getById(request.supersedingId);
    if (superseder === undefined) {
      candidates.push({
        code: 'superseding_item_not_found',
        message: sanitize(`superseding item "${request.supersedingId}" not found in the repository`),
      });
    } else {
      const links = (superseder.metadata.relationships ?? []).filter(
        (rel) => rel.type === SUPERSEDES && rel.target === request.targetId,
      );
      if (links.length === 0) {
        candidates.push({
          code: 'superseding_item_not_linked',
          message: sanitize(
            `superseding item "${request.supersedingId}" does not declare ${SUPERSEDES} -> ${request.targetId}`,
          ),
        });
      }
    }
  }

  if (request.replacement !== undefined) {
    const existing = await repository.getById(request.replacement.id);
    if (existing !== undefined) {
      candidates.push({
        code: 'id_already_exists',
        message: sanitize(`replacement item "${request.replacement.id}" already exists in the repository`),
      });
    }
    const built = buildNewItem(request.replacement, now);
    if (!built.ok) {
      candidates.push({
        code: 'invalid_resulting_state',
        message: sanitize(`replacement item ${request.replacement.id} is not valid canonical metadata`),
      });
    }
  }

  const superseded = supersedeTargetMetadata(targetMetadata, now);
  if (!superseded.ok) {
    candidates.push({
      code: 'invalid_resulting_state',
      message: sanitize(`knowledge item "${request.targetId}" cannot be marked as superseded`),
    });
  }

  const all = candidates.sort(compareConflicts);
  return all.map((c) => conflict(c.code, c.message));
}

/**
 * Deterministic conflict detection between a proposal request and the current
 * repository state. No LLM, no Neo4j, no writes. Produces a fixed-ordering list
 * of `Conflict` issues; an empty list means the request is conflict-clean.
 */
export async function detectConflicts(
  request: ProposalRequest,
  repository: ProposalRepository,
  now?: string,
): Promise<Conflict[]> {
  const timestamp = now ?? new Date().toISOString();
  if (request.operation === 'create') {
    return createConflicts(request, repository, timestamp);
  }
  if (request.operation === 'update') {
    return updateConflicts(request, repository, timestamp);
  }
  return supersedeConflicts(request, repository, timestamp);
}