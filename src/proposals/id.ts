import { createHash } from 'node:crypto';

/**
 * Canonical JSON serialization: object keys are sorted recursively, values are
 * recursively normalized, and `undefined` values are dropped (so "absent" is
 * unambiguous with `null`). Used to derive deterministic proposal IDs from the
 * proposal request and requester provenance only.
 */
export function canonicalJson(value: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, normalize(child)] as const);
    return Object.fromEntries(entries);
  };
  const normalized = normalize(value);
  return JSON.stringify(normalized ?? null);
}

const PROPOSAL_ID_PREFIX = 'yzp-';
const PROPOSAL_ID_HEX_LENGTH = 16;

/**
 * Deterministic proposal ID: `yzp-<sha256[..16]>` over the canonical JSON of
 * the seed. The same seed always yields the same ID; non-deterministic pieces
 * (proposal creation time, proposal approval state) are never part of the seed.
 */
export function proposalIdFor(seed: unknown): string {
  const digest = createHash('sha256').update(canonicalJson(seed)).digest('hex');
  return `${PROPOSAL_ID_PREFIX}${digest.slice(0, PROPOSAL_ID_HEX_LENGTH)}`;
}