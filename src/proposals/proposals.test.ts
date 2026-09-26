import { describe, expect, it } from 'vitest';
import type {
  KnowledgeMetadata,
  KnowledgeRelationship,
} from '../knowledge/schema.ts';
import {
  createProposal,
  mergeUpdateMetadata,
  sanitize,
} from './index.ts';
import type {
  Proposal,
  ProposalOperationResult,
  ProposalRepositoryItem,
} from './index.ts';

const TS = '2026-09-15T00:00:00+05:30';
const NOW = '2026-09-20T10:00:00+05:30';
const PROPOSAL_ID_PATTERN = /^yzp-[0-9a-f]{16}$/;

function metadata(id: string, overrides: Partial<KnowledgeMetadata> = {}): KnowledgeMetadata {
  return {
    id,
    type: 'concept',
    title: 'Concept',
    status: 'active',
    created_at: TS,
    updated_at: TS,
    source: 'manual',
    confidence: 'high',
    ...overrides,
  };
}

function itemFromMetadata(metadataValue: KnowledgeMetadata): ProposalRepositoryItem {
  return { metadata: metadataValue, body: `# ${metadataValue.title}\n\nBody paragraph.\n` };
}

function item(id: string, overrides: Partial<KnowledgeMetadata> = {}): ProposalRepositoryItem {
  return itemFromMetadata(metadata(id, overrides));
}

class FakeProposalRepository {
  constructor(private readonly items: ProposalRepositoryItem[]) {}

  async getById(id: string): Promise<ProposalRepositoryItem | undefined> {
    return this.items.find((entry) => entry.metadata.id === id);
  }
}

function repo(...items: ProposalRepositoryItem[]) {
  return new FakeProposalRepository(items);
}

function createRequest(item: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'create',
    provenance: { author: 'tester' },
    item: {
      id: 'yz-new-concept',
      type: 'concept',
      title: 'New Concept',
      status: 'proposed',
      source: 'manual',
      confidence: 'medium',
      body: '# New Concept\n\nContent here.\n',
      ...item,
    },
  };
}

function updateRequest(targetId: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
  return {
    operation: 'update',
    targetId,
    provenance: { author: 'tester' },
    patch,
    ...extra,
  };
}

function supersedeRequest(targetId: string, extra: Record<string, unknown>, withReplacement = true): unknown {
  const base: Record<string, unknown> = {
    operation: 'supersede',
    targetId,
    provenance: { author: 'tester' },
  };
  if (withReplacement) {
    base.replacement = {
      id: 'yz-new-version',
      type: 'concept',
      title: 'New Version',
      status: 'proposed',
      source: 'manual',
      confidence: 'medium',
      relationships: [{ type: 'SUPERSEDES', target: targetId }],
      body: '# New Version\n\nReplaces the old concept.\n',
    };
  }
  return { ...base, ...extra };
}

function proposalId(result: ProposalOperationResult): string {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.proposal.id;
}

function okResult(result: ProposalOperationResult): Proposal {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.proposal;
}

function issueCodes(result: ProposalOperationResult): string[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected error result');
  }
  return result.issues.map((issue) => issue.code);
}

const linkedRelationship = (target: string): KnowledgeRelationship => ({
  type: 'SUPERSEDES',
  target,
});

