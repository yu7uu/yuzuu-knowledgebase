import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import type { Driver } from 'neo4j-driver';
import type { Integer } from 'neo4j-driver';
import { loadKnowledgeFile } from '../knowledge/index.ts';
import {
  applyKnowledgeGraphProjection,
  createNeo4jDriver,
  ensureKnowledgeGraphSchema,
  loadNeo4jConfig,
  projectKnowledgeGraph,
} from './index.ts';

const configured =
  Boolean(process.env.NEO4J_URI) &&
  Boolean(process.env.NEO4J_USERNAME) &&
  Boolean(process.env.NEO4J_PASSWORD);

describe.skipIf(!configured)('Neo4j knowledge graph integration', () => {
  let driver: Driver;

  beforeAll(() => {
    driver = createNeo4jDriver(loadNeo4jConfig());
  });

  afterAll(async () => {
    await driver.close();
  });

  it('initializes the schema idempotently', async () => {
    await ensureKnowledgeGraphSchema(driver);
    await expect(ensureKnowledgeGraphSchema(driver)).resolves.toBeUndefined();
  });

  it('syncs the yuzuu-studio item and is repeatable', async () => {
    const repoRoot = resolve(process.cwd());
    const doc = await loadKnowledgeFile(resolve(repoRoot, 'knowledge/core/yuzuu-studio.md'));
    const projection = projectKnowledgeGraph([doc], repoRoot);

    await ensureKnowledgeGraphSchema(driver);
    const first = await applyKnowledgeGraphProjection(driver, projection);
    const second = await applyKnowledgeGraphProjection(driver, projection);

    expect(second.nodesCreated).toBe(0);

    const session = driver.session();
    try {
      const counts = await session.run(
        'MATCH (item:KnowledgeItem { id: $id }) RETURN count(item) AS count',
        { id: 'yz-studio' },
      );
      const count = counts.records[0]?.get('count') as Integer | undefined;
      expect(count?.toString()).toBe('1');

      const props = await session.run(
        'MATCH (item:KnowledgeItem { id: $id }) RETURN item AS item',
        { id: 'yz-studio' },
      );
      const node = props.records[0]?.get('item') as
        | { properties: Record<string, unknown> }
        | undefined;
      expect(node?.properties).toEqual(
        expect.objectContaining({
          id: 'yz-studio',
          type: 'organization',
          title: 'Yuzuu Studio',
          status: 'active',
          source: 'manual',
          confidence: 'high',
          file_path: 'knowledge/core/yuzuu-studio.md',
        }),
      );

      const rels = await session.run(
        'MATCH (:KnowledgeItem { id: $id })-[r]->() RETURN count(r) AS count',
        { id: 'yz-studio' },
      );
      const relCount = rels.records[0]?.get('count') as Integer | undefined;
      expect(relCount?.toString()).toBe('0');
    } finally {
      await session.close();
    }
  });
});