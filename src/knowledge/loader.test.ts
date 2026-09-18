import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  KnowledgeFormatError,
  KnowledgeValidationError,
  loadKnowledgeFile,
  parseKnowledgeDocument,
} from './index.js';

const baseMetadata = {
  id: 'yz-test-item',
  type: 'concept',
  title: 'Test Concept',
  status: 'active',
  created_at: '2026-09-15T00:00:00+05:30',
  updated_at: '2026-09-15T00:00:00+05:30',
  source: 'manual',
  confidence: 'high',
};

const DEFAULT_BODY = '# Test Concept\n\nA body.\n';

function document(
  overrides: Record<string, unknown> = {},
  body: string = DEFAULT_BODY,
): string {
  const entries = Object.entries({ ...baseMetadata, ...overrides }).filter(
    ([, value]) => value !== undefined,
  );
  const frontmatter = entries.map(([key, value]) => `${key}: ${String(value)}`).join('\n');
  return `---\n${frontmatter}\n---\n${body}`;
}

let tmpDir: string | undefined;

async function tempFile(name: string, contents: string): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'yuzuu-knowledge-loader-'));
  const filePath = join(tmpDir, name);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('parseKnowledgeDocument', () => {
  it('parses valid metadata and preserves the markdown body', () => {
    const item = parseKnowledgeDocument(document());

    expect(item.metadata).toEqual(baseMetadata);
    expect(item.body).toBe(DEFAULT_BODY);
  });

  it('rejects unknown metadata keys instead of accepting them', () => {
    expect(() => parseKnowledgeDocument(document({ confidnce: 'high' }))).toThrow(
      KnowledgeValidationError,
    );

    try {
      parseKnowledgeDocument(document({ confidnce: 'high' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeValidationError);
      expect((error as KnowledgeValidationError).message).toContain('confidnce');
    }
  });

  it('accepts schema-defined optional metadata fields', () => {
    const raw = `---
id: yz-test-project
type: project
title: Test Project
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: high
relationships:
  - type: PART_OF
    target: yz-some-parent
approval:
  status: approved
  approved_by: arvi
provenance:
  source_session: session-2026-09-15-001
---

${DEFAULT_BODY}`;

    const item = parseKnowledgeDocument(raw);

    expect(item.metadata.relationships).toEqual([{ type: 'PART_OF', target: 'yz-some-parent' }]);
    expect(item.metadata.approval).toEqual({ status: 'approved', approved_by: 'arvi' });
    expect(item.metadata.provenance).toEqual({ source_session: 'session-2026-09-15-001' });
  });

  it('rejects metadata missing a required field', () => {
    expect(() => parseKnowledgeDocument(document({ confidence: undefined }))).toThrow(
      KnowledgeValidationError,
    );

    try {
      parseKnowledgeDocument(document({ confidence: undefined }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeValidationError);
      expect((error as KnowledgeValidationError).message).toContain('confidence');
    }
  });

  it.each([
    ['type', { type: 'galaxy' }],
    ['status', { status: 'imminent' }],
    ['source', { source: 'gossip' }],
    ['confidence', { confidence: 'certain' }],
    ['created_at', { created_at: '2026-09-15' }],
    ['created_at (non-date)', { created_at: 'not-a-date' }],
    ['id', { id: 'Bad ID' }],
  ])('rejects invalid %s with a useful error', (_label, overrides) => {
    expect(() => parseKnowledgeDocument(document(overrides))).toThrow(KnowledgeValidationError);
    try {
      parseKnowledgeDocument(document(overrides));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeValidationError);
      const issueKeys = Object.keys(overrides);
      expect((error as KnowledgeValidationError).message).toContain(issueKeys[0]!);
    }
  });

  it('rejects a document without frontmatter', () => {
    expect(() => parseKnowledgeDocument('# No frontmatter\n\nSome body.\n')).toThrow(
      KnowledgeFormatError,
    );
    try {
      parseKnowledgeDocument('# No frontmatter\n\nSome body.\n');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeFormatError).message).toMatch(/frontmatter/);
    }
  });

  it('rejects frontmatter without a closing delimiter', () => {
    expect(() => parseKnowledgeDocument('---\nid: yz-test-item\n')).toThrow(
      KnowledgeFormatError,
    );
    try {
      parseKnowledgeDocument('---\nid: yz-test-item\n');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeFormatError).message).toMatch(/closing/);
    }
  });

  it('rejects malformed YAML inside the frontmatter', () => {
    const raw = '---\nid: [unclosed\n---\nbody\n';
    expect(() => parseKnowledgeDocument(raw)).toThrow(KnowledgeFormatError);
    try {
      parseKnowledgeDocument(raw);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeFormatError).message).toMatch(/malformed YAML/);
    }
  });

  it('rejects a document with frontmatter but no body', () => {
    const raw = `---\n${Object.entries(baseMetadata)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n')}\n---\n   `;
    expect(() => parseKnowledgeDocument(raw)).toThrow(KnowledgeFormatError);
    try {
      parseKnowledgeDocument(raw);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeFormatError).message).toMatch(/markdown body/);
    }
  });

  it('does not coerce invalid values', () => {
    expect(() => parseKnowledgeDocument(document({ status: 'Active' }))).toThrow(
      KnowledgeValidationError,
    );
    expect(() => parseKnowledgeDocument(document({ confidence: 'HIGH' }))).toThrow(
      KnowledgeValidationError,
    );
  });
});

describe('loadKnowledgeFile', () => {
  it('loads the canonical yuzuu-studio fixture with validated metadata and its body', async () => {
    const filePath = resolve('knowledge/core/yuzuu-studio.md');
    const item = await loadKnowledgeFile(filePath);

    expect(item.filePath).toBe(filePath);
    expect(item.metadata).toEqual({
      id: 'yz-studio',
      type: 'organization',
      title: 'Yuzuu Studio',
      status: 'active',
      created_at: '2026-09-15T00:00:00+05:30',
      updated_at: '2026-09-15T00:00:00+05:30',
      source: 'manual',
      confidence: 'high',
    });
    expect(item.body.split('\n')[1]).toBe('# Yuzuu Studio');
    expect(item.body).toContain('tailor-made websites');
    expect(item.body).not.toContain('id: yz-studio');
    expect(item.body).not.toContain('confidence: high');
  });

  it('loads a valid knowledge file from a path containing the body unchanged', async () => {
    const filePath = await tempFile('valid.md', document());
    const item = await loadKnowledgeFile(filePath);

    expect(item.filePath).toBe(filePath);
    expect(item.metadata.id).toBe('yz-test-item');
    expect(item.body).toBe(DEFAULT_BODY);
  });

  it('surfaces validation errors with the source file path', async () => {
    const filePath = await tempFile('invalid.md', document({ confidence: undefined }));

    await expect(loadKnowledgeFile(filePath)).rejects.toBeInstanceOf(KnowledgeValidationError);

    try {
      await loadKnowledgeFile(filePath);
      expect.unreachable('should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeValidationError);
      expect((error as KnowledgeValidationError).message).toContain(filePath);
      expect((error as KnowledgeValidationError).message).toContain('confidence');
    }
  });
});