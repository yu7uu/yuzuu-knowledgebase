import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKnowledgeRepository } from './index.ts';

function validDocument(id: string): string {
  return `---
id: ${id}
type: concept
title: Valid Concept
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: high
---

# ${id}

Some body.
`;
}

function invalidDocument(id: string): string {
  return `---
id: ${id}
type: galaxy
title: Invalid Concept
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: high
---

# ${id}

Some body.
`;
}

let tempRepos: string[] = [];

async function createRepository(tree: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'yuzuu-knowledge-repo-'));
  tempRepos.push(root);
  for (const [relativePath, contents] of Object.entries(tree)) {
    const filePath = join(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRepos.map((root) => rm(root, { recursive: true, force: true })),
  );
  tempRepos = [];
});

describe('validateKnowledgeRepository', () => {
  it('passes a repository containing only valid markdown files', async () => {
    const repo = await createRepository({
      'a.md': validDocument('yz-a'),
      'nested/b.md': validDocument('yz-b'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(result.validFiles).toHaveLength(2);
    expect(result.invalidFiles).toEqual([]);
  });

  it('fails a repository containing one invalid markdown file', async () => {
    const repo = await createRepository({
      'good.md': validDocument('yz-good'),
      'bad.md': invalidDocument('yz-bad'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(1);
    expect(result.invalidFiles).toHaveLength(1);
    expect(result.invalidFiles[0]?.filePath.endsWith('bad.md')).toBe(true);
    expect(result.invalidFiles[0]?.error.length).toBeGreaterThan(0);
  });

  it('reports all invalid files when several are invalid', async () => {
    const repo = await createRepository({
      'a.md': invalidDocument('yz-a'),
      'b.md': invalidDocument('yz-b'),
      'c.md': invalidDocument('yz-c'),
      'good.md': validDocument('yz-good'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(4);
    expect(result.invalidCount).toBe(3);
    expect(result.invalidFiles).toHaveLength(3);
    const reported = result.invalidFiles.map(({ filePath }) => filePath.split('/').pop());
    expect(reported.sort()).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('ignores non-markdown files', async () => {
    const repo = await createRepository({
      'a.md': validDocument('yz-a'),
      'notes.txt': 'not markdown',
      'image.png': 'binary',
      'README': 'no extension',
      '.DS_Store': '',
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(1);
    expect(result.validCount).toBe(1);
  });

  it('discovers markdown files in nested directories', async () => {
    const repo = await createRepository({
      'top.md': validDocument('yz-top'),
      'one/two/deep.md': validDocument('yz-deep'),
      'one/side.md': validDocument('yz-side'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(3);
    expect(result.validFiles.some((p) => p.endsWith('one/two/deep.md'))).toBe(true);
    expect(result.validCount).toBe(3);
  });

  it('continues validating after encountering an invalid file', async () => {
    const repo = await createRepository({
      'first-invalid.md': invalidDocument('yz-first'),
      'middle-valid.md': validDocument('yz-middle'),
      'last-invalid.md': invalidDocument('yz-last'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(3);
    expect(result.invalidCount).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.validFiles[0]?.endsWith('middle-valid.md')).toBe(true);
  });

  it('returns useful file paths and error information', async () => {
    const repo = await createRepository({
      'deep/dir/bad.md': invalidDocument('yz-bad'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.invalidFiles[0]?.filePath).toBe(join(repo, 'deep', 'dir', 'bad.md'));
    expect(result.invalidFiles[0]?.error).toContain('type');
  });

  it('ignores generated and VCS directories', async () => {
    const repo = await createRepository({
      'a.md': validDocument('yz-a'),
      'nested/real.md': validDocument('yz-real'),
      'node_modules/pkg/x.md': invalidDocument('yz-in-node-modules'),
      '.git/objects/y.md': invalidDocument('yz-in-git'),
      'dist/bundle.md': invalidDocument('yz-in-dist'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(result.validCount).toBe(2);
  });

  it('ignores the schema-definition document', async () => {
    const repo = await createRepository({
      'SCHEMA.md': '# Schema\n\nNo YAML frontmatter.\n',
      'core/item.md': validDocument('yz-item'),
    });

    const result = await validateKnowledgeRepository(repo);

    expect(result.filesChecked).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.validCount).toBe(1);
    expect(result.validFiles[0]?.endsWith('core/item.md')).toBe(true);
  });
});