import { z } from 'zod';
import {
  approvalSchema,
  confidenceSchema,
  idSchema,
  provenanceSchema,
  relationshipSchema,
  sourceSchema,
  statusSchema,
  typeSchema,
} from '../knowledge/schema.ts';

/**
 * Input/parsing schemas for proposal requests. Every object is `.strict()` so
 * smuggled keys (for example an `id` inside an update patch) are rejected
 * instead of silently accepted.
 *
 * Timestamps (`created_at`/`updated_at`) are deliberately NOT part of request
 * input: they are stamped onto proposed items at proposal creation time.
 */

export const PROPOSAL_OPERATIONS = ['create', 'update', 'supersede'] as const;
export const proposalOperationSchema = z.enum(PROPOSAL_OPERATIONS);

/** Provenance describing the requester/context of a proposal. */
export const proposalProvenanceSchema = provenanceSchema;

const bodySchema = z.string().min(1, 'body must not be empty');

export const proposedItemContentSchema = z
  .object({
    id: idSchema,
    type: typeSchema,
    title: z.string().min(1, 'title must not be empty'),
    status: statusSchema,
    source: sourceSchema,
    confidence: confidenceSchema,
    relationships: z.array(relationshipSchema).optional(),
    approval: approvalSchema.optional(),
    provenance: provenanceSchema.optional(),
    body: bodySchema,
  })
  .strict();

export const createRequestSchema = z
  .object({
    operation: z.literal('create'),
    provenance: proposalProvenanceSchema.optional(),
    item: proposedItemContentSchema,
  })
  .strict();

export const canonicalSnapshotSchema = z
  .object({
    id: idSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const relationshipMutationsSchema = z
  .object({
    add: z.array(relationshipSchema).optional(),
    remove: z.array(relationshipSchema).optional(),
  })
  .strict();

export const updatePatchSchema = z
  .object({
    type: typeSchema.optional(),
    title: z.string().min(1, 'title must not be empty').optional(),
    status: statusSchema.optional(),
    source: sourceSchema.optional(),
    confidence: confidenceSchema.optional(),
    body: bodySchema.optional(),
    relationships: relationshipMutationsSchema.optional(),
    approval: z.union([approvalSchema, z.null()]).optional(),
    provenance: z.union([provenanceSchema, z.null()]).optional(),
  })
  .strict();

export const updateRequestSchema = z
  .object({
    operation: z.literal('update'),
    targetId: idSchema,
    snapshot: canonicalSnapshotSchema.optional(),
    provenance: proposalProvenanceSchema.optional(),
    patch: updatePatchSchema,
  })
  .strict();

export const replacementItemSchema = proposedItemContentSchema;

export const supersedeRequestSchema = z
  .object({
    operation: z.literal('supersede'),
    targetId: idSchema,
    snapshot: canonicalSnapshotSchema.optional(),
    supersedingId: idSchema.optional(),
    replacement: replacementItemSchema.optional(),
    reason: z.string().min(1, 'reason must not be empty').max(2000).optional(),
    provenance: proposalProvenanceSchema.optional(),
  })
  .strict();

export const proposalRequestSchema = z.discriminatedUnion('operation', [
  createRequestSchema,
  updateRequestSchema,
  supersedeRequestSchema,
]);

export type CreateRequest = z.infer<typeof createRequestSchema>;
export type UpdateRequest = z.infer<typeof updateRequestSchema>;
export type SupersedeRequest = z.infer<typeof supersedeRequestSchema>;
export type ProposalRequest = z.infer<typeof proposalRequestSchema>;
export type UpdatePatch = z.infer<typeof updatePatchSchema>;
export type ProposedItemContent = z.infer<typeof proposedItemContentSchema>;
export type ReplacementItem = z.infer<typeof replacementItemSchema>;
export type CanonicalSnapshotInput = z.infer<typeof canonicalSnapshotSchema>;