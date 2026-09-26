import { proposalRequestSchema } from './schemas.ts';
import type { ProposalRequest, SupersedeRequest } from './schemas.ts';
import type { ValidationIssue, ValidationResult } from './types.ts';
import { validationIssue } from './types.ts';

const MAX_MESSAGE_LENGTH = 400;
const SECRET_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|credential|authorization|api_key|client_id)(\s*[:=]\s*)\S+/gi;

/**
 * Local sanitization for anything derived from proposal input before it is
 * embedded in issue messages or summaries. Redacts credential-like values and
 * caps length so secrets/interpolations never leave the domain layer.
 */
export function sanitize(value: string): string {
  const redacted = value.replace(SECRET_PATTERN, '[redacted]');
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

const RELATIONSHIP_MUTATIONS = ['add', 'remove'] as const;

const SUPERSEDES = 'SUPERSEDES';

/** Returns `true` when the request string is empty or only whitespace. */
function isBlank(value: string): boolean {
  return value.trim() === '';
}

function relationshipKey(type: string, target: string): string {
  return `${type}:${target}`;
}

function detectDuplicateRelationshipMutations(
  request: Extract<ProposalRequest, { operation: 'update' }>,
): ValidationIssue[] {
  const mutations = request.patch.relationships;
  const issues: ValidationIssue[] = [];
  if (mutations === undefined) {
    return issues;
  }

  for (const side of RELATIONSHIP_MUTATIONS) {
    const entries = mutations[side];
    if (entries === undefined) {
      continue;
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = relationshipKey(entry.type, entry.target);
      if (seen.has(key)) {
        issues.push(
          validationIssue(
            'duplicate_relationship_entries',
            sanitize(`duplicate relationship ${entry.type} -> ${entry.target} in patch.relationships.${side}`),
            `patch.relationships.${side}`,
          ),
        );
      }
      seen.add(key);
    }
  }

  const addKeys = new Set((mutations.add ?? []).map((e) => relationshipKey(e.type, e.target)));
  for (const entry of mutations.remove ?? []) {
    const key = relationshipKey(entry.type, entry.target);
    if (addKeys.has(key)) {
      issues.push(
        validationIssue(
          'conflicting_relationship_mutations',
          sanitize(`relationship ${entry.type} -> ${entry.target} is both added and removed`),
          'patch.relationships',
        ),
      );
    }
  }

  return issues;
}

function schemaIssues(path: readonly PropertyKey[], message: string): ValidationIssue {
  const joined = path.length === 0 ? '<request>' : path.map(String).join('.');
  return validationIssue('invalid_request', sanitize(`request.${joined}: ${message}`), joined);
}

function validateSupersedeRequest(request: SupersedeRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasSupersedingId = request.supersedingId !== undefined;
  const hasReplacement = request.replacement !== undefined;

  if (hasSupersedingId && hasReplacement) {
    issues.push(
      validationIssue(
        'supersede_multiple_alternatives',
        'supersede must name exactly one alternative: either supersedingId or replacement, not both',
        'supersede',
      ),
    );
    return issues;
  }
  if (!hasSupersedingId && !hasReplacement) {
    issues.push(
      validationIssue(
        'supersede_requires_replacement_or_superseding',
        'supersede must name an alternative: either an existing supersedingId or a replacement item',
        'supersede',
      ),
    );
    return issues;
  }

  if (hasReplacement && request.replacement !== undefined) {
    const links = (request.replacement.relationships ?? []).filter(
      (rel) => rel.type === SUPERSEDES && rel.target === request.targetId,
    );
    if (links.length === 0) {
      issues.push(
        validationIssue(
          'replacement_missing_supersedes_link',
          sanitize(
            `replacement item ${request.replacement.id} must declare ${SUPERSEDES} -> ${request.targetId}`,
          ),
          'replacement.relationships',
        ),
      );
    }
  }
  return issues;
}

/**
 * Schema-legal validation of a proposal request. This is pure: no repository,
 * no Neo4j, no side effects, no LLM. It returns parsed/typed requests on
 * success and a deterministic `ValidationIssue[]` on failure.
 */
export function validateProposal(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object') {
    return {
      ok: false,
      issues: [validationIssue('invalid_request', 'request must be an object', '<request>')],
    };
  }

  const operation = (input as { operation?: unknown }).operation;
  if (operation === undefined || typeof operation !== 'string') {
    return {
      ok: false,
      issues: [validationIssue('invalid_request', 'request must include an "operation" string', 'operation')],
    };
  }

  const parsed = proposalRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) =>
      schemaIssues(issue.path, issue.message),
    );
    const unknownOperations = parsed.error.issues.filter(
      (issue) => issue.path[0] === 'operation',
    );
    if (unknownOperations.length > 0 && operation !== 'create' && operation !== 'update' && operation !== 'supersede') {
      issues.push(validationIssue('invalid_operation', sanitize(`unsupported operation "${String(operation)}"`), 'operation'));
    }
    return { ok: false, issues };
  }

  const request = parsed.data;
  const issues: ValidationIssue[] = [];

  if (request.operation === 'create') {
    if (isBlank(request.item.body)) {
      issues.push(validationIssue('empty_body', 'body must not be empty or whitespace-only', 'item.body'));
    }
  } else if (request.operation === 'update') {
    if (request.patch.body !== undefined && isBlank(request.patch.body)) {
      issues.push(validationIssue('empty_body', 'body must not be empty or whitespace-only', 'patch.body'));
    }
    issues.push(...detectDuplicateRelationshipMutations(request));
  } else {
    if (request.replacement !== undefined && isBlank(request.replacement.body)) {
      issues.push(
        validationIssue('empty_body', 'body must not be empty or whitespace-only', 'replacement.body'),
      );
    }
    issues.push(...validateSupersedeRequest(request));
  }

  return issues.length === 0 ? { ok: true, request } : { ok: false, issues };
}