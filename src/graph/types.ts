import type {
  KnowledgeApproval,
  KnowledgeConfidence,
  KnowledgeSource,
  KnowledgeStatus,
  KnowledgeType,
  RelationshipType,
} from '../knowledge/schema.ts';

export interface KnowledgeItemProjection {
  id: string;
  type: KnowledgeType;
  title: string;
  status: KnowledgeStatus;
  created_at: string;
  updated_at: string;
  source: KnowledgeSource;
  confidence: KnowledgeConfidence;
  file_path: string;
  source_session?: string;
  source_document?: string;
  source_reference?: string;
  author?: string;
  approval_status?: KnowledgeApproval['status'];
  approval_approved_at?: string;
  approval_approved_by?: string;
}

export interface RelationshipProjection {
  sourceId: string;
  type: RelationshipType;
  targetId: string;
}

export interface UnresolvedRelationshipProjection {
  sourceId: string;
  type: RelationshipType;
  targetId: string;
}

export interface KnowledgeGraphProjection {
  nodes: KnowledgeItemProjection[];
  relationships: RelationshipProjection[];
  unresolvedRelationships: UnresolvedRelationshipProjection[];
}

export interface GraphSyncReport {
  nodesProjected: number;
  nodesCreated: number;
  relationshipsProjected: number;
  relationshipsCreated: number;
  relationshipsMissingEndpoint: UnresolvedRelationshipProjection[];
  unresolvedRelationships: UnresolvedRelationshipProjection[];
  errors: string[];
}