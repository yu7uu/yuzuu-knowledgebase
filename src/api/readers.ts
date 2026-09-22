import type { KnowledgeDocument } from '../knowledge/loader.ts';

/**
 * Storage boundary for canonical knowledge.
 *
 * The API/service layer depends on this interface instead of scattering
 * filesystem reads and parsing through operations. Documents returned by
 * implementers use a repository-relative `filePath`.
 */
export interface CanonicalKnowledgeReader {
  getById(id: string): Promise<KnowledgeDocument | undefined>;
  list(): Promise<KnowledgeDocument[]>;
  /** Invalidates any cached snapshot so subsequent reads rebuild from disk. */
  refresh(): void;
}

/**
 * A node in the Neo4j projection as returned by the graph reader. These are
 * plain application objects mirroring the projected `:KnowledgeItem`
 * properties; Neo4j records are never exposed to API callers.
 */
export interface GraphKnowledgeNode {
  id: string;
  type: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  source: string;
  confidence: string;
  file_path: string;
}

export interface GraphRelationship {
  type: string;
  source: GraphKnowledgeNode;
  target: GraphKnowledgeNode;
}

/**
 * Storage boundary for graph retrieval.
 *
 * Only explicit, projected relationships between `:KnowledgeItem` nodes are
 * returned; nothing is inferred from prose. Implementers own all Cypher and
 * driver access and must throw `GraphUnavailableError` when the graph cannot
 * be read.
 */
export interface GraphReader {
  getRelationshipsFor(id: string): Promise<GraphRelationship[]>;
}