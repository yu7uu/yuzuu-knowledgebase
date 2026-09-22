import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadKnowledgeFile } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import { projectKnowledgeGraph } from './index.ts';
import {
  buildReconciliationReport,
  planReconciliation,
} from './index.ts';
import type {
  ExistingGraphState,
  ExistingKnowledgeItemState,
  ExistingKnowledgeRelationshipState,
  GraphProjection,
} from './index.ts';

const TS = '2026-09-15T00:00:00+05:30';

let tmpDir: string | undefined;

async function loadProjection(files: Record<string, string>): Promise<GraphProjection> {
  tmpDir = await mkdtemp(join(tmpdir(), 'yuzuu-reconcile-plan-'));
  const docs: KnowledgeDocument[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(tmpDir, name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
    docs.push(await loadKnowledgeFile(filePath));
  }
  const projection = projectKnowledgeGraph(docs, tmpDir!);
  return projection;
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
    `created_at: ${TS}`,
    `updated_at: ${TS}`,
    'source: manual',
    'confidence: high',
  ].join('\n');
}

const BODY = '# Title\n\nA body paragraph.\n';

function document(id: string, type: string, title: string, extra: string = ''): string {
  return `---\n${baseMetadata(id, type, title)}\n${extra}\n---\n${BODY}`;
}

function existingNode(
  id: string,
  title: string,
  type: string = 'project',
  extra: Record<string, string> = {},
): ExistingKnowledgeItemState {
  return {
    id,
    properties: {
      type,
      title,
      status: 'active',
      created_at: TS,
      updated_at: TS,
      source: 'manual',
      confidence: 'high',
      file_path: `${id}.md`,
      ...extra,
    },
  };
}

function existingEdge(
  sourceId: string,
  type: string,
  targetId: string,
): ExistingKnowledgeRelationshipState {
  return { sourceId, type, targetId };
}

function emptyExisting(): ExistingGraphState {
  return { nodes: [], relationships: [] };
}

function existingFromProjection(projection: GraphProjection): ExistingGraphState {
  return {
    nodes: projection.nodes.map(({ id, ...properties }) => ({ id, properties })),
    relationships: projection.relationships.map((edge) => ({
      sourceId: edge.sourceId,
      type: edge.type,
      targetId: edge.targetId,
    })),
  };
}

