import type { Driver } from 'neo4j-driver';

export const KNOWLEDGE_ITEM_SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT IF NOT EXISTS FOR (item:KnowledgeItem) REQUIRE item.id IS UNIQUE',
  'CREATE INDEX IF NOT EXISTS FOR (item:KnowledgeItem) ON (item.type)',
  'CREATE INDEX IF NOT EXISTS FOR (item:KnowledgeItem) ON (item.status)',
  'CREATE INDEX IF NOT EXISTS FOR (item:KnowledgeItem) ON (item.source)',
  'CREATE INDEX IF NOT EXISTS FOR (item:KnowledgeItem) ON (item.file_path)',
] as const;

export async function ensureKnowledgeGraphSchema(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of KNOWLEDGE_ITEM_SCHEMA_STATEMENTS) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}