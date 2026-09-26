import type { CreateRequest, ProposalRequest, SupersedeRequest, UpdateRequest } from './schemas.ts';
import type {
  Conflict,
  Proposal,
  ProposalAssessment,
  ProposalOperationResult,
  ProposalRepository,
  ProposalRepositoryItem,
  ResolvedDiff,
} from './types.ts';
import { conflict } from './types.ts';
import { proposalIdFor } from './id.ts';
import { sanitize, validateProposal } from './validate.ts';
import { detectConflicts } from './conflicts.ts';
import {
  buildNewItem,
  computeUpdateChanges,
  mergeUpdateMetadata,
  supersedeTargetMetadata,
} from './diff.ts';
import { summarizeProposal } from './summary.ts';

export interface AssessmentOptions {
  /** Overridable clock for deterministic stamps; defaults to a fresh ISO timestamp. */
  now?: string;
}

function timestampFor(options: AssessmentOptions): string {
  const proposed = options.now ?? new Date().toISOString();
  return typeof proposed === 'string' && proposed.length > 0 ? proposed : new Date().toISOString();
}

function normalizeRelationshipMutations(
  mutations: UpdateRequest['patch']['relationships'],
):
  | { add?: { type: string; target: string }[]; remove?: { type: string; target: string }[] }
  | undefined {
  if (mutations === undefined) {
    return undefined;
  }
  const add = mutations.add?.length ? mutations.add : undefined;
  const remove = mutations.remove?.length ? mutations.remove : undefined;
  return add === undefined && remove === undefined ? undefined : { add, remove };
}

function createSeed(request: CreateRequest): unknown {
  return {
    operation: 'create',
    provenance: request.provenance ?? {},
    item: {
      id: request.item.id,
      type: request.item.type,
      title: request.item.title,
      status: request.item.status,
      source: request.item.source,
      confidence: request.item.confidence,
      relationships: request.item.relationships ?? [],
      approval: request.item.approval ?? null,
      provenance: request.item.provenance ?? null,
      body: request.item.body,
    },
  };
}

function updateSeed(request: UpdateRequest): unknown {
  const patch = request.patch;
  return {
    operation: 'update',
    targetId: request.targetId,
    snapshot: request.snapshot ?? null,
    provenance: request.provenance ?? {},
    patch: {
      type: patch.type,
      title: patch.title,
      status: patch.status,
      source: patch.source,
      confidence: patch.confidence,
      body: patch.body,
      relationships: normalizeRelationshipMutations(patch.relationships),
      approval: patch.approval,
      provenance: patch.provenance,
    },
  };
}

function supersedeSeed(request: SupersedeRequest): unknown {
  return {
    operation: 'supersede',
    targetId: request.targetId,
    snapshot: request.snapshot ?? null,
    reason: request.reason,
    supersedingId: request.supersedingId,
    replacement:
      request.replacement === undefined
        ? undefined
        : {
            id: request.replacement.id,
            type: request.replacement.type,
            title: request.replacement.title,
            status: request.replacement.status,
            source: request.replacement.source,
            confidence: request.replacement.confidence,
            relationships: request.replacement.relationships ?? [],
            approval: request.replacement.approval ?? null,
            provenance: request.replacement.provenance ?? null,
            body: request.replacement.body,
          },
    provenance: request.provenance ?? {},
  };
}

function proposalSeed(request: ProposalRequest): unknown {
  if (request.operation === 'create') {
    return createSeed(request);
  }
  if (request.operation === 'update') {
    return updateSeed(request);
  }
  return supersedeSeed(request);
}

function invalidResultingIssue(targetId: string): Conflict {
  return conflict(
    'invalid_resulting_state',
    sanitize(`the resulting state for "${targetId}" is not valid canonical metadata`),
  );
}

function isResolvedDiff(value: ResolvedDiff | Conflict): value is ResolvedDiff {
  return 'kind' in value;
}

function buildCreateDiff(request: CreateRequest, now: string): ResolvedDiff | Conflict {
  const built = buildNewItem(request.item, now);
  if (!built.ok) {
    return invalidResultingIssue(request.item.id);
  }
  return { kind: 'create', item: built.item };
}

