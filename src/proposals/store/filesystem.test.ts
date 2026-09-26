import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeMetadata } from '../../knowledge/schema.ts';
import { createProposal } from '../index.ts';
import type {
  Proposal,
  ProposalOperationResult,
  ProposalRepositoryItem,
} from '../index.ts';
import { conflict } from '../types.ts';
import { FilesystemProposalStore, UnsafeProposalIdError } from './index.ts';
import { DuplicateProposalError } from './errors.ts';
import {
  MalformedProposalError,
  MoveDestinationConflictError,
  ProposalNotFoundError,
} from './errors.ts';

const NOW = '2026-09-20T10:00:00+05:30';

function metadata(id: string, overrides: Partial<KnowledgeMetadata> = {}): KnowledgeMetadata {
  return {
    id,
    type: 'concept',
    title: 'Concept',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    source: 'manual',
    confidence: 'high',
    ...overrides,
  };
}

function item(id: string): ProposalRepositoryItem {
  return {
    metadata: metadata(id),
    body: `# ${metadata(id).title}\n\nBody paragraph.\n`,
  };
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

function createRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
      ...overrides,
    },
  };
}

function okResult(result: ProposalOperationResult): Proposal {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.proposal;
}

async function createProposalDoc(
  overrides: Record<string, unknown> = {},
): Promise<Proposal> {
  return okResult(
    await createProposal(createRequest(overrides), repo(), { now: NOW }),
  );
}

