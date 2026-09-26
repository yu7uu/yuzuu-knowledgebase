import { knowledgeMetadataSchema } from '../knowledge/schema.ts';
import type { KnowledgeMetadata, KnowledgeRelationship } from '../knowledge/schema.ts';
import type { UpdatePatch } from './schemas.ts';
import type { ItemChanges, ProposalRepositoryItem, ProposedKnowledgeItem } from './types.ts';

export function relationshipKey(type: string, target: string): string {
  return `${type}:${target}`;
}

function sameValue(a: object | undefined, b: object | undefined): boolean {
  return JSON.stringify(a ?? undefined) === JSON.stringify(b ?? undefined);
}

/**
 * Diff between the current canonical item and the requested update patch. Only
 * effective changes are recorded: a patch field that matches the current value
 * is omitted. `approval`/`provenance` may be `null` in the patch to signal
 * removal; they are reflected here as `null`.
 */
export function computeUpdateChanges(
  current: ProposalRepositoryItem,
  patch: UpdatePatch,
): ItemChanges {
  const metadata: ItemChanges['metadata'] = {};
  const currentMetadata = current.metadata;

  if (patch.type !== undefined && patch.type !== currentMetadata.type) {
    metadata.type = patch.type;
  }
  if (patch.title !== undefined && patch.title !== currentMetadata.title) {
    metadata.title = patch.title;
  }
  if (patch.status !== undefined && patch.status !== currentMetadata.status) {
    metadata.status = patch.status;
  }
  if (patch.source !== undefined && patch.source !== currentMetadata.source) {
    metadata.source = patch.source;
  }
  if (patch.confidence !== undefined && patch.confidence !== currentMetadata.confidence) {
    metadata.confidence = patch.confidence;
  }

  if (patch.approval === null) {
    if (currentMetadata.approval !== undefined) {
      metadata.approval = null;
    }
  } else if (patch.approval !== undefined && !sameValue(patch.approval, currentMetadata.approval)) {
    metadata.approval = patch.approval;
  }

  if (patch.provenance === null) {
    if (currentMetadata.provenance !== undefined) {
      metadata.provenance = null;
    }
  } else if (patch.provenance !== undefined && !sameValue(patch.provenance, currentMetadata.provenance)) {
    metadata.provenance = patch.provenance;
  }

  const body =
    patch.body !== undefined && patch.body !== current.body
      ? { from: current.body, to: patch.body }
      : null;

  let relationships: ItemChanges['relationships'] = null;
  if (patch.relationships !== undefined) {
    const existing = new Set(
      (currentMetadata.relationships ?? []).map((rel) => relationshipKey(rel.type, rel.target)),
    );
    const added = (patch.relationships.add ?? []).filter(
      (rel) => !existing.has(relationshipKey(rel.type, rel.target)),
    );
    const removed = (patch.relationships.remove ?? []).filter((rel) =>
      existing.has(relationshipKey(rel.type, rel.target)),
    );
    if (added.length > 0 || removed.length > 0) {
      relationships = { added, removed };
    }
  }

  return { metadata, body, relationships };
}

/** A change set with no effective metadata/body/relationship changes. */
export function isEffectiveUpdate(changes: ItemChanges): boolean {
  if (Object.keys(changes.metadata).length > 0 || changes.body !== null) {
    return true;
  }
  return changes.relationships !== null;
}

function toProposedItem(metadata: KnowledgeMetadata, body: string): ProposedKnowledgeItem {
  return { ...metadata, body };
}

/**
 * Merges the update patch onto the current canonical metadata and validates the
 * result against the canonical schema. `null` approval/provenance removes the
 * current values; `created_at` is preserved and `updated_at` is re-stamped.
 * Returns `{ ok: false }` when the resulting state is not schema-legal
 * (reported as the `invalid_resulting_state` conflict).
 */
export function mergeUpdateMetadata(
  currentMetadata: KnowledgeMetadata,
  patch: UpdatePatch,
  now: string,
): { ok: true; metadata: KnowledgeMetadata } | { ok: false } {
  const candidate: Record<string, unknown> = {
    id: currentMetadata.id,
    type: patch.type ?? currentMetadata.type,
    title: patch.title ?? currentMetadata.title,
    status: patch.status ?? currentMetadata.status,
    created_at: currentMetadata.created_at,
    updated_at: now,
    source: patch.source ?? currentMetadata.source,
    confidence: patch.confidence ?? currentMetadata.confidence,
    relationships: currentMetadata.relationships ?? [],
  };

  if (patch.provenance === undefined) {
    if (currentMetadata.provenance !== undefined) {
      candidate.provenance = currentMetadata.provenance;
    }
  } else if (patch.provenance !== null) {
    candidate.provenance = patch.provenance;
  }

  if (patch.approval === undefined) {
    if (currentMetadata.approval !== undefined) {
      candidate.approval = currentMetadata.approval;
    }
  } else if (patch.approval !== null) {
    candidate.approval = patch.approval;
  }

  const parsed = knowledgeMetadataSchema.safeParse(candidate);
  return parsed.success ? { ok: true, metadata: parsed.data } : { ok: false };
}

/**
 * Materializes a proposed new item (create or supersede replacement) and
 * validates it against the canonical schema. Timestamps are stamped from `now`.
 */
export function buildNewItem(
  content: { id: string; body: string } & Omit<
    KnowledgeMetadata,
    'id' | 'created_at' | 'updated_at'
  >,
  now: string,
): { ok: true; item: ProposedKnowledgeItem } | { ok: false } {
  const candidate: Record<string, unknown> = {
    id: content.id,
    type: content.type,
    title: content.title,
    status: content.status,
    created_at: now,
    updated_at: now,
    source: content.source,
    confidence: content.confidence,
    relationships: content.relationships ?? [],
    ...(content.approval !== undefined ? { approval: content.approval } : {}),
    ...(content.provenance !== undefined ? { provenance: content.provenance } : {}),
  };
  const parsed = knowledgeMetadataSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, item: toProposedItem(parsed.data, content.body) };
}

/**
 * Computes the resulting metadata for a superseded target: status becomes
 * `superseded` and `updated_at` is re-stamped. `created_at` and all other
 * fields are preserved.
 */
export function supersedeTargetMetadata(
  currentMetadata: KnowledgeMetadata,
  now: string,
): { ok: true; metadata: KnowledgeMetadata } | { ok: false } {
  const candidate: Record<string, unknown> = {
    ...currentMetadata,
    status: 'superseded',
    updated_at: now,
  };
  const parsed = knowledgeMetadataSchema.safeParse(candidate);
  return parsed.success ? { ok: true, metadata: parsed.data } : { ok: false };
}

export type { KnowledgeRelationship };