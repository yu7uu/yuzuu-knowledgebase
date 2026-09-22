import type {
  KnowledgeMetadata,
  KnowledgeType,
  RelationshipType,
} from '../knowledge/schema.ts';

/**
 * Application-level representation of a canonical Knowledge Item.
 *
 * Reuses the canonical metadata schema verbatim (no competing schema) and adds
 * the canonical Markdown body plus a repository-relative file path for
 * traceability. Neo4j driver objects and raw graph records are never exposed.
 */
export type KnowledgeItem = KnowledgeMetadata & {
  body: string;
  filePath: string;
};

export interface KnowledgeItemSummary {
  id: string;
  type: KnowledgeType;
  title: string;
  status: KnowledgeItem['status'];
  created_at: string;
  updated_at: string;
  source: KnowledgeItem['source'];
  confidence: KnowledgeItem['confidence'];
  filePath: string;
}

export type RelationshipDirection = 'outgoing' | 'incoming';

export interface Relationship {
  sourceId: string;
  type: RelationshipType;
  targetId: string;
}

export interface RelatedKnowledgeItem extends KnowledgeItemSummary {
  relationship: Relationship;
  direction: RelationshipDirection;
}

export const SEARCH_FIELDS = [
  'id',
  'type',
  'title',
  'status',
  'source',
  'confidence',
  'body',
] as const;

export type SearchField = (typeof SEARCH_FIELDS)[number];

export const SEARCH_STRATEGIES = ['lexical-v1'] as const;

/**
 * The current search strategy. This milestone implements deterministic lexical
 * search over canonical metadata and body. Later milestones may extend this
 * with a hybrid (lexical + semantic) strategy.
 */
export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number];

export interface SearchResult {
  item: KnowledgeItemSummary;
  score: number;
  matchedFields: SearchField[];
  matchedTerms: string[];
}

export interface SearchResponse {
  query: string;
  strategy: SearchStrategy;
  total: number;
  results: SearchResult[];
}

export interface SearchOptions {
  limit?: number;
}

/** A canonical Knowledge Item whose type is guaranteed to be `project`. */
export type ProjectKnowledgeItem = KnowledgeItem & { type: 'project' };

/** A canonical Knowledge Item whose type is guaranteed to be `decision`. */
export type DecisionKnowledgeItem = KnowledgeItem & { type: 'decision' };

export interface CurrentStateView {
  item: KnowledgeItem;
  stateItemCount: number;
}