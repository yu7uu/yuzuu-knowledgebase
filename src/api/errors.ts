export const KNOWLEDGE_API_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'not_available',
  'repository_validation_failed',
  'graph_unavailable',
  'internal_error',
] as const;

export type KnowledgeApiErrorCode = (typeof KNOWLEDGE_API_ERROR_CODES)[number];

export interface KnowledgeApiError {
  code: KnowledgeApiErrorCode;
  message: string;
  details?: Readonly<Record<string, string>>;
}

export type KnowledgeApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KnowledgeApiError };

export function knowledgeOk<T>(value: T): KnowledgeApiResult<T> {
  return { ok: true, value };
}

export function knowledgeFail<T>(
  code: KnowledgeApiErrorCode,
  message: string,
  details?: Readonly<Record<string, string>>,
): KnowledgeApiResult<T> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}

export function knowledgeFailFromError<T>(error: KnowledgeApiError): KnowledgeApiResult<T> {
  return { ok: false, error };
}

const SECRET_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|credential|authorization)(\s*[:=]\s*)\S+/gi;

/** Redacts credential-like values and limits detail length before it leaves the API. */
export function sanitizeDetail(value: string): string {
  const redacted = value.replace(SECRET_PATTERN, '[redacted]');
  return redacted.length > 400 ? `${redacted.slice(0, 400)}…` : redacted;
}

/** Produces a safe, non-leaking reason string from a thrown value. */
export function safeReason(error: unknown): string {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    const candidate =
      typeof withCode.code === 'string' && withCode.code !== '' ? withCode.code : error.name;
    return sanitizeDetail(candidate);
  }
  return 'unknown error';
}

/**
 * Thrown by graph readers when the Neo4j projection cannot be read. The message
 * is fixed; the reason is a sanitized error code/name (never a driver message
 * that could contain connection details).
 */
export class GraphUnavailableError extends Error {
  readonly reason: string;

  constructor(reason?: string) {
    super('knowledge graph is unavailable');
    this.name = 'GraphUnavailableError';
    this.reason = reason === undefined ? 'graph unavailable' : sanitizeDetail(reason);
  }
}

/**
 * Thrown by canonical readers when any canonical file fails to load or validate.
 * The repository is treated as invalid until the offending file is fixed.
 */
export class RepositoryLoadError extends Error {
  readonly filePath: string;
  readonly reason: string;

  constructor(filePath: string, reason: string) {
    super(`canonical knowledge repository failed validation`);
    this.name = 'RepositoryLoadError';
    this.filePath = filePath;
    this.reason = sanitizeDetail(reason);
  }
}