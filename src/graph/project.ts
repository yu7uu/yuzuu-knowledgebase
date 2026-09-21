import { isAbsolute, relative } from 'node:path';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import { RELATIONSHIP_TYPES } from '../knowledge/schema.ts';
import type { RelationshipType } from '../knowledge/schema.ts';
import { DuplicateKnowledgeItemIdError, InvalidRelationshipTypeError } from './errors.ts';
import type {
  KnowledgeGraphProjection,
  KnowledgeItemProjection,
  RelationshipProjection,
  UnresolvedRelationshipProjection,
} from './types.ts';

const RELATIONSHIP_TYPE_SET = new Set<string>(RELATIONSHIP_TYPES);

function isKnownRelationshipType(value: string): value is RelationshipType {
  return RELATIONSHIP_TYPE_SET.has(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRelationships(a: RelationshipProjection, b: RelationshipProjection): number {
  return (
    compareStrings(a.sourceId, b.sourceId) ||
    compareStrings(a.type, b.type) ||
    compareStrings(a.targetId, b.targetId)
  );
}

function repositoryRelativePath(filePath: string, repoRootPath: string): string {
  const rel = relative(repoRootPath, filePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return filePath;
  }
  return rel;
}

function projectNode(doc: KnowledgeDocument, repoRootPath: string): KnowledgeItemProjection {
  const m = doc.metadata;
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    status: m.status,
    created_at: m.created_at,
    updated_at: m.updated_at,
    source: m.source,
    confidence: m.confidence,
    file_path: repositoryRelativePath(doc.filePath, repoRootPath),
    ...(m.provenance?.source_session !== undefined
      ? { source_session: m.provenance.source_session }
      : {}),
    ...(m.provenance?.source_document !== undefined
      ? { source_document: m.provenance.source_document }
      : {}),
    ...(m.provenance?.source_reference !== undefined
      ? { source_reference: m.provenance.source_reference }
      : {}),
    ...(m.provenance?.author !== undefined ? { author: m.provenance.author } : {}),
    ...(m.approval?.status !== undefined ? { approval_status: m.approval.status } : {}),
    ...(m.approval?.approved_at !== undefined
      ? { approval_approved_at: m.approval.approved_at }
      : {}),
    ...(m.approval?.approved_by !== undefined
      ? { approval_approved_by: m.approval.approved_by }
      : {}),
  };
}

export function projectKnowledgeGraph(
  documents: readonly KnowledgeDocument[],
  repoRootPath: string,
): KnowledgeGraphProjection {
  const byId = new Map<string, KnowledgeDocument[]>();
  for (const doc of documents) {
    const existing = byId.get(doc.metadata.id);
    if (existing !== undefined) {
      existing.push(doc);
    } else {
      byId.set(doc.metadata.id, [doc]);
    }
  }
  for (const [id, docs] of byId) {
    if (docs.length > 1) {
      throw new DuplicateKnowledgeItemIdError(
        id,
        docs.map((doc) => doc.filePath),
      );
    }
  }

  const nodes = documents
    .map((doc) => projectNode(doc, repoRootPath))
    .sort((a, b) => compareStrings(a.id, b.id));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const relationships: RelationshipProjection[] = [];
  const unresolved: UnresolvedRelationshipProjection[] = [];

  for (const doc of documents) {
    for (const relationship of doc.metadata.relationships ?? []) {
      if (!isKnownRelationshipType(relationship.type)) {
        throw new InvalidRelationshipTypeError(
          relationship.type,
          doc.metadata.id,
          relationship.target,
        );
      }
      const edge: RelationshipProjection = {
        sourceId: doc.metadata.id,
        type: relationship.type,
        targetId: relationship.target,
      };
      if (nodeIds.has(relationship.target)) {
        relationships.push(edge);
      } else {
        unresolved.push(edge);
      }
    }
  }

  relationships.sort(compareRelationships);
  unresolved.sort(compareRelationships);

  return { nodes, relationships, unresolvedRelationships: unresolved };
}