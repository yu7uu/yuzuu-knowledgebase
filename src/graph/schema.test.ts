import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_ITEM_SCHEMA_STATEMENTS } from './index.ts';

describe('knowledge graph schema', () => {
  it('requires a unique id constraint on KnowledgeItem', () => {
    expect(KNOWLEDGE_ITEM_SCHEMA_STATEMENTS).toContain(
      'CREATE CONSTRAINT IF NOT EXISTS FOR (item:KnowledgeItem) REQUIRE item.id IS UNIQUE',
    );
  });

  it('is idempotent by construction with IF NOT EXISTS on every statement', () => {
    for (const statement of KNOWLEDGE_ITEM_SCHEMA_STATEMENTS) {
      expect(statement).toContain('IF NOT EXISTS');
      expect(statement).toMatch(/^CREATE (CONSTRAINT|INDEX)/);
    }
  });

  it('indexes the queryable metadata properties', () => {
    const statements = KNOWLEDGE_ITEM_SCHEMA_STATEMENTS.join('\n');
    for (const property of ['type', 'status', 'source', 'file_path']) {
      expect(statements).toMatch(new RegExp(`ON \\(item\\.${property}\\)`));
    }
  });
});