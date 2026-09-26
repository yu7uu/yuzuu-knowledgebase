import type { Proposal } from './types.ts';
import { sanitize } from './validate.ts';

function metadataFieldCount(proposal: Proposal): number {
  const changes =
    proposal.diff.kind === 'update' ? proposal.diff.changes.metadata : {};
  return Object.keys(changes).length;
}

function relationshipCounts(proposal: Proposal): { added: number; removed: number } {
  if (proposal.diff.kind !== 'update' || proposal.diff.changes.relationships === null) {
    return { added: 0, removed: 0 };
  }
  return {
    added: proposal.diff.changes.relationships.added.length,
    removed: proposal.diff.changes.relationships.removed.length,
  };
}

function createSummary(proposal: Proposal): string {
  const { item } = proposal.diff as Extract<Proposal['diff'], { kind: 'create' }>;
  return [
    `Proposal ${proposal.id}: create "${sanitize(item.title)}" (${sanitize(item.id)}, ${item.type}, ${item.status}).`,
    `Source ${item.source}, confidence ${item.confidence}.`,
  ].join(' ');
}

function updateSummary(proposal: Proposal): string {
  const { targetId, changes } = proposal.diff as Extract<Proposal['diff'], { kind: 'update' }>;
  const bodyState = changes.body === null ? 'unchanged' : 'updated';
  const rels = relationshipCounts(proposal);
  return [
    `Proposal ${proposal.id}: update ${sanitize(targetId)}.`,
    `${metadataFieldCount(proposal)} metadata field(s), body ${bodyState}, relationships +${rels.added}/-${rels.removed}.`,
  ].join(' ');
}

function supersedeSummary(proposal: Proposal): string {
  const diff = proposal.diff as Extract<Proposal['diff'], { kind: 'supersede' }>;
  const superseder =
    diff.supersedingId !== undefined
      ? `superseding item ${sanitize(diff.supersedingId)}`
      : `replacement item ${sanitize(diff.replacement!.id)}`;
  return [
    `Proposal ${proposal.id}: supersede ${sanitize(diff.targetId)} via ${superseder}.`,
    `${sanitize(diff.targetId)} is marked as superseded while keeping its history.`,
  ].join(' ');
}

/**
 * Deterministic, human-readable summary of a proposal. Never uses an LLM and
 * sanitizes interpolated request-derived strings so secrets cannot leak.
 */
export function summarizeProposal(proposal: Proposal): string {
  if (proposal.diff.kind === 'create') {
    return createSummary(proposal);
  }
  if (proposal.diff.kind === 'update') {
    return updateSummary(proposal);
  }
  return supersedeSummary(proposal);
}