describe('planReconciliation', () => {
  it('keeps an existing canonical item untouched when its projection is unchanged', async () => {
    const projection = await loadProjection({ 'a.md': document('yz-alpha', 'project', 'Alpha') });
    const existing = existingFromProjection(projection);

    const plan = planReconciliation(projection, existing);

    expect(plan.nodesToCreate).toEqual([]);
    expect(plan.nodesToUpdate).toEqual([]);
    expect(plan.nodesToDelete).toEqual([]);
    expect(plan.nodesUnchanged).toEqual(['yz-alpha']);
  });

  it('plans an update when canonical metadata changes', async () => {
    const projection = await loadProjection({
      'a.md': document('yz-alpha', 'project', 'Alpha v2'),
    });
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha')],
      relationships: [],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.nodesToCreate).toEqual([]);
    expect(plan.nodesToUpdate).toHaveLength(1);
    expect(plan.nodesToUpdate[0]!.id).toBe('yz-alpha');
    expect(plan.nodesToUpdate[0]!.properties.title).toBe('Alpha v2');
    expect(plan.nodesToUpdate[0]!.removeKeys).toEqual([]);
    expect(plan.nodesUnchanged).toEqual([]);
  });

  it('plans removal of node properties that are no longer canonical', async () => {
    const projection = await loadProjection({ 'a.md': document('yz-alpha', 'concept', 'Alpha') });
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha', 'concept', { author: 'arvi' })],
      relationships: [],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.nodesToUpdate[0]!.removeKeys).toEqual(['author']);
    expect(plan.nodesToUpdate[0]!.properties).not.toHaveProperty('author');
  });

  it('plans creation of a relationship declared canonically', async () => {
    const projection = await loadProjection({
      'a.md': document('yz-alpha', 'project', 'Alpha', 'relationships:\n  - type: OWNS\n    target: yz-beta'),
      'b.md': document('yz-beta', 'organization', 'Beta'),
    });
    const existing = existingFromProjection({
      nodes: projection.nodes,
      relationships: [],
      unresolvedRelationships: [],
    });

    const plan = planReconciliation(projection, existing);

    expect(plan.relationshipsToCreate).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
    ]);
    expect(plan.relationshipsToDelete).toEqual([]);
  });

  it('plans removal of a canonical relationship that is no longer declared', async () => {
    const projection = await loadProjection({
      'a.md': document('yz-alpha', 'project', 'Alpha'),
      'b.md': document('yz-beta', 'organization', 'Beta'),
    });
    const existing: ExistingGraphState = {
      nodes: existingFromProjection(projection).nodes,
      relationships: [existingEdge('yz-alpha', 'OWNS', 'yz-beta')],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.relationshipsToDelete).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
    ]);
    expect(plan.relationshipsToCreate).toEqual([]);
  });

  it('plans deletion of a canonical item no longer present', async () => {
    const projection = await loadProjection({ 'a.md': document('yz-alpha', 'project', 'Alpha') });
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha'), existingNode('yz-beta', 'Beta', 'organization')],
      relationships: [],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.nodesToDelete).toEqual(['yz-beta']);
    expect(plan.nodesToCreate).toEqual([]);
  });

  it('only ever targets existing :KnowledgeItem ids for deletion', async () => {
    const projection = await loadProjection({ 'a.md': document('yz-alpha', 'project', 'Alpha') });
    const existing: ExistingGraphState = {
      nodes: [
        existingNode('yz-alpha', 'Alpha'),
        existingNode('yz-stale', 'Stale', 'concept'),
        existingNode('yz-another', 'Another', 'service'),
      ],
      relationships: [],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.nodesToDelete).toEqual(['yz-another', 'yz-stale']);
    for (const id of plan.nodesToDelete) {
      expect(existing.nodes.some((node) => node.id === id)).toBe(true);
    }
    expect(plan.nodesToDelete).not.toContain('anything-not-a-knowledge-item');
  });

  it('only plans relationship deletions that are KnowledgeItem-to-KnowledgeItem', async () => {
    const projection = await loadProjection({ 'a.md': document('yz-alpha', 'project', 'Alpha') });
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha'), existingNode('yz-beta', 'Beta', 'organization')],
      relationships: [
        existingEdge('yz-alpha', 'OWNS', 'yz-beta'),
        existingEdge('yz-beta', 'PART_OF', 'yz-alpha'),
      ],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.relationshipsToDelete).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
      { sourceId: 'yz-beta', type: 'PART_OF', targetId: 'yz-alpha' },
    ]);
    for (const edge of plan.relationshipsToDelete) {
      expect(existing.nodes.some((node) => node.id === edge.sourceId)).toBe(true);
      expect(existing.nodes.some((node) => node.id === edge.targetId)).toBe(true);
    }
  });

  it('keeps unresolved relationship targets unresolved and never creates them', async () => {
    const projection = await loadProjection({
      'a.md': document(
        'yz-alpha',
        'project',
        'Alpha',
        'relationships:\n  - type: CONTAINS\n    target: yz-missing',
      ),
    });
    const existing = emptyExisting();

    const plan = planReconciliation(projection, existing);

    expect(plan.unresolvedRelationships).toEqual([
      { sourceId: 'yz-alpha', type: 'CONTAINS', targetId: 'yz-missing' },
    ]);
    expect(plan.relationshipsToCreate).toEqual([]);
  });

  it('removes all KnowledgeItems and their edges for an empty desired projection', async () => {
    const projection = await loadProjection({});
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha'), existingNode('yz-beta', 'Beta', 'organization')],
      relationships: [existingEdge('yz-alpha', 'OWNS', 'yz-beta')],
    };

    const plan = planReconciliation(projection, existing);

    expect(plan.desiredNodes).toHaveLength(0);
    expect(plan.nodesToDelete).toEqual(['yz-alpha', 'yz-beta']);
    expect(plan.relationshipsToDelete).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
    ]);
  });

  it('is idempotent against a fully reconciled graph (no additional changes on second run)', async () => {
    const projection = await loadProjection({
      'a.md': document('yz-alpha', 'project', 'Alpha', 'relationships:\n  - type: OWNS\n    target: yz-beta'),
      'b.md': document('yz-beta', 'organization', 'Beta'),
    });

    const empty = emptyExisting();
    const firstRun = planReconciliation(projection, empty);
    expect(firstRun.nodesToCreate.length).toBe(2);
    expect(firstRun.relationshipsToCreate.length).toBe(1);

    const afterFirstRun = existingFromProjection(projection);
    const secondRun = planReconciliation(projection, afterFirstRun);

    expect(secondRun.nodesToCreate).toEqual([]);
    expect(secondRun.nodesToUpdate).toEqual([]);
    expect(secondRun.nodesToDelete).toEqual([]);
    expect(secondRun.relationshipsToCreate).toEqual([]);
    expect(secondRun.relationshipsToDelete).toEqual([]);
    expect(secondRun.nodesUnchanged).toEqual(['yz-alpha', 'yz-beta']);
    expect(secondRun.relationshipsUnchanged).toEqual([
      { sourceId: 'yz-alpha', type: 'OWNS', targetId: 'yz-beta' },
    ]);
  });
});

describe('buildReconciliationReport', () => {
  it('derives the structured report counts from a plan', async () => {
    const projection = await loadProjection({
      'a.md': document('yz-alpha', 'project', 'Alpha'),
    });
    const existing: ExistingGraphState = {
      nodes: [existingNode('yz-alpha', 'Alpha', 'project', { file_path: 'a.md' })],
      relationships: [],
    };

    const plan = planReconciliation(projection, existing);
    const report = buildReconciliationReport(plan, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.nodesProjected).toBe(1);
    expect(report.nodesCreated).toBe(0);
    expect(report.nodesUpdated).toBe(0);
    expect(report.nodesUnchanged).toBe(1);
    expect(report.nodesRemoved).toBe(0);
    expect(report.relationshipsProjected).toBe(0);
    expect(report.relationshipsMissingEndpoint).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('reports relationships missing an endpoint and surfaced errors', async () => {
    const projection = await loadProjection({});
    const plan = planReconciliation(projection, emptyExisting());
    const report = buildReconciliationReport(plan, {
      relationshipsMissingEndpoint: [{ sourceId: 'yz-a', type: 'OWNS', targetId: 'yz-b' }],
      errors: ['boom'],
    });

    expect(report.relationshipsMissingEndpoint).toEqual([
      { sourceId: 'yz-a', type: 'OWNS', targetId: 'yz-b' },
    ]);
    expect(report.errors).toEqual(['boom']);
  });
});