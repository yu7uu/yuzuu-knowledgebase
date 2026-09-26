import { z } from 'zod';
import {
  approvalSchema,
  confidenceSchema,
  idSchema,
  knowledgeMetadataSchema,
  provenanceSchema,
  relationshipSchema,
  sourceSchema,
  statusSchema,
  timestampSchema,
  titleSchema,
  typeSchema,
} from '../../knowledge/schema.ts';
import { proposalRequestSchema } from '../schemas.ts';
import { CONFLICT_CODES } from '../types.ts';
import { PROPOSAL_LIFECYCLE_STATUSES } from './types.ts';

/**
 * Zod schema for the on-disk proposal document. This is the contract that keeps
 * persisted data trustworthy: every proposal file is re-validated against it on
 * load, reusing the existing proposal request schema and canonical knowledge
 * schemas instead of duplicating the domain model.
 */

export const persistedProposedItemSchema = z
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
    body: z.string().min(1, 'body must not be empty'),
  })
  .strict();

const metadataPatchSchema = z
  .object({
    type: typeSchema.optional(),
    title: titleSchema.optional(),
    status: statusSchema.optional(),
    source: sourceSchema.optional(),
    confidence: confidenceSchema.optional(),
    approval: z.union([approvalSchema, z.null()]).optional(),
    provenance: z.union([provenanceSchema, z.null()]).optional(),
  })
  .strict();

const itemChangesSchema = z
  .object({
    metadata: metadataPatchSchema,
    body: z
      .object({ from: z.string(), to: z.string() })
      .strict()
      .nullable(),
    relationships: z
      .object({
        added: z.array(relationshipSchema),
        removed: z.array(relationshipSchema),
      })
      .strict()
      .nullable(),
  })
  .strict();

const resolvedDiffSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      item: persistedProposedItemSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update'),
      targetId: idSchema,
      current: z
        .object({ metadata: knowledgeMetadataSchema, body: z.string() })
        .strict(),
      changes: itemChangesSchema,
      resultingMetadata: knowledgeMetadataSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('supersede'),
      targetId: idSchema,
      reason: z.string().optional(),
      supersedingId: idSchema.optional(),
      replacement: persistedProposedItemSchema.optional(),
      resultingTargetMetadata: knowledgeMetadataSchema,
    })
    .strict(),
]);

const proposalApprovalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).strict(),
  z
    .object({
      status: z.literal('approved'),
      approved_at: timestampSchema,
      approved_by: z.string().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejected_at: timestampSchema,
      rejected_by: z.string().optional(),
    })
    .strict(),
]);

const persistedConflictSchema = z
  .object({
    phase: z.literal('conflict'),
    code: z.enum(CONFLICT_CODES),
    message: z.string(),
  })
  .strict();

const persistedProposalSchema = z
  .object({
    id: z.string().min(1),
    createdAt: timestampSchema,
    operation: z.enum(['create', 'update', 'supersede']),
    request: proposalRequestSchema,
    provenance: provenanceSchema,
    approval: proposalApprovalSchema,
    diff: resolvedDiffSchema,
  })
  .strict();

/** Version marker; the file format is expected to evolve explicitly. */
export const PROPOSAL_DOCUMENT_SCHEMA_VERSION = 'proposal/v1';

export const proposalDocumentSchema = z
  .object({
    schema: z.literal(PROPOSAL_DOCUMENT_SCHEMA_VERSION),
    status: z.enum(PROPOSAL_LIFECYCLE_STATUSES),
    summary: z.string(),
    validationValid: z.boolean(),
    conflicts: z.array(persistedConflictSchema),
    proposal: persistedProposalSchema,
  })
  .strict();

export type ProposalDocument = z.infer<typeof proposalDocumentSchema>;