describe('createProposal', () => {
  it('creates a pending proposal with a deterministic ID, diff, and summary', async () => {
    const result = await createProposal(createRequest(), repo(), { now: NOW });
    const proposal = okResult(result);

    expect(proposal.id).toMatch(PROPOSAL_ID_PATTERN);
    expect(proposal.createdAt).toBe(NOW);
    expect(proposal.operation).toBe('create');
    expect(proposal.approval).toEqual({ status: 'pending' });
    expect(proposal.provenance).toEqual({ author: 'tester' });
    expect(proposal.diff).toMatchObject({
      kind: 'create',
      item: {
        id: 'yz-new-concept',
        type: 'concept',
        title: 'New Concept',
        status: 'proposed',
        source: 'manual',
        confidence: 'medium',
        created_at: NOW,
        updated_at: NOW,
      },
    });
    if (result.ok) {
      expect(result.assessment.validationValid).toBe(true);
      expect(result.assessment.conflicts).toEqual([]);
      expect(result.assessment.summary).toContain(proposal.id);
      expect(result.assessment.summary).toContain('New Concept');
    }
  });

  it('produces the same proposal ID for identical input', async () => {
    const a = await createProposal(createRequest(), repo(), { now: NOW });
    const b = await createProposal(createRequest(), repo(), { now: NOW });
    expect(proposalId(a)).toBe(proposalId(b));
  });

  it('produces a different proposal ID when content changes', async () => {
    const a = await createProposal(createRequest({ title: 'First Title' }), repo(), { now: NOW });
    const b = await createProposal(createRequest({ title: 'Second Title' }), repo(), { now: NOW });
    expect(proposalId(a)).not.toBe(proposalId(b));
  });

  it('produces a different proposal ID when requester provenance changes', async () => {
    const a = await createProposal(createRequest(), repo(), { now: NOW });
    const b = await createProposal(
      { ...createRequest(), provenance: { author: 'someone-else' } },
      repo(),
      { now: NOW },
    );
    expect(proposalId(a)).not.toBe(proposalId(b));
  });

  it('detects an id_already_exists conflict when the proposed id is taken', async () => {
    const taken = repo(item('yz-new-concept'));
    const result = await createProposal(createRequest(), taken, { now: NOW });
    expect(issueCodes(result)).toEqual(['id_already_exists']);
  });

  it('rejects invalid create metadata as a validation issue', async () => {
    const result = await createProposal(createRequest({ type: 'galaxy' }), repo(), { now: NOW });
    expect(issueCodes(result)).toEqual(['invalid_request']);
  });

  it('rejects an empty create body', async () => {
    const result = await createProposal(createRequest({ body: '   ' }), repo(), { now: NOW });
    expect(issueCodes(result)).toEqual(['empty_body']);
  });

  it('preserves proposed item provenance and item approval independently of proposal approval', async () => {
    const result = await createProposal(
      createRequest({
        approval: { status: 'approved', approved_by: 'arvi' },
        provenance: { source_session: 'session-2026-09-20-001' },
      }),
      repo(),
      { now: NOW },
    );
    const proposal = okResult(result);
    expect(proposal.approval).toEqual({ status: 'pending' });
    if (proposal.diff.kind === 'create') {
      expect(proposal.diff.item.approval).toEqual({ status: 'approved', approved_by: 'arvi' });
      expect(proposal.diff.item.provenance).toEqual({ source_session: 'session-2026-09-20-001' });
    } else {
      expect.unreachable('create diff expected');
    }
  });

  it('keeps validation and conflict phases separate', async () => {
    const invalid = await createProposal(createRequest({ type: 'galaxy' }), repo(), { now: NOW });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      for (const issue of invalid.issues) {
        expect(issue.phase).toBe('validation');
      }
    }
  });
});

