import type {
  KnowledgeApproval,
  KnowledgeMetadata,
  KnowledgeRelationship,
  KnowledgeProvenance,
} from '../knowledge/schema.ts';
import type { ProposalRequest } from './schemas.ts';

export type ProposalOperation = 'create' | 'update' | 'supersede';

/**
 * Approval state of a proposal itself. This is independent of the `approval`
 * metadata carried by proposed Knowledge Items: a proposal can propose an item
 * with `approval: pending/approved` while the proposal itself is still pending.
 * Current milestone only creates `{ status: 'pending' }` proposals; the
 * approval transition becomes a later milestone.
 */
export type ProposalApproval =
  | { status: 'pending' }
  | { status: 'approved'; approved_at: string; approved_by?: string }
  | { status: 'rejected'; rejected_at: string; rejected_by?: string };

/**
 * A canonical-style Knowledge Item as proposed. Identical in shape to canonical
 * metadata plus a Markdown body, but without a repository file path because it
 * is not yet written to the canonical repository.
 */
export interface ProposedKnowledgeItem extends KnowledgeMetadata {
  body: string;
}

/** A canonical item as returned by the proposal repository. */
export interface ProposalRepositoryItem {
  metadata: KnowledgeMetadata;
  body: string;
}

/**
 * Minimal structural boundary for the proposal layer. Implemented by fakes in
 * tests; a `CanonicalKnowledgeReader` also satisfies it structurally because
 * its returned `KnowledgeDocument` exposes `metadata` and `body`.
 */
export interface ProposalRepository {
  getById(id: string): Promise<ProposalRepositoryItem | undefined>;
}

/** Optimistic concurrency snapshot captured from canonical `updated_at`. */
export interface CanonicalSnapshot {
  id: string;
  updatedAt: string;
}

export interface MetadataPatch {
  type?: KnowledgeMetadata['type'];
  title?: string;
  status?: KnowledgeMetadata['status'];
  source?: KnowledgeMetadata['source'];
  confidence?: KnowledgeMetadata['confidence'];
  /** `null` removes the current approval metadata. */
  approval?: KnowledgeApproval | null;
  /** `null` removes the current provenance metadata. */
  provenance?: KnowledgeProvenance | null;
}

export interface RelationshipChanges {
  added: KnowledgeRelationship[];
  removed: KnowledgeRelationship[];
}

export interface ItemChanges {
  metadata: MetadataPatch;
  body: { from: string; to: string } | null;
  relationships: RelationshipChanges | null;
}

export type ResolvedDiff =
  | { kind: 'create'; item: ProposedKnowledgeItem }
  | {
      kind: 'update';
      targetId: string;
      current: ProposalRepositoryItem;
      changes: ItemChanges;
      resultingMetadata: KnowledgeMetadata;
    }
  | {
      kind: 'supersede';
      targetId: string;
      reason?: string;
      supersedingId?: string;
      replacement?: ProposedKnowledgeItem;
      resultingTargetMetadata: KnowledgeMetadata;
    };

export interface Proposal {
  id: string;
  createdAt: string;
  operation: ProposalOperation;
  request: ProposalRequest;
  provenance: KnowledgeProvenance;
  approval: ProposalApproval;
  diff: ResolvedDiff;
}

// --- Validation (schema-legal, no repository) ---

export const VALIDATION_CODES = [
  'invalid_request',
  'invalid_operation',
  'invalid_id',
  'empty_body',
  'supersede_requires_replacement_or_superseding',
  'supersede_multiple_alternatives',
  'replacement_missing_supersedes_link',
  'duplicate_relationship_entries',
  'conflicting_relationship_mutations',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface ValidationIssue {
  phase: 'validation';
  code: ValidationCode;
  message: string;
  path?: string;
}

export type ValidationResult =
  | { ok: true; request: ProposalRequest }
  | { ok: false; issues: ValidationIssue[] };

export function validationIssue(
  code: ValidationCode,
  message: string,
  path?: string,
): ValidationIssue {
  return { phase: 'validation', code, message, path };
}

// --- Conflicts (deterministic, repository-dependent) ---

export const CONFLICT_CODES = [
  'id_already_exists',
  'target_not_found',
  'stale_snapshot',
  'metadata_conflict',
  'relationship_conflict',
  'invalid_resulting_state',
  'no_effective_change',
  'superseding_item_not_found',
  'superseding_item_not_linked',
] as const;

export type ConflictCode = (typeof CONFLICT_CODES)[number];

export interface Conflict {
  phase: 'conflict';
  code: ConflictCode;
  message: string;
}

export function conflict(code: ConflictCode, message: string): Conflict {
  return { phase: 'conflict', code, message };
}

export type ProposalIssue = ValidationIssue | Conflict;

// --- Assessment results ---

export interface ProposalAssessment {
  summary: string;
  validationValid: boolean;
  conflicts: Conflict[];
}

export type ProposalOperationResult =
  | { ok: true; proposal: Proposal; assessment: ProposalAssessment }
  | { ok: false; issues: ProposalIssue[] };