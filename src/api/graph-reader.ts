import type { Driver } from 'neo4j-driver';
import { GraphUnavailableError, safeReason } from './errors.ts';
import type { GraphKnowledgeNode, GraphReader, GraphRelationship } from './readers.ts';

const RELATIONSHIPS_QUERY = `
  MATCH (source:KnowledgeItem)-[r]->(target:KnowledgeItem)
  WHERE source.id = $id OR target.id = $id
  RETURN source { .id, .type, .title, .status, .created_at, .updated_at, .source, .confidence, .file_path } AS source,
         target { .id, .type, .title, .status, .created_at, .updated_at, .source, .confidence, .file_path } AS target,
         type(r) AS relationshipType
  ORDER BY relationshipType, target.id, source.id
`;

function isGraphNode(value: unknown): value is GraphKnowledgeNode {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === 'string' &&
    typeof node.type === 'string' &&
    typeof node.title === 'string' &&
    typeof node.status === 'string' &&
    typeof node.created_at === 'string' &&
    typeof node.updated_at === 'string' &&
    typeof node.source === 'string' &&
    typeof node.confidence === 'string' &&
    typeof node.file_path === 'string'
  );
}

/**
 * Graph reader backed by the Neo4j projection. Read-only: it only runs a
 * scoped, parameterized relationship traversal against `:KnowledgeItem` nodes
 * and returns plain typed records. All driver failures become
 * `GraphUnavailableError`; driver internals are never exposed.
 */
export class Neo4jGraphReader implements GraphReader {
  private readonly driver: Driver;

  constructor(driver: Driver) {
    this.driver = driver;
  }

  async getRelationshipsFor(id: string): Promise<GraphRelationship[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(RELATIONSHIPS_QUERY, { id });
      const relationships: GraphRelationship[] = [];
      for (const record of result.records) {
        const source = record.get('source');
        const target = record.get('target');
        const type = record.get('relationshipType');
        if (!isGraphNode(source) || !isGraphNode(target) || typeof type !== 'string') {
          throw new GraphUnavailableError('malformed graph projection');
        }
        relationships.push({ type, source, target });
      }
      return relationships;
    } catch (error) {
      if (error instanceof GraphUnavailableError) {
        throw error;
      }
      throw new GraphUnavailableError(safeReason(error));
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * Placeholder graph reader used when Neo4j is not configured. Every traversal
 * reports the graph as unavailable so callers receive a typed result instead
 * of a runtime crash.
 */
export class UnavailableGraphReader implements GraphReader {
  async getRelationshipsFor(_id: string): Promise<GraphRelationship[]> {
    throw new GraphUnavailableError('Neo4j is not configured');
  }
}