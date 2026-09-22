import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Driver, Integer } from 'neo4j-driver';
import { loadKnowledgeFile } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import {
  applyKnowledgeGraphProjection,
  createNeo4jDriver,
  ensureKnowledgeGraphSchema,
  loadNeo4jConfig,
  projectKnowledgeGraph,
} from '../graph/index.ts';
import { FilesystemCanonicalKnowledgeReader, KnowledgeService, Neo4jGraphReader } from './index.ts';

const TEST_ID_PREFIX = 'yztknapi-';
const TS = '2026-09-15T00:00:00+05:30';

const configured =
  Boolean(process.env.NEO4J_URI) &&
  Boolean(process.env.NEO4J_USERNAME) &&
  Boolean(process.env.NEO4J_PASSWORD);

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

describe.skipIf(!configured)('Knowledge API Neo4j integration', () => {
  let driver: Driver;
  let root: string;
  let service: KnowledgeService;

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

    root = await mkdtemp(join(tmpdir(), 'yuzuu-api-integration-'));

    const fixtureFiles: Record<string, string> = {
      'yztknapi-a.md': document(
        'yztknapi-a',
        'project',
        'Alpha',
        'relationships:\n  - type: OWNS\n    target: yztknapi-b',
      ),
      'yztknapi-b.md': document('yztknapi-b', 'organization', 'Beta'),
    };

    const documents: KnowledgeDocument[] = [];
    for (const [name, contents] of Object.entries(fixtureFiles)) {
      const filePath = join(root, name);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
      documents.push(await loadKnowledgeFile(filePath));
    }

    const projection = projectKnowledgeGraph(documents, root);
    await applyKnowledgeGraphProjection(driver, projection);

    const canonical = new FilesystemCanonicalKnowledgeReader(root, root);
    service = new KnowledgeService(canonical, new Neo4jGraphReader(driver));
  });

  afterAll(async () => {
    if (service) {
      await service.close();
    }
    await cleanTestData();
    await rm(root, { recursive: true, force: true });
    await driver.close();
  });

  it('reads canonical items through the filesystem reader', async () => {
    const result = await service.getById('yztknapi-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Alpha');
    expect(result.value.type).toBe('project');
    expect(result.value.filePath).toBe('yztknapi-a.md');
  });

  it('traverses explicit graph relationships in both directions', async () => {
    const fromA = await service.getRelated('yztknapi-a');
    expect(fromA.ok).toBe(true);
    if (!fromA.ok) return;
    expect(fromA.value).toHaveLength(1);
    expect(fromA.value[0]).toMatchObject({
      id: 'yztknapi-b',
      title: 'Beta',
      type: 'organization',
      status: 'active',
      relationship: { sourceId: 'yztknapi-a', type: 'OWNS', targetId: 'yztknapi-b' },
      direction: 'outgoing',
    });

    const fromB = await service.getRelated('yztknapi-b');
    expect(fromB.ok).toBe(true);
    if (!fromB.ok) return;
    expect(fromB.value).toHaveLength(1);
    expect(fromB.value[0]).toMatchObject({
      id: 'yztknapi-a',
      title: 'Alpha',
      type: 'project',
      relationship: { sourceId: 'yztknapi-a', type: 'OWNS', targetId: 'yztknapi-b' },
      direction: 'incoming',
    });
  });

  it('finds canonical knowledge through search', async () => {
    const result = await service.search('Beta');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    expect(result.value.results[0]?.item.id).toBe('yztknapi-b');
  });

  it('leaves the canonical KnowledgeItem graph intact', async () => {
    expect(await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
      id: 'yz-studio',
    })).toBe('1');
  });

  it('does not return relationships to non-KnowledgeItem data', async () => {
    const session = driver.session();
    try {
      const source = await count('MATCH (i:KnowledgeItem { id: $id }) RETURN count(i) AS count', {
        id: 'yztknapi-a',
      });
      expect(source).toBe('1');
      // Seed an unrelated node + edge that the graph reader must never surface.
      await session.run('CREATE (u:YuzuuTestUnrelated { id: $id })', { id: `${TEST_ID_PREFIX}unrelated` });
      await session.run(
        'MATCH (a:KnowledgeItem { id: $sourceId }) MATCH (u:YuzuuTestUnrelated { id: $targetId }) MERGE (a)-[:TEST_KEEP]->(u)',
        { sourceId: 'yztknapi-a', targetId: `${TEST_ID_PREFIX}unrelated` },
      );
    } finally {
      await session.close();
    }

    const result = await service.getRelated('yztknapi-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.relationship.type).toBe('OWNS');
    expect(result.value[0]?.relationship.type).not.toBe('TEST_KEEP');
    expect(result.value.some((item) => item.id === `${TEST_ID_PREFIX}unrelated`)).toBe(false);
  });
});