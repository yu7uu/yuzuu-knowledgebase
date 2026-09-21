import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadKnowledgeFile, KnowledgeValidationError } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import { DuplicateKnowledgeItemIdError, projectKnowledgeGraph } from './index.ts';

let tmpDir: string | undefined;

async function loadFiles(files: Record<string, string>): Promise<KnowledgeDocument[]> {
  tmpDir = await mkdtemp(join(tmpdir(), 'yuzuu-graph-project-'));
  const docs: KnowledgeDocument[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(tmpDir, name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
    docs.push(await loadKnowledgeFile(filePath));
  }
  return docs;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

function baseMetadata(id: string, type: string, title: string): string {
  return [
    `id: ${id}`,
    `type: ${type}`,
    `title: ${title}`,
    'status: active',
    'created_at: 2026-09-15T00:00:00+05:30',
    'updated_at: 2026-09-15T00:00:00+05:30',
    'source: manual',
    'confidence: high',
  ].join('\n');
}

const BODY = '# Title\n\nA body paragraph.\n';

function document(id: string, type: string, title: string, extra: string = ''): string {
  return `---\n${baseMetadata(id, type, title)}\n${extra}\n---\n${BODY}`;
}

describe('projectKnowledgeGraph', () => {
  it('projects a single document into one node with exactly the mapped properties', async () => {
    const docs = await loadFiles({ 'document.md': document('yz-alpha', 'project', 'Alpha') });
    const projection = projectKnowledgeGraph(docs, tmpDir!);

    expect(projection.nodes).toEqual([
      {
        id: 'yz-alpha',
        type: 'project',
        title: 'Alpha',
        status: 'active',
        created_at: '2026-09-15T00:00:00+05:30',
        updated_at: '2026-09-15T00:00:00+05:30',
        source: 'manual',
        confidence: 'high',
        file_path: 'document.md',
      },
    ]);
    expect(Object.keys(projection.nodes[0]!).sort()).toEqual([
      'confidence',
      'created_at',
      'file_path',
      'id',
      'source',
      'status',
      'title',
      'type',
      'updated_at',
    ]);
    expect(projection.relationships).toEqual([]);
    expect(projection.unresolvedRelationships).toEqual([]);
  });

  it('uses repo-relative file paths for documents in subdirectories', async () => {
    const docs = await loadFiles({ 'nested/deep/a.md': document('yz-alpha', 'concept', 'Alpha') });
    const projection = projectKnowledgeGraph(docs, tmpDir!);

    expect(projection.nodes[0]!.file_path).toBe('nested/deep/a.md');
  });

  it('projects explicit relationships and reports unresolved targets', async () => {
    const docs = await loadFiles({
      'b.md': document('yz-beta', 'organization', 'Beta'),
      'a.md': document(
        'yz-alpha',
        'project',
        'Alpha',
        'relationships:\n  - type: OWNS\n    target: yz-beta\n  - type: CONTAINS\n    target: yz-missing',
      ),
    });

    const projection = projectKnowledgeGraph(docs, tmpDir!);

    expect(projection.nodes.map((node) => node.id)).toEqual(['yz-alpha', 'yz-beta']);
    expect(projection.relationships).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
    ]);
    expect(projection.unresolvedRelationships).toEqual([
      { sourceId: 'yz-alpha', type: 'CONTAINS', targetId: 'yz-missing' },
    ]);
  });

  it('does not infer relationships from body prose', async () => {
    const prose = '# Alpha\n\nA body that references yz-beta in sentences.\n';
    const raw = `---\n${baseMetadata('yz-alpha', 'project', 'Alpha')}\n---\n${prose}`;
    const docs = await loadFiles({
      'beta.md': document('yz-beta', 'organization', 'Beta'),
      'alpha.md': raw,
    });
    expect(docs[1]!.body).toBe(prose);

    const projection = projectKnowledgeGraph(docs, tmpDir!);
    expect(projection.relationships).toEqual([]);
    expect(projection.unresolvedRelationships).toEqual([]);
  });

  it('sorts relationships deterministically by source, type, and target', async () => {
    const docs = await loadFiles({
      'a.md': document(
        'yz-alpha',
        'project',
        'Alpha',
        'relationships:\n  - type: OWNS\n    target: yz-beta\n  - type: CONTAINS\n    target: yz-beta\n  - type: USES\n    target: yz-missing',
      ),
      'b.md': document('yz-beta', 'organization', 'Beta'),
    });

    const projection = projectKnowledgeGraph(docs, tmpDir!);

    expect(projection.relationships.map((edge) => edge.type)).toEqual(['CONTAINS', 'OWNS']);
    expect(projection.unresolvedRelationships.map((edge) => edge.type)).toEqual(['USES']);
  });

  it('rejects duplicate ids across files with a clear error', async () => {
    const docs = await loadFiles({
      'first.md': document('yz-alpha', 'project', 'Alpha One'),
      'second.md': document('yz-alpha', 'project', 'Alpha Two'),
    });

    expect(() => projectKnowledgeGraph(docs, tmpDir!)).toThrow(
      DuplicateKnowledgeItemIdError,
    );
    try {
      projectKnowledgeGraph(docs, tmpDir!);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateKnowledgeItemIdError);
      const message = (error as DuplicateKnowledgeItemIdError).message;
      expect(message).toContain('yz-alpha');
      expect(message).toContain('first.md');
      expect(message).toContain('second.md');
    }
  });

  it('rejects unknown relationship types at validation time', async () => {
    const raw = document(
      'yz-alpha',
      'project',
      'Alpha',
      'relationships:\n  - type: OWNS_EVERYTHING\n    target: yz-beta',
    );

    await expect(loadFiles({ 'a.md': raw })).rejects.toBeInstanceOf(KnowledgeValidationError);
  });

  it('maps provenance and approval into flattened node properties', async () => {
    const docs = await loadFiles({
      'a.md': document(
        'yz-alpha',
        'decision',
        'Alpha',
        `provenance:
  source_session: session-2026-09-15-001
  source_document: meeting-notes-01
  source_reference: op-issue-42
  author: arvi
approval:
  status: approved
  approved_by: arvi
  approved_at: 2026-09-16T00:00:00+05:30`,
      ),
    });

    const projection = projectKnowledgeGraph(docs, tmpDir!);
    const node = projection.nodes[0]!;

    expect(node.source_session).toBe('session-2026-09-15-001');
    expect(node.source_document).toBe('meeting-notes-01');
    expect(node.source_reference).toBe('op-issue-42');
    expect(node.author).toBe('arvi');
    expect(node.approval_status).toBe('approved');
    expect(node.approval_approved_by).toBe('arvi');
    expect(node.approval_approved_at).toBe('2026-09-16T00:00:00+05:30');
  });
});