describe('FilesystemProposalStore', () => {
  let dir: string;
  let store: FilesystemProposalStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yuzuu-proposal-store-'));
    store = new FilesystemProposalStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a proposal as pending and round-trips its full document', async () => {
    const proposal = await createProposalDoc();
    const stored = await store.savePending(proposal);

    expect(stored.schema).toBe('proposal/v1');
    expect(stored.status).toBe('pending');
    expect(stored.validationValid).toBe(true);
    expect(stored.conflicts).toEqual([]);
    expect(stored.summary).toContain(proposal.id);
    expect(stored.summary).toContain('New Concept');
    expect(stored.proposal).toEqual(proposal);

    const files = await readdir(join(dir, 'pending'));
    expect(files).toEqual([`${proposal.id}.yaml`]);

    const loaded = await store.getById(proposal.id);
    expect(loaded).toEqual(stored);
  });

  it('stores the document as deterministic YAML that round-trips through itself', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);

    const raw = await readFile(join(dir, 'pending', `${proposal.id}.yaml`), 'utf8');
    expect(raw).toContain('schema: proposal/v1');
    expect(raw).toContain('status: pending');
    expect(raw).toContain(`id: ${proposal.id}`);

    const stored = await store.getById(proposal.id);
    expect(stored?.proposal).toEqual(proposal);
  });

  it('persists assessment options (summary, validationValid, conflicts)', async () => {
    const proposal = await createProposalDoc();
    const conflicts = [
      conflict('id_already_exists', 'proposed id already exists in the repository'),
    ];
    const stored = await store.savePending(proposal, {
      summary: 'custom summary',
      validationValid: false,
      conflicts,
    });

    expect(stored.summary).toBe('custom summary');
    expect(stored.validationValid).toBe(false);
    expect(stored.conflicts).toEqual(conflicts);

    const loaded = await store.getById(proposal.id);
    expect(loaded?.summary).toBe('custom summary');
    expect(loaded?.validationValid).toBe(false);
    expect(loaded?.conflicts).toEqual(conflicts);
  });

  it('rejects a duplicate save without overwriting the original', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);

    await expect(store.savePending(proposal)).rejects.toBeInstanceOf(DuplicateProposalError);

    const loaded = await store.getById(proposal.id);
    expect(loaded?.proposal).toEqual(proposal);
    expect(loaded?.status).toBe('pending');
  });

  it('rejects ids that could escape the proposals root', async () => {
    for (const id of ['../evil', 'a/b', '..', 'a/../../b', 'a\\b']) {
      await expect(store.savePending({ id } as Proposal)).rejects.toBeInstanceOf(
        UnsafeProposalIdError,
      );
      await expect(store.getById(id)).rejects.toBeInstanceOf(UnsafeProposalIdError);
      await expect(store.moveStatus(id, 'approved')).rejects.toBeInstanceOf(
        UnsafeProposalIdError,
      );
    }
  });

  it('returns undefined for an unknown proposal id', async () => {
    await expect(store.getById('yzp-0000000000000000')).resolves.toBeUndefined();
  });

  it('lists pending proposals in deterministic id order', async () => {
    const alpha = await createProposalDoc({ title: 'Alpha' });
    const beta = await createProposalDoc({ title: 'Beta' });
    await store.savePending(beta);
    await store.savePending(alpha);

    const pending = await store.listPending();
    const ids = pending.map((doc) => doc.proposal.id);
    expect(ids).toEqual([alpha.id, beta.id].sort());
    expect(pending.map((doc) => doc.proposal.diff)).toEqual(
      [alpha, beta].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.diff),
    );
  });

  it('isolates listings by status', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);

    await expect(store.listApproved()).resolves.toEqual([]);
    await expect(store.listRejected()).resolves.toEqual([]);
    expect(await store.listPending()).toHaveLength(1);
  });

  it('returns empty listings when status directories do not exist yet', async () => {
    const emptyStore = new FilesystemProposalStore(join(dir, 'fresh'));
    await expect(emptyStore.listPending()).resolves.toEqual([]);
    await expect(emptyStore.listApproved()).resolves.toEqual([]);
    await expect(emptyStore.listRejected()).resolves.toEqual([]);
  });

  it('ignores non-yaml files inside a status directory', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);
    await writeFile(join(dir, 'pending', 'notes.txt'), 'not a proposal');

    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposal.id).toBe(proposal.id);
  });

  it('raises a typed error for a malformed proposal file on load', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);
    await writeFile(
      join(dir, 'pending', `${proposal.id}.yaml`),
      'schema: garbage\nstatus: nope\n',
      'utf8',
    );

    await expect(store.getById(proposal.id)).rejects.toBeInstanceOf(MalformedProposalError);
    await expect(store.listPending()).rejects.toBeInstanceOf(MalformedProposalError);
  });

  it('moves a proposal to approved and back, preserving its payload', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);

    const approved = await store.moveStatus(proposal.id, 'approved');
    expect(approved.status).toBe('approved');
    expect(approved.proposal).toEqual(proposal);

    const dirs = await readdir(dir);
    expect(dirs.sort()).toEqual(['approved', 'pending', 'rejected']);
    expect(await store.listPending()).toEqual([]);
    expect((await store.listApproved())[0]?.proposal.id).toBe(proposal.id);
    await expect(store.getById(proposal.id)).resolves.toMatchObject({ status: 'approved' });

    const back = await store.moveStatus(proposal.id, 'pending');
    expect(back.status).toBe('pending');
    expect(await store.listPending()).toHaveLength(1);
    expect(await store.listApproved()).toEqual([]);
  });

  it('is an idempotent no-op when moving to the current status', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);

    const doc = await store.moveStatus(proposal.id, 'pending');
    expect(doc.status).toBe('pending');
    expect(await store.listPending()).toHaveLength(1);
  });

  it('throws a typed error when moving an unknown proposal', async () => {
    await expect(store.moveStatus('yzp-0000000000000000', 'approved')).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
  });

  it('refuses to overwrite an existing proposal in the destination status', async () => {
    const source = await createProposalDoc({ title: 'Source' });
    await store.savePending(source);
    await store.moveStatus(source.id, 'approved');

    await store.savePending(source);
    await expect(store.moveStatus(source.id, 'approved')).rejects.toBeInstanceOf(
      MoveDestinationConflictError,
    );

    expect(await store.listPending()).toHaveLength(1);
    expect((await store.listApproved())[0]?.proposal.id).toBe(source.id);
    expect((await store.listPending())[0]?.proposal.id).toBe(source.id);
  });

  it('leaves no temporary files behind after success or failure', async () => {
    const proposal = await createProposalDoc();
    await store.savePending(proposal);
    await store.savePending(proposal).catch(() => {});

    const files = await readdir(join(dir, 'pending'));
    expect(files.map((f) => f.endsWith('.tmp'))).not.toContain(true);
    expect(files).toContain(`${proposal.id}.yaml`);
  });

  it('flows a full proposal through assessment, persistence, and status moves', async () => {
    const result = await createProposal(createRequest(), repo(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    await store.savePending(result.proposal, {
      summary: result.assessment.summary,
      validationValid: result.assessment.validationValid,
      conflicts: result.assessment.conflicts,
    });
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.summary).toBe(result.assessment.summary);

    await store.moveStatus(result.proposal.id, 'approved');
    const approved = await store.listApproved();
    expect(approved[0]?.summary).toBe(result.assessment.summary);
    expect(await store.listPending()).toEqual([]);
  });
});