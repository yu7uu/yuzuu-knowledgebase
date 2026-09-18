import type { ZodIssue } from 'zod';

export class KnowledgeFormatError extends Error {
  constructor(message: string, source?: string) {
    super(source ? `${source}: ${message}` : message);
    this.name = 'KnowledgeFormatError';
  }
}

export class KnowledgeValidationError extends Error {
  readonly issues: readonly ZodIssue[];

  constructor(issues: readonly ZodIssue[], source?: string) {
    const prefix = source ? `${source}: ` : '';
    const summary = issues
      .map((issue) => `${issue.path.join('.') || '<metadata>'}: ${issue.message}`)
      .join('; ');
    super(`${prefix}invalid knowledge metadata: ${summary}`);
    this.name = 'KnowledgeValidationError';
    this.issues = issues;
  }
}