function buildUpdateDiff(
  request: UpdateRequest,
  current: ProposalRepositoryItem,
  now: string,
): ResolvedDiff | Conflict {
  const merged = mergeUpdateMetadata(current.metadata, request.patch, now);
  if (!merged.ok) {
    return invalidResultingIssue(request.targetId);
  }
  return {
    kind: 'update',
    targetId: request.targetId,
    current,
    changes: computeUpdateChanges(current, request.patch),
    resultingMetadata: merged.metadata,
  };
}

function buildSupersedeDiff(
  request: SupersedeRequest,
  current: ProposalRepositoryItem,
  now: string,
): ResolvedDiff | Conflict {
  const targetMetadata = supersedeTargetMetadata(current.metadata, now);
  if (!targetMetadata.ok) {
    return invalidResultingIssue(request.targetId);
  }
  if (request.supersedingId !== undefined) {
    return {
      kind: 'supersede',
      targetId: request.targetId,
      reason: request.reason,
      supersedingId: request.supersedingId,
      resultingTargetMetadata: targetMetadata.metadata,
    };
  }
  const built = buildNewItem(request.replacement!, now);
  if (!built.ok) {
    return invalidResultingIssue(request.replacement!.id);
  }
  return {
    kind: 'supersede',
    targetId: request.targetId,
    reason: request.reason,
    replacement: built.item,
    resultingTargetMetadata: targetMetadata.metadata,
  };
}

/**
 * Entry point for the proposal domain layer. Fuses validation (schema-legal)
 * and conflict detection (repository-dependent, deterministic), then materializes
 * a proposal with a deterministic `yzp-…` id, `pending` approval state, an
 * explicit diff, and a deterministic summary. Never throws, never writes.
 *
 * On success returns `{ ok: true, proposal, assessment }`; on any issue returns
 * `{ ok: false, issues }` — validation issues are never mixed with conflicts.
 */
export async function createProposal(
  input: unknown,
  repository: ProposalRepository,
  options: AssessmentOptions = {},
): Promise<ProposalOperationResult> {
  const validation = validateProposal(input);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }
  const request = validation.request;
  const now = timestampFor(options);

  const conflicts = await detectConflicts(request, repository, now);
  if (conflicts.length > 0) {
    return { ok: false, issues: conflicts };
  }

  let diff: ResolvedDiff;
  if (request.operation === 'create') {
    const built = buildCreateDiff(request, now);
    if (!isResolvedDiff(built)) {
      return { ok: false, issues: [built] };
    }
    diff = built;
  } else if (request.operation === 'update') {
    const current = await repository.getById(request.targetId);
    if (current === undefined) {
      return {
        ok: false,
        issues: [conflict('target_not_found', sanitize(`knowledge item "${request.targetId}" not found`))],
      };
    }
    const built = buildUpdateDiff(request, current, now);
    if (!isResolvedDiff(built)) {
      return { ok: false, issues: [built] };
    }
    diff = built;
  } else {
    const current = await repository.getById(request.targetId);
    if (current === undefined) {
      return {
        ok: false,
        issues: [conflict('target_not_found', sanitize(`knowledge item "${request.targetId}" not found`))],
      };
    }
    const built = buildSupersedeDiff(request, current, now);
    if (!isResolvedDiff(built)) {
      return { ok: false, issues: [built] };
    }
    diff = built;
  }

  const proposal: Proposal = {
    id: proposalIdFor(proposalSeed(request)),
    createdAt: now,
    operation: request.operation,
    request,
    provenance: request.provenance ?? {},
    approval: { status: 'pending' },
    diff,
  };

  const assessment: ProposalAssessment = {
    summary: summarizeProposal(proposal),
    validationValid: true,
    conflicts: [],
  };

  return { ok: true, proposal, assessment };
}

/** Alias for symmetry with the domain vocabulary. */
export function assessProposal(
  input: unknown,
  repository: ProposalRepository,
  options: AssessmentOptions = {},
): Promise<ProposalOperationResult> {
  return createProposal(input, repository, options);
}