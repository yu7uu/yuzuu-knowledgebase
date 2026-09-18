import { parse as parseYaml } from 'yaml';
import { KnowledgeFormatError, KnowledgeValidationError } from './errors.ts';
import { knowledgeMetadataSchema } from './schema.ts';
import type { KnowledgeMetadata } from './schema.ts';
import type { ZodIssue } from 'zod';

export interface ParsedKnowledgeDocument {
  metadata: KnowledgeMetadata;
  body: string;
}

const FRONTMATTER_DELIMITER = '---';
const BOM = '\uFEFF';

interface FrontmatterParts {
  frontmatter: string;
  body: string;
}

function extractFrontmatter(text: string, source?: string): FrontmatterParts {
  const normalized = text.startsWith(BOM) ? text.slice(1) : text;

  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new KnowledgeFormatError(
      'missing frontmatter: document must begin with a "---" delimiter line',
      source,
    );
  }

  const lines = normalized.slice(FRONTMATTER_DELIMITER.length + 1).split('\n');

  const closingLineIndex = lines.indexOf(FRONTMATTER_DELIMITER);
  if (closingLineIndex === -1) {
    throw new KnowledgeFormatError(
      'malformed frontmatter: missing closing "---" delimiter line',
      source,
    );
  }

  const frontmatter = lines.slice(0, closingLineIndex).join('\n');
  const body = lines.slice(closingLineIndex + 1).join('\n');

  if (body.trim() === '') {
    throw new KnowledgeFormatError(
      'missing markdown body: no content found after the frontmatter block',
      source,
    );
  }

  return { frontmatter, body };
}

export function parseKnowledgeDocument(
  text: string,
  source?: string,
): ParsedKnowledgeDocument {
  const { frontmatter, body } = extractFrontmatter(text, source);

  let raw: unknown;
  try {
    raw = parseYaml(frontmatter);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown YAML parse error';
    throw new KnowledgeFormatError(`malformed YAML in frontmatter: ${detail}`, source);
  }

  const result = knowledgeMetadataSchema.safeParse(raw);
  if (!result.success) {
    throw new KnowledgeValidationError(result.error.issues as readonly ZodIssue[], source);
  }

  return { metadata: result.data, body };
}