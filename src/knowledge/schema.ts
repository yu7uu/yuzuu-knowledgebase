import { z } from 'zod';

export const KNOWLEDGE_TYPES = [
  'organization',
  'brand',
  'product',
  'service',
  'project',
  'decision',
  'goal',
  'task',
  'concept',
  'research',
  'document',
  'session',
  'state',
] as const;

export const KNOWLEDGE_STATUSES = [
  'proposed',
  'active',
  'deprecated',
  'superseded',
  'rejected',
  'archived',
] as const;

export const KNOWLEDGE_SOURCES = [
  'manual',
  'chatgpt',
  'claude',
  'claude-code',
  'uploaded_document',
  'website_research',
  'client_conversation',
  'git',
  'project_file',
  'external_research',
  'decision_record',
] as const;

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export const RELATIONSHIP_TYPES = [
  'OWNS',
  'OFFERS',
  'CONTAINS',
  'INCLUDES',
  'CREATED',
  'BUILT_FOR',
  'BELONGS_TO',
  'USES',
  'DEPENDS_ON',
  'RELATED_TO',
  'SUPPORTS',
  'REQUIRES',
  'TARGETS',
  'SERVES',
  'PART_OF',
  'DECIDED_BY',
  'SUPERSEDES',
  'SUPERSEDED_BY',
  'CONFLICTS_WITH',
  'DERIVED_FROM',
  'SOURCED_FROM',
  'MENTIONED_IN',
  'BLOCKED_BY',
  'ENABLES',
] as const;

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const idSchema = z.string().regex(
  KEBAB_CASE_REGEX,
  'id must be a lowercase kebab-case string',
);

export const typeSchema = z.enum(KNOWLEDGE_TYPES);

export const titleSchema = z.string().min(1, 'title must not be empty');

export const statusSchema = z.enum(KNOWLEDGE_STATUSES);

export const sourceSchema = z.enum(KNOWLEDGE_SOURCES);

export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);

export const timestampSchema = z.iso.datetime({ offset: true });

export const relationshipSchema = z.object({
  type: z.enum(RELATIONSHIP_TYPES),
  target: z.string().min(1, 'relationship target must not be empty'),
}).strict();

export const approvalSchema = z.object({
  status: z.enum(APPROVAL_STATUSES),
  approved_at: timestampSchema.optional(),
  approved_by: z.string().optional(),
}).strict();

export const provenanceSchema = z.object({
  source_session: z.string().optional(),
  source_document: z.string().optional(),
  source_reference: z.string().optional(),
  author: z.string().optional(),
}).strict();

export const knowledgeMetadataSchema = z
  .object({
    id: idSchema,
    type: typeSchema,
    title: titleSchema,
    status: statusSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
    source: sourceSchema,
    confidence: confidenceSchema,
    relationships: z.array(relationshipSchema).optional(),
    approval: approvalSchema.optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict();

export type KnowledgeType = z.infer<typeof typeSchema>;
export type KnowledgeStatus = z.infer<typeof statusSchema>;
export type KnowledgeSource = z.infer<typeof sourceSchema>;
export type KnowledgeConfidence = z.infer<typeof confidenceSchema>;
export type RelationshipType = z.infer<typeof relationshipSchema>['type'];
export type KnowledgeRelationship = z.infer<typeof relationshipSchema>;
export type KnowledgeApproval = z.infer<typeof approvalSchema>;
export type KnowledgeProvenance = z.infer<typeof provenanceSchema>;
export type KnowledgeMetadata = z.infer<typeof knowledgeMetadataSchema>;