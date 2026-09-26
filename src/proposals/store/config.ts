import { resolve } from 'node:path';

/** Default repository-relative directory for durable proposals. */
export const PROPOSALS_ROOT = 'proposals';

export interface ProposalsConfig {
  /** Absolute path to the proposals root (contains pending/, approved/, rejected/). */
  root: string;
}

export function defaultProposalsRoot(cwd: string = process.cwd()): string {
  return resolve(cwd, PROPOSALS_ROOT);
}

/**
 * Resolves the proposals root from a config object or a directory shorthand.
 * Relative paths are resolved against `cwd` (defaults to the process working
 * directory, i.e. the repository root when run from there).
 */
export function resolveProposalsConfig(config?: ProposalsConfig | string): ProposalsConfig {
  const root =
    typeof config === 'string'
      ? config
      : config?.root ?? defaultProposalsRoot();
  return { root: resolve(root) };
}