describe('createProposal: update', () => {
  const current = item('yz-target', {
    title: 'Old Title',
    relationships: [{ type: 'RELATED_TO', target: 'yz-exists' }],
    provenance: { author: 'arvi' },
  });

  it('computes a metadata + body + relationship diff for a valid update', async () => {
    const result = await createProposal(
      updateRequest('yz-target', {
        title: 'New Title',
        body: '# New Title\n\nUpdated body.\n',
        relationships: {
          add: [{ type: 'DEPENDS_ON', target: 'yz-new-dep' }],
          remove: [{ type: 'RELATED_TO', target: 'yz-exists' }],
        },
      }),
      repo(current),
      { now: NOW },
    );
    const proposal = okResult(result);

    if (proposal.diff.kind !== 'update') {
      expect.unreachable('update diff expected');
      return;
    }
    expect(proposal.diff.targetId).toBe('yz-target');
    expect(proposal.diff.changes.metadata).toEqual({ title: 'New Title' });
    expect(proposal.diff.changes.body).toEqual({
      from: current.body,
      to: '# New Title\n\nUpdated body.\n',
    });
    expect(proposal.diff.changes.relationships).toEqual({
      added: [{ type: 'DEPENDS_ON', target: 'yz-new-dep' }],
      removed: [{ type: 'RELATED_TO', target: 'yz-exists' }],
    });
    expect(proposal.diff.resultingMetadata.title).toBe('New Title');
    expect(proposal.diff.resultingMetadata.updated_at).toBe(NOW);
  });

  it('keeps body diff null when body is unchanged', async () => {
    const result = await createProposal(
      updateRequest('yz-target', { confidence: 'low' }),
      repo(current),
      { now: NOW },
    );
    const proposal = okResult(result);
    if (proposal.diff.kind === 'update') {
      expect(proposal.diff.changes.body).toBeNull();
      expect(proposal.diff.changes.metadata).toEqual({ confidence: 'low' });
    } else {
      expect.unreachable('update diff expected');
    }
  });

  it('reports target_not_found for an unknown target', async () => {
    const result = await createProposal(updateRequest('yz-missing', { title: 'X' }), repo(), {
      now: NOW,
    });
    expect(issueCodes(result)).toEqual(['target_not_found']);
  });

  it('reports stale_snapshot when the snapshot does not match current updated_at', async () => {
    const result = await createProposal(
      updateRequest('yz-target', { title: 'New Title' }, {
        snapshot: { id: 'yz-target', updatedAt: '2020-01-01T00:00:00+05:30' },
      }),
      repo(current),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['stale_snapshot']);
  });

  it('reports no_effective_change for an identical update', async () => {
    const result = await createProposal(
      updateRequest('yz-target', { title: 'Old Title' }),
      repo(current),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['no_effective_change']);
  });

  it('rejects an update patch that smuggles an id', async () => {
    const result = await createProposal(
      updateRequest('yz-target', { title: 'New Title', id: 'yz-hijacked' }),
      repo(current),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['invalid_request']);
  });

  it('reports relationship_conflict for adding an existing relationship', async () => {
    const result = await createProposal(
      updateRequest('yz-target', {
        relationships: { add: [{ type: 'RELATED_TO', target: 'yz-exists' }] },
      }),
      repo(current),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['relationship_conflict']);
  });

  it('reports relationship_conflict for removing a missing relationship', async () => {
    const result = await createProposal(
      updateRequest('yz-target', {
        relationships: { remove: [{ type: 'DEPENDS_ON', target: 'yz-never-existed' }] },
      }),
      repo(current),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['relationship_conflict']);
  });

  it('models provenance removal and preserves untouched provenance', async () => {
    const removal = await createProposal(
      updateRequest('yz-target', { provenance: null }),
      repo(current),
      { now: NOW },
    );
    const removedProposal = okResult(removal);
    if (removedProposal.diff.kind === 'update') {
      expect(removedProposal.diff.changes.metadata.provenance).toBeNull();
    } else {
      expect.unreachable('update diff expected');
    }

    const untouched = await createProposal(
      updateRequest('yz-target', { confidence: 'low' }),
      repo(current),
      { now: NOW },
    );
    const untouchedProposal = okResult(untouched);
    if (untouchedProposal.diff.kind === 'update') {
      expect(untouchedProposal.diff.resultingMetadata.provenance).toEqual({ author: 'arvi' });
      expect(untouchedProposal.diff.changes.metadata).toEqual({ confidence: 'low' });
    } else {
      expect.unreachable('update diff expected');
    }
  });

  it('guards against an invalid resulting state during metadata merge', async () => {
    const merged = mergeUpdateMetadata(current.metadata, { title: '' }, NOW);
    expect(merged.ok).toBe(false);
  });
});

describe('createProposal: supersede', () => {
  const target = item('yz-old-concept', { title: 'Old Concept' });

  it('supersedes a target via an existing linked superseding item', async () => {
    const superseder = item('yz-newer', {
      title: 'Newer Concept',
      relationships: [linkedRelationship('yz-old-concept')],
    });
    const result = await createProposal(
      supersedeRequest('yz-old-concept', { supersedingId: 'yz-newer' }, false),
      repo(target, superseder),
      { now: NOW },
    );
    const proposal = okResult(result);

    if (proposal.diff.kind !== 'supersede') {
      expect.unreachable('supersede diff expected');
      return;
    }
    expect(proposal.diff.supersedingId).toBe('yz-newer');
    expect(proposal.diff.replacement).toBeUndefined();
    expect(proposal.diff.resultingTargetMetadata.status).toBe('superseded');
    expect(proposal.diff.resultingTargetMetadata.updated_at).toBe(NOW);
  });

  it('supersedes a target via an inline replacement item', async () => {
    const result = await createProposal(supersedeRequest('yz-old-concept', {}), repo(target), {
      now: NOW,
    });
    const proposal = okResult(result);

    if (proposal.diff.kind !== 'supersede') {
      expect.unreachable('supersede diff expected');
      return;
    }
    expect(proposal.diff.supersedingId).toBeUndefined();
    expect(proposal.diff.replacement?.id).toBe('yz-new-version');
    expect(proposal.diff.replacement?.relationships).toEqual([
      { type: 'SUPERSEDES', target: 'yz-old-concept' },
    ]);
    expect(proposal.diff.resultingTargetMetadata.status).toBe('superseded');
  });

  it('reports target_not_found when the supersede target is missing', async () => {
    const result = await createProposal(supersedeRequest('yz-ghost', {}), repo(), {
      now: NOW,
    });
    expect(issueCodes(result)).toEqual(['target_not_found']);
  });

  it('requires exactly one of supersedingId or replacement', async () => {
    const neither = await createProposal(
      supersedeRequest('yz-old-concept', {}, false),
      repo(target),
      { now: NOW },
    );
    expect(issueCodes(neither)).toEqual(['supersede_requires_replacement_or_superseding']);

    const both = await createProposal(
      supersedeRequest('yz-old-concept', { supersedingId: 'yz-someone' }),
      repo(target),
      { now: NOW },
    );
    expect(issueCodes(both)).toEqual(['supersede_multiple_alternatives']);
  });

  it('rejects a replacement that does not declare SUPERSEDES to the target', async () => {
    const result = await createProposal(
      supersedeRequest('yz-old-concept', {
        replacement: {
          id: 'yz-new-version',
          type: 'concept',
          title: 'New Version',
          status: 'proposed',
          source: 'manual',
          confidence: 'medium',
          body: '# New Version\n\nReplaces the old concept.\n',
        },
      }),
      repo(target),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['replacement_missing_supersedes_link']);
  });

  it('reports superseding_item_not_found for a missing superseding id', async () => {
    const result = await createProposal(
      supersedeRequest('yz-old-concept', { supersedingId: 'yz-ghost' }, false),
      repo(target),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['superseding_item_not_found']);
  });

  it('reports superseding_item_not_linked when the superseding item lacks the link', async () => {
    const unlinked = item('yz-newer', { title: 'Newer Concept' });
    const result = await createProposal(
      supersedeRequest('yz-old-concept', { supersedingId: 'yz-newer' }, false),
      repo(target, unlinked),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['superseding_item_not_linked']);
  });

  it('reports metadata_conflict for an already-superseded target', async () => {
    const superseded = item('yz-old-concept', { status: 'superseded' });
    const result = await createProposal(supersedeRequest('yz-old-concept', {}), repo(superseded), {
      now: NOW,
    });
    expect(issueCodes(result)).toEqual(['metadata_conflict']);
  });

  it('reports id_already_exists when the replacement id is taken', async () => {
    const replacementExists = item('yz-new-version');
    const result = await createProposal(
      supersedeRequest('yz-old-concept', {
        replacement: {
          id: 'yz-new-version',
          type: 'concept',
          title: 'New Version',
          status: 'proposed',
          source: 'manual',
          confidence: 'medium',
          relationships: [linkedRelationship('yz-old-concept')],
          body: '# New Version\n\nReplaces the old concept.\n',
        },
      }),
      repo(target, replacementExists),
      { now: NOW },
    );
    expect(issueCodes(result)).toEqual(['id_already_exists']);
  });
});

describe('sanitize', () => {
  it('redacts credential-like values and never exposes them in summaries', async () => {
    const result = await createProposal(
      createRequest({ body: '# Secret\n\npassword=hunter2 and api_key=ABC123XYZ\n' }),
      repo(),
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.summary).not.toContain('hunter2');
      expect(result.assessment.summary).not.toContain('ABC123XYZ');
    }
  });

  it('redacts and truncates long content', () => {
    expect(sanitize('token=abc123')).not.toContain('abc123');
    const long = 'x'.repeat(500);
    expect(sanitize(long).length).toBeLessThanOrEqual(401);
    expect(sanitize(long)).toContain('…');
  });
});