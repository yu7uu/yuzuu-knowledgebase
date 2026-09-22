import { isInt } from 'neo4j-driver';
import type { Driver, Result, Transaction } from 'neo4j-driver';
import { RELATIONSHIP_TYPES } from '../knowledge/schema.ts';
import { InvalidRelationshipTypeError } from './errors.ts';
import type {
  GraphProjection,
  KnowledgeItemProjection,
  RelationshipProjection,
  UnresolvedRelationshipProjection,
} from './types.ts';

const KNOWN_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES);
const ID_SEPARATOR = '\u0000';

// --- Existing graph state (read from Neo4j, scoped to :KnowledgeItem only) ---

export interface ExistingKnowledgeItemState {
  id: string;
  properties: Record<string, string>;
}

export interface ExistingKnowledgeRelationshipState {
  sourceId: string;
  type: string;
  targetId: string;
}

export interface ExistingGraphState {
  nodes: ExistingKnowledgeItemState[];
  relationships: ExistingKnowledgeRelationshipState[];
}

// --- Pure reconciliation plan (desired vs existing, computed in TypeScript) ---

export interface KnowledgeItemUpdate {
  id: string;
  properties: Record<string, string>;
  removeKeys: string[];
}

export interface ReconciliationPlan {
  desiredNodes: KnowledgeItemProjection[];
  desiredRelationships: RelationshipProjection[];
  unresolvedRelationships: UnresolvedRelationshipProjection[];
  nodesToCreate: KnowledgeItemProjection[];
  nodesToUpdate: KnowledgeItemUpdate[];
  nodesUnchanged: string[];
  nodesToDelete: string[];
  relationshipsToCreate: RelationshipProjection[];
  relationshipsToDelete: ExistingKnowledgeRelationshipState[];
  relationshipsUnchanged: ExistingKnowledgeRelationshipState[];
}

export interface ReconciliationReport {
  dryRun: boolean;
  nodesProjected: number;
  nodesCreated: number;
  nodesUpdated: number;
  nodesUnchanged: number;
  nodesRemoved: number;
  relationshipsProjected: number;
  relationshipsCreated: number;
  relationshipsRemoved: number;
  relationshipsUnchanged: number;
  unresolvedRelationships: UnresolvedRelationshipProjection[];
  relationshipsMissingEndpoint: UnresolvedRelationshipProjection[];
  errors: string[];
}

export interface ReconcileOptions {
  dryRun?: boolean;
}

// A minimal query runner accepted by readExistingGraphState.
// Both neo4j-driver `Session` and `Transaction` satisfy it.
export interface QueryExecutor {
  run(query: string, parameters?: Record<string, unknown>): Result;
}

// --- Cypher statements (relationship types are never interpolated for deletes) ---

const READ_NODES = `
  MATCH (item:KnowledgeItem)
  RETURN item.id AS id, properties(item) AS properties
  ORDER BY item.id
`;

const READ_RELATIONSHIPS = `
  MATCH (source:KnowledgeItem)-[r]->(target:KnowledgeItem)
  RETURN source.id AS sourceId, type(r) AS type, target.id AS targetId
  ORDER BY sourceId, type, targetId
`;

const NODE_RECONCILE = `
  MERGE (item:KnowledgeItem { id: $id })
  SET item += $properties
  WITH item
  FOREACH (removeKey IN $removeKeys | REMOVE item[removeKey])
  RETURN item.id AS id
`;

const EDGE_CREATE = (type: string) => `
  MATCH (source:KnowledgeItem { id: $sourceId })
  MATCH (target:KnowledgeItem { id: $targetId })
  MERGE (source)-[r:${type}]->(target)
  RETURN r
`;

const RELATIONSHIP_DELETE = `
  MATCH (source:KnowledgeItem { id: $sourceId })-[r]->(target:KnowledgeItem { id: $targetId })
  WHERE type(r) = $type
  DELETE r
`;

const NODE_DELETE = `
  MATCH (item:KnowledgeItem { id: $id })
  DELETE item
`;

// --- Helpers ---

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nodePropertyMap(node: KnowledgeItemProjection): Record<string, string> {
  const { id: _ignored, ...rest } = node;
  return rest;
}

function propertyValueToString(value: unknown): string {
  if (isInt(value)) return value.toString();
  if (typeof value === 'string') return value;
  return String(value);
}

function normalizeExistingNodeProperties(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'id') continue;
    out[key] = propertyValueToString(value);
  }
  return out;
}

function edgeKey(sourceId: string, type: string, targetId: string): string {
  return `${sourceId}${ID_SEPARATOR}${type}${ID_SEPARATOR}${targetId}`;
}

function nodePropertiesEqual(
  desired: KnowledgeItemProjection,
  current: ExistingKnowledgeItemState,
): boolean {
  const desiredProps = nodePropertyMap(desired);
  const desiredKeys = Object.keys(desiredProps).sort(compareStrings);
  const currentKeys = Object.keys(current.properties).sort(compareStrings);
  if (desiredKeys.length !== currentKeys.length) {
    return false;
  }
  for (const key of desiredKeys) {
    if (desiredProps[key] !== current.properties[key]) {
      return false;
    }
  }
  return true;
}

function updateFor(
  desired: KnowledgeItemProjection,
  current: ExistingKnowledgeItemState,
): KnowledgeItemUpdate {
  const properties = nodePropertyMap(desired);
  const removeKeys = Object.keys(current.properties)
    .filter((key) => !Object.hasOwn(properties, key))
    .sort(compareStrings);
  return { id: desired.id, properties, removeKeys };
}

function sortRelationships<T extends { sourceId: string; type: string; targetId: string }>(
  edges: readonly T[],
): T[] {
  return [...edges].sort(
    (a, b) =>
      compareStrings(a.sourceId, b.sourceId) ||
      compareStrings(a.type, b.type) ||
      compareStrings(a.targetId, b.targetId),
  );
}

// --- Reading the current :KnowledgeItem-derived state ---

export async function readExistingGraphState(executor: QueryExecutor): Promise<ExistingGraphState> {
  const nodeResult = await executor.run(READ_NODES);
  const relationshipResult = await executor.run(READ_RELATIONSHIPS);

  const nodes: ExistingKnowledgeItemState[] = nodeResult.records.map((record) => ({
    id: record.get('id') as string,
    properties: normalizeExistingNodeProperties(
      record.get('properties') as Record<string, unknown>,
    ),
  }));
  const relationships: ExistingKnowledgeRelationshipState[] = relationshipResult.records.map(
    (record) => ({
      sourceId: record.get('sourceId') as string,
      type: record.get('type') as string,
      targetId: record.get('targetId') as string,
    }),
  );

  return { nodes, relationships };
}

// --- Pure planning ---

export function planReconciliation(
  projection: GraphProjection,
  existing: ExistingGraphState,
): ReconciliationPlan {
  const desiredNodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const existingNodesById = new Map(existing.nodes.map((node) => [node.id, node]));

  const nodesToCreate: KnowledgeItemProjection[] = [];
  const nodesToUpdate: KnowledgeItemUpdate[] = [];
  const nodesUnchanged: string[] = [];

  for (const [id, desired] of desiredNodesById) {
    const current = existingNodesById.get(id);
    if (current === undefined) {
      nodesToCreate.push(desired);
    } else if (nodePropertiesEqual(desired, current)) {
      nodesUnchanged.push(id);
    } else {
      nodesToUpdate.push(updateFor(desired, current));
    }
  }

  const desiredNodeIds = new Set(desiredNodesById.keys());
  const nodesToDelete = existing.nodes
    .map((node) => node.id)
    .filter((id) => !desiredNodeIds.has(id))
    .sort(compareStrings);

  // relationship diff
  const existingEdgeIndex = new Map<string, ExistingKnowledgeRelationshipState>();
  for (const edge of existing.relationships) {
    existingEdgeIndex.set(edgeKey(edge.sourceId, edge.type, edge.targetId), edge);
  }

  const relationshipsToCreate: RelationshipProjection[] = [];
  const relationshipsUnchanged: ExistingKnowledgeRelationshipState[] = [];
  for (const edge of projection.relationships) {
    const key = edgeKey(edge.sourceId, edge.type, edge.targetId);
    const match = existingEdgeIndex.get(key);
    if (match === undefined) {
      relationshipsToCreate.push(edge);
    } else {
      relationshipsUnchanged.push(match);
      existingEdgeIndex.delete(key);
    }
  }
  const relationshipsToDelete = sortRelationships([...existingEdgeIndex.values()]);

  return {
    desiredNodes: [...projection.nodes],
    desiredRelationships: [...projection.relationships],
    unresolvedRelationships: [...projection.unresolvedRelationships],
    nodesToCreate,
    nodesToUpdate,
    nodesUnchanged: nodesUnchanged.sort(compareStrings),
    nodesToDelete,
    relationshipsToCreate,
    relationshipsToDelete,
    relationshipsUnchanged: sortRelationships(relationshipsUnchanged),
  };
}

export interface ReconciliationReportOptions {
  dryRun?: boolean;
  relationshipsMissingEndpoint?: readonly UnresolvedRelationshipProjection[];
  errors?: readonly string[];
}

export function buildReconciliationReport(
  plan: ReconciliationPlan,
  options: ReconciliationReportOptions = {},
): ReconciliationReport {
  return {
    dryRun: options.dryRun ?? false,
    nodesProjected: plan.desiredNodes.length,
    nodesCreated: plan.nodesToCreate.length,
    nodesUpdated: plan.nodesToUpdate.length,
    nodesUnchanged: plan.nodesUnchanged.length,
    nodesRemoved: plan.nodesToDelete.length,
    relationshipsProjected: plan.desiredRelationships.length,
    relationshipsCreated: plan.relationshipsToCreate.length,
    relationshipsRemoved: plan.relationshipsToDelete.length,
    relationshipsUnchanged: plan.relationshipsUnchanged.length,
    unresolvedRelationships: [...plan.unresolvedRelationships],
    relationshipsMissingEndpoint: [...(options.relationshipsMissingEndpoint ?? [])],
    errors: [...(options.errors ?? [])],
  };
}

async function rollbackIfActive(tx: Transaction): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    // transaction already closed; nothing to roll back
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Neo4j reconciliation executor ---

// Semantics: the canonical projection IS the complete desired state. Nodes and
// explicit relationships absent from it are removed; everything present is
// ensured exactly. The write phase runs in a single transaction so a failed
// reconciliation cannot leave the graph half-applied.
//
// Safety: the read scope (and therefore every delete target) is limited to
// `:KnowledgeItem`. Stale KnowledgeItem->KnowledgeItem relationships are
// removed first, and stale nodes are then deleted with a scoped `DELETE` (no
// DETACH). If a stale `:KnowledgeItem` node still has a relationship to
// non-KnowledgeItem data, the `DELETE` fails, the transaction rolls back, and
// the reconciliation reports an error instead of destroying unrelated data.
export async function reconcileKnowledgeGraph(
  driver: Driver,
  projection: GraphProjection,
  options: ReconcileOptions = {},
): Promise<ReconciliationReport> {
  const session = driver.session();

  if (options.dryRun === true) {
    try {
      const existing = await readExistingGraphState(session);
      const plan = planReconciliation(projection, existing);
      return buildReconciliationReport(plan, { dryRun: true });
    } finally {
      await session.close();
    }
  }

  let plan: ReconciliationPlan | undefined;
  const missingEndpoints: UnresolvedRelationshipProjection[] = [];
  const tx = await session.beginTransaction();
  try {
    const existing = await readExistingGraphState(tx);
    plan = planReconciliation(projection, existing);

    for (const node of plan.nodesToCreate) {
      await tx.run(NODE_RECONCILE, {
        id: node.id,
        properties: nodePropertyMap(node),
        removeKeys: [],
      });
    }
    for (const update of plan.nodesToUpdate) {
      await tx.run(NODE_RECONCILE, {
        id: update.id,
        properties: update.properties,
        removeKeys: update.removeKeys,
      });
    }
    for (const edge of plan.relationshipsToCreate) {
      if (!KNOWN_RELATIONSHIP_TYPES.has(edge.type)) {
        throw new InvalidRelationshipTypeError(edge.type, edge.sourceId, edge.targetId);
      }
      const result = await tx.run(EDGE_CREATE(edge.type), {
        sourceId: edge.sourceId,
        targetId: edge.targetId,
      });
      if (result.records.length === 0) {
        missingEndpoints.push(edge);
      }
    }
    for (const edge of plan.relationshipsToDelete) {
      await tx.run(RELATIONSHIP_DELETE, {
        sourceId: edge.sourceId,
        type: edge.type,
        targetId: edge.targetId,
      });
    }
    for (const id of plan.nodesToDelete) {
      await tx.run(NODE_DELETE, { id });
    }

    await tx.commit();
    return buildReconciliationReport(plan, { relationshipsMissingEndpoint: missingEndpoints });
  } catch (error) {
    await rollbackIfActive(tx);
    if (plan === undefined) {
      throw error;
    }
    return buildReconciliationReport(plan, {
      relationshipsMissingEndpoint: missingEndpoints,
      errors: [errorMessage(error)],
    });
  } finally {
    await session.close();
  }
}