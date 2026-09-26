import { sanitize } from '../validate.ts';

/**
 * Base class for all proposal storage failures. Direct fs/YAML exceptions are
 * never surfaced to callers: they are either mapped into these typed errors
 * (with sanitized details) or rethrown unchanged when they are already typed.
 */
export class ProposalStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalStoreError';
  }
}

/** Saving a proposal whose id already exists without an explicit replacement. */
export class DuplicateProposalError extends ProposalStoreError {
  readonly id: string;

  constructor(id: string) {
    super(`proposal already exists: "${sanitize(id)}"`);
    this.name = 'DuplicateProposalError';
    this.id = id;
  }
}

/** A proposal id referenced by moveStatus exists in no status directory. */
export class ProposalNotFoundError extends ProposalStoreError {
  readonly id: string;

  constructor(id: string) {
    super(`proposal not found: "${sanitize(id)}"`);
    this.name = 'ProposalNotFoundError';
    this.id = id;
  }
}

/** Moving a proposal onto an already-existing file in the destination status. */
export class MoveDestinationConflictError extends ProposalStoreError {
  readonly id: string;
  readonly status: string;

  constructor(id: string, status: string) {
    super(`a proposal with id "${sanitize(id)}" already exists in status "${sanitize(status)}"`);
    this.name = 'MoveDestinationConflictError';
    this.id = id;
    this.status = status;
  }
}

/** A persisted proposal file failed YAML or schema validation on load. */
export class MalformedProposalError extends ProposalStoreError {
  readonly filePath: string;
  readonly reason: string;

  constructor(filePath: string, reason: string) {
    super(`malformed proposal file "${sanitize(filePath)}": ${sanitize(reason)}`);
    this.name = 'MalformedProposalError';
    this.filePath = filePath;
    this.reason = sanitize(reason);
  }
}

/** A proposal id could traverse directories or escape the proposals root. */
export class UnsafeProposalIdError extends ProposalStoreError {
  readonly id: string;

  constructor(id: string) {
    super(
      `unsafe proposal id "${sanitize(String(id))}": ids must match /^[a-z0-9][a-z0-9-]{0,126}$/`,
    );
    this.name = 'UnsafeProposalIdError';
    this.id = String(id);
  }
}

/** Generic, sanitized filesystem failure (permissions, I/O, ...). */
export class ProposalStorageError extends ProposalStoreError {
  readonly action: string;
  readonly reason: string;

  constructor(action: string, cause: unknown) {
    super(`proposal storage failed while ${action}: ${safeStorageReason(cause)}`);
    this.name = 'ProposalStorageError';
    this.action = action;
    this.reason = safeStorageReason(cause);
  }
}

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,126}$/;

export const PROPOSAL_ID_PATTERN = SAFE_ID_PATTERN;

function safeStorageReason(error: unknown): string {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    const candidate =
      typeof withCode.code === 'string' && withCode.code !== '' ? withCode.code : error.name;
    return sanitize(candidate);
  }
  return 'unknown storage error';
}