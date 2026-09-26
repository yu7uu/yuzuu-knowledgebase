import type { Conflict, Proposal } from '../types.ts';
import type { ProposalDocument } from './schema.ts';

/**
 * Persistence-level lifecycle status of a proposal. It is owned by the store
 * and mirrors the directory a proposal file lives in (pending/, approved/,
 * rejected/). It is intentionally distinct from the domain's
 * `proposal.approval` field: moving a file between directories does not invent
 * approval semantics or timestamps, which belong to the approval milestone.
 */
export const PROPOSAL_LIFECYCLE_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type ProposalLifecycleStatus = (typeof PROPOSAL_LIFECYCLE_STATUSES)[number];

/** Optional assessment information preserved alongside a saved proposal. */
export interface PersistOptions {
  /** Deterministic summary; defaults to `summarizeProposal(proposal)`. */
  summary?: string;
  /** Whether the proposal passed domain validation; defaults to `true`. */
  validationValid?: boolean;
  /** Conflicts detected against the repository; defaults to `[]`. */
  conflicts?: Conflict[];
}

/**
 * Storage boundary for durable proposals.
 *
 * Implementations persist the complete proposal (as produced by the pure domain
 * layer) without giving the domain filesystem knowledge. Status transitions are
 * explicit and mechanical: a proposal is moved between status directories only
 * when `moveStatus` is called and never overwritten silently.
 */
export interface ProposalStore {
  /** Persists a freshly created proposal as `pending`. Fails on duplicate id. */
  savePending(proposal: Proposal, options?: PersistOptions): Promise<ProposalDocument>;
  /** Loads a proposal regardless of its current status; `undefined` when absent. */
  getById(id: string): Promise<ProposalDocument | undefined>;
  listPending(): Promise<ProposalDocument[]>;
  listApproved(): Promise<ProposalDocument[]>;
  listRejected(): Promise<ProposalDocument[]>;
  /**
   * Moves an existing proposal into the requested status directory. Missing
   * sources and destination collisions are typed errors. A move to the status
   * the proposal already has is an idempotent no-op.
   */
  moveStatus(id: string, status: ProposalLifecycleStatus): Promise<ProposalDocument>;
}