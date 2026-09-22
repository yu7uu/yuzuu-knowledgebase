export { FilesystemCanonicalKnowledgeReader } from './canonical-reader.ts';
export {
  GraphUnavailableError,
  KNOWLEDGE_API_ERROR_CODES,
  RepositoryLoadError,
  knowledgeFail,
  knowledgeFailFromError,
  knowledgeOk,
} from './errors.ts';
export type {
  KnowledgeApiError,
  KnowledgeApiErrorCode,
  KnowledgeApiResult,
} from './errors.ts';
export { createKnowledgeService } from './factory.ts';
export type { CreateKnowledgeServiceOptions } from './factory.ts';
export { Neo4jGraphReader, UnavailableGraphReader } from './graph-reader.ts';
export type { CanonicalKnowledgeReader, GraphKnowledgeNode, GraphReader, GraphRelationship } from './readers.ts';
export { KnowledgeService } from './service.ts';
export { SEARCH_FIELDS, SEARCH_STRATEGIES } from './types.ts';
export type {
  CurrentStateView,
  DecisionKnowledgeItem,
  KnowledgeItem,
  KnowledgeItemSummary,
  ProjectKnowledgeItem,
  RelatedKnowledgeItem,
  Relationship,
  RelationshipDirection,
  SearchField,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchStrategy,
} from './types.ts';