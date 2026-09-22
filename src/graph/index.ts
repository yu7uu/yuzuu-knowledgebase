export { createNeo4jDriver, loadNeo4jConfig } from './config.ts';
export type { Neo4jConnectionConfig, Environment } from './config.ts';
export {
  DuplicateKnowledgeItemIdError,
  InvalidRelationshipTypeError,
  Neo4jConfigurationError,
} from './errors.ts';
export { projectKnowledgeGraph } from './project.ts';
export {
  buildReconciliationReport,
  planReconciliation,
  readExistingGraphState,
  reconcileKnowledgeGraph,
} from './reconcile.ts';
export type {
  ExistingGraphState,
  ExistingKnowledgeItemState,
  ExistingKnowledgeRelationshipState,
  KnowledgeItemUpdate,
  QueryExecutor,
  ReconcileOptions,
  ReconciliationPlan,
  ReconciliationReport,
  ReconciliationReportOptions,
} from './reconcile.ts';
export { KNOWLEDGE_ITEM_SCHEMA_STATEMENTS, ensureKnowledgeGraphSchema } from './schema.ts';
export { applyKnowledgeGraphProjection } from './sync.ts';
export type {
  GraphProjection,
  GraphSyncReport,
  KnowledgeGraphProjection,
  KnowledgeItemProjection,
  RelationshipProjection,
  UnresolvedRelationshipProjection,
} from './types.ts';