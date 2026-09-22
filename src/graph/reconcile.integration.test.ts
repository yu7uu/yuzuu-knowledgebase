import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Driver, Integer } from 'neo4j-driver';
import { discoverKnowledgeFiles, loadKnowledgeFile } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import {
  createNeo4jDriver,
  ensureKnowledgeGraphSchema,
  loadNeo4jConfig,
  projectKnowledgeGraph,
  reconcileKnowledgeGraph,
} from './index.ts';
import type { GraphProjection } from './index.ts';

const TEST_ID_PREFIX = 'yztkn-';
const TS = '2026-09-15T00:00:00+05:30';

const configured =
  Boolean(process.env.NEO4J_URI) &&
  Boolean(process.env.NEO4J_USERNAME) &&
  Boolean(process.env.NEO4J_PASSWORD);

// Reconcile is a full-project reconciliation: the projected documents ARE the
// complete desired state. To test it against the live database without ever
// endangering real canonical data, each desired projection below is the union
// of the real canonical repository plus isolated temporary fixture documents.
describe.skipIf(!configured)('Neo4j full reconciliation integration', () => {
  let driver: Driver;
  let tmpDir: string;
  let repoRoot: string;
  let realDocuments: KnowledgeDocument[];

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

  async function loadProjection(fixtures: Record<string, string>): Promise<GraphProjection> {
    const fixtureDocs: KnowledgeDocument[] = [];
    for (const [name, contents] of Object.entries(fixtures)) {
      const filePath = join(tmpDir, name);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
      fixtureDocs.push(await loadKnowledgeFile(filePath));
    }
    return projectKnowledgeGraph([...realDocuments, ...fixtureDocs], repoRoot);
  }

  async function count(cypher: string, params: Record<string, unknown> = {}): Promise<string> {
    const session = driver.session();
    try {
      const result = await session.run(cypher, params);
      const value = result.records[0]?.get('count') as Integer;
      return value.toString();
    } finally {
      await session.close();
    }
  }

  async function cleanTestData(): Promise<void> {
    const session = driver.session();
    try {
      await session.run('MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n', {
        prefix: TEST_ID_PREFIX,
      });
    } finally {
      await session.close();
    }
  }

  beforeAll(async () => {
    driver = createNeo4jDriver(loadNeo4jConfig());
    await ensureKnowledgeGraphSchema(driver);
    repoRoot = resolve(process.cwd());
    const canonicalPaths = await discoverKnowledgeFiles(resolve(repoRoot, 'knowledge'));
    realDocuments = [];
    for (const filePath of canonicalPaths) {
      realDocuments.push(await loadKnowledgeFile(filePath));
    }
    tmpDir = await mkdtemp(join(tmpdir(), 'yuzuu-reconcile-integration-'));
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await rm(tmpDir, { recursive: true, force: true });
    await driver.close();
  });

  it('reconciles a full projection, is idempotent, and preserves unrelated data', async () => {
    const projectionWithStale = await loadProjection({
      'a.md': document(
        'yztkn-a',
        'project',
        'Alpha',
        'relationships:\n  - type: OWNS\n    target: yztkn-b\n  - type: USES\n    target: yztkn-stale',
      ),
      'b.md': document('yztkn-b', 'organization', 'Beta'),
      'stale.md': document('yztkn-stale', 'concept', 'Stale'),
    });

    // Baseline: bring the graph in line with the union projection.
    const baselineRun = await reconcileKnowledgeGraph(driver, projectionWithStale);
    expect(baselineRun.errors).toEqual([]);

    // Initial projection exists: fixture nodes and edge present.
    expect(await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yztkn-a',
    })).toBe('1');
    expect(await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yztkn-stale',
    })).toBe('1');
    expect(
      await count(
        'MATCH (:KnowledgeItem { id: $sourceId })-[r:OWNS]->(:KnowledgeItem { id: $targetId }) RETURN count(r) AS count',
        { sourceId: 'yztkn-a', targetId: 'yztkn-b' },
      ),
    ).toBe('1');

    // Unrelated non-KnowledgeItem data is created for later preservation checks.
    {
      const session = driver.session();
      try {
        await session.run('CREATE (u:YuzuuTestUnrelated { id: $id, note: "keep-me" })', {
          id: `${TEST_ID_PREFIX}unrelated`,
        });
        await session.run(
          'MATCH (a:KnowledgeItem { id: $sourceId }) MATCH (u:YuzuuTestUnrelated { id: $targetId }) MERGE (a)-[:TEST_KEEP]->(u)',
          { sourceId: 'yztkn-a', targetId: `${TEST_ID_PREFIX}unrelated` },
        );
      } finally {
        await session.close();
      }
    }

    // Reconciliation is idempotent against an identical projection.
    const secondRun = await reconcileKnowledgeGraph(driver, projectionWithStale);
    expect(secondRun.nodesCreated).toBe(0);
    expect(secondRun.nodesUpdated).toBe(0);
    expect(secondRun.nodesRemoved).toBe(0);
    expect(secondRun.relationshipsCreated).toBe(0);
    expect(secondRun.relationshipsRemoved).toBe(0);

    // Canonical changes: stale item removed, USES edge dropped, title updated.
    const projectionWithoutStale = await loadProjection({
      'a.md': document(
        'yztkn-a',
        'project',
        'Alpha v2',
        'relationships:\n  - type: OWNS\n    target: yztkn-b',
      ),
      'b.md': document('yztkn-b', 'organization', 'Beta'),
    });

    const thirdRun = await reconcileKnowledgeGraph(driver, projectionWithoutStale);
    expect(thirdRun.nodesCreated).toBe(0);
    expect(thirdRun.nodesUpdated).toBe(1);
    expect(thirdRun.nodesRemoved).toBe(1);
    expect(thirdRun.relationshipsCreated).toBe(0);
    expect(thirdRun.relationshipsRemoved).toBe(1);
    expect(thirdRun.errors).toEqual([]);

    // Stale KnowledgeItem node is gone.
    expect(await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yztkn-stale',
    })).toBe('0');

    // Stale KnowledgeItem->KnowledgeItem relationship is gone.
    expect(
      await count(
        'MATCH (:KnowledgeItem { id: $sourceId })-[r:USES]->(:KnowledgeItem { id: $targetId }) RETURN count(r) AS count',
        { sourceId: 'yztkn-a', targetId: 'yztkn-stale' },
      ),
    ).toBe('0');

    // The still-canonical relationship and updated node properties remain.
    expect(
      await count(
        'MATCH (:KnowledgeItem { id: $sourceId })-[r:OWNS]->(:KnowledgeItem { id: $targetId }) RETURN count(r) AS count',
        { sourceId: 'yztkn-a', targetId: 'yztkn-b' },
      ),
    ).toBe('1');

    const session = driver.session();
    try {
      const props = await session.run('MATCH (i:KnowledgeItem { id: $id }) RETURN i AS item', {
        id: 'yztkn-a',
      });
      const node = props.records[0]?.get('item') as
        | { properties: Record<string, unknown> }
        | undefined;
      expect(node?.properties.title).toBe('Alpha v2');

      // Unrelated non-KnowledgeItem node and its relationship survive.
      expect(
        await count('MATCH (u:YuzuuTestUnrelated { id: $id }) RETURN count(u) AS count', {
          id: `${TEST_ID_PREFIX}unrelated`,
        }),
      ).toBe('1');
      expect(
        await count(
          'MATCH (:KnowledgeItem { id: $sourceId })-[r:TEST_KEEP]->(:YuzuuTestUnrelated { id: $targetId }) RETURN count(r) AS count',
          { sourceId: 'yztkn-a', targetId: `${TEST_ID_PREFIX}unrelated` },
        ),
      ).toBe('1');

      // Real canonical KnowledgeItem is never treated as stale.
      expect(await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
        id: 'yz-studio',
      })).toBe('1');
    } finally {
      await session.close();
    }

    // Second reconciliation of the same projection produces no changes.
    const fourthRun = await reconcileKnowledgeGraph(driver, projectionWithoutStale);
    expect(fourthRun.nodesCreated).toBe(0);
    expect(fourthRun.nodesUpdated).toBe(0);
    expect(fourthRun.nodesRemoved).toBe(0);
    expect(fourthRun.relationshipsCreated).toBe(0);
    expect(fourthRun.relationshipsRemoved).toBe(0);
    expect(fourthRun.errors).toEqual([]);

    // Dry run with no drift plans nothing and writes nothing.
    const beforeDryRun = await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yztkn-a',
    });
    const dryRun = await reconcileKnowledgeGraph(driver, projectionWithoutStale, {
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.nodesCreated).toBe(0);
    expect(dryRun.nodesUpdated).toBe(0);
    expect(dryRun.nodesRemoved).toBe(0);
    expect(dryRun.relationshipsRemoved).toBe(0);
    const afterDryRun = await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yztkn-a',
    });
    expect(afterDryRun).toBe(beforeDryRun);
  });
});