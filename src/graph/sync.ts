import type { Driver } from 'neo4j-driver';
import { RELATIONSHIP_TYPES } from '../knowledge/schema.ts';
import { InvalidRelationshipTypeError } from './errors.ts';
import type {
  GraphSyncReport,
  KnowledgeGraphProjection,
  KnowledgeItemProjection,
  UnresolvedRelationshipProjection,
} from './types.ts';

const KNOWN_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES);

const NODE_UPSERT = `
  MERGE (item:KnowledgeItem { id: $id })
  SET item += $properties
  RETURN item.id AS id
`;

const EDGE_UPSERT = (type: string) => `
  MATCH (source:KnowledgeItem { id: $sourceId })
  MATCH (target:KnowledgeItem { id: $targetId })
  MERGE (source)-[r:${type}]->(target)
  RETURN r
`;

function nodeProperties(node: KnowledgeItemProjection): Record<string, string> {
  const { id: _ignored, ...rest } = node;
  return rest;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function applyKnowledgeGraphProjection(
  driver: Driver,
  projection: KnowledgeGraphProjection,
): Promise<GraphSyncReport> {
  const session = driver.session();
  const errors: string[] = [];
  let nodesCreated = 0;
  let relationshipsCreated = 0;
  const missingEndpoints: UnresolvedRelationshipProjection[] = [];

  try {
    for (const node of projection.nodes) {
      try {
        const result = await session.run(NODE_UPSERT, {
          id: node.id,
          properties: nodeProperties(node),
        });
        nodesCreated += result.summary.counters.updates().nodesCreated;
      } catch (error) {
        errors.push(`node "${node.id}": ${errorMessage(error)}`);
      }
    }

    for (const edge of projection.relationships) {
      if (!KNOWN_RELATIONSHIP_TYPES.has(edge.type)) {
        throw new InvalidRelationshipTypeError(edge.type, edge.sourceId, edge.targetId);
      }
      try {
        const result = await session.run(EDGE_UPSERT(edge.type), {
          sourceId: edge.sourceId,
          targetId: edge.targetId,
        });
        if (result.records.length === 0) {
          missingEndpoints.push(edge);
        } else {
          relationshipsCreated += result.summary.counters.updates().relationshipsCreated;
        }
      } catch (error) {
        errors.push(
          `relationship ${edge.sourceId} -[${edge.type}]-> ${edge.targetId}: ${errorMessage(error)}`,
        );
      }
    }
  } finally {
    await session.close();
  }

  return {
    nodesProjected: projection.nodes.length,
    nodesCreated,
    relationshipsProjected: projection.relationships.length,
    relationshipsCreated,
    relationshipsMissingEndpoint: missingEndpoints,
    unresolvedRelationships: [...projection.unresolvedRelationships],
    errors,
  };
}