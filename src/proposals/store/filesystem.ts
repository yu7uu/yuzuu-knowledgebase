import { randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { summarizeProposal } from '../summary.ts';
import type { Proposal } from '../types.ts';
import type { ProposalsConfig } from './config.ts';
import { resolveProposalsConfig } from './config.ts';
import { PROPOSAL_DOCUMENT_SCHEMA_VERSION, proposalDocumentSchema } from './schema.ts';
import type { ProposalDocument } from './schema.ts';
import type { PersistOptions, ProposalLifecycleStatus, ProposalStore } from './types.ts';
import {
  DuplicateProposalError,
  MalformedProposalError,
  MoveDestinationConflictError,
  ProposalNotFoundError,
  ProposalStorageError,
  ProposalStoreError,
  UnsafeProposalIdError,
  PROPOSAL_ID_PATTERN,
} from './errors.ts';

const STATUS_DIRECTORIES: Readonly<Record<ProposalLifecycleStatus, string>> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

/** Deterministic directory scan order for getById across statuses. */
const STATUS_SCAN_ORDER: readonly ProposalLifecycleStatus[] = ['pending', 'approved', 'rejected'];

const YAML_EXTENSION = '.yaml';
const TMP_EXTENSION = '.tmp';

function safeId(id: string): string {
  if (typeof id !== 'string' || !PROPOSAL_ID_PATTERN.test(id)) {
    throw new UnsafeProposalIdError(id);
  }
  return id;
}

function resolvedWithin(dir: string, candidate: string): boolean {
  const base = `${dir}${sep}`;
  return candidate === dir || candidate.startsWith(base);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === 'ENOENT';
}

function storageFailure(action: string, error: unknown): never {
  if (error instanceof ProposalStoreError) {
    throw error;
  }
  throw new ProposalStorageError(action, error);
}

function zodIssueSummary(issues: readonly { path: readonly (string | number | symbol)[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.map(String).join('.') || '<document>'}: ${issue.message}`)
    .join('; ');
}

/**
 * Filesystem-backed implementation of `ProposalStore`.
 *
 * Layout: `<root>/<status>/<proposal-id>.yaml`. All raw fs access is confined
 * to this class; the proposal domain above it stays filesystem-free.
 *
 * Writes are atomic: content is first written to a unique temporary file in the
 * same directory (same filesystem) and then installed with an exclusive hard
 * link, which fails when the destination already exists. Interrupted writes
 * leave at most an orphaned `.tmp` file, never a partially written proposal.
 */
export class FilesystemProposalStore implements ProposalStore {
  private readonly root: string;

  constructor(config?: ProposalsConfig | string) {
    this.root = resolveProposalsConfig(config).root;
  }

  private statusDir(status: ProposalLifecycleStatus): string {
    return resolve(this.root, STATUS_DIRECTORIES[status]);
  }

  private filePathFor(status: ProposalLifecycleStatus, id: string): string {
    const safe = safeId(id);
    const dir = this.statusDir(status);
    const fileName = `${safe}${YAML_EXTENSION}`;
    const filePath = resolve(dir, fileName);
    if (!resolvedWithin(resolve(dir), filePath)) {
      throw new UnsafeProposalIdError(id);
    }
    return filePath;
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const status of STATUS_SCAN_ORDER) {
      await mkdir(this.statusDir(status), { recursive: true });
    }
  }

  private async writeAtomic(dir: string, fileName: string, contents: string): Promise<'installed' | 'exists'> {
    const filePath = resolve(dir, fileName);
    const tmpPath = resolve(dir, `${fileName}${randomUUID()}${TMP_EXTENSION}`);
    try {
      await writeFile(tmpPath, contents, { encoding: 'utf8', flag: 'wx' });
      try {
        await link(tmpPath, filePath);
        return 'installed';
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST') {
          return 'exists';
        }
        throw error;
      }
    } finally {
      await rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  private serialize(doc: ProposalDocument): string {
    return stringifyYaml(doc, { lineWidth: 0 });
  }

  private parse(filePath: string, text: string): ProposalDocument {
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch (error) {
      throw new MalformedProposalError(filePath, error instanceof Error ? error.message : 'invalid YAML');
    }
    const result = proposalDocumentSchema.safeParse(raw);
    if (!result.success) {
      throw new MalformedProposalError(filePath, `invalid proposal document: ${zodIssueSummary(result.error.issues)}`);
    }
    return result.data;
  }

  async savePending(proposal: Proposal, options: PersistOptions = {}): Promise<ProposalDocument> {
    const id = safeId(proposal.id);
    await this.ensureDirs();
    const filePath = this.filePathFor('pending', id);

    const doc: ProposalDocument = {
      schema: PROPOSAL_DOCUMENT_SCHEMA_VERSION,
      status: 'pending',
      summary: options.summary ?? summarizeProposal(proposal),
      validationValid: options.validationValid ?? true,
      conflicts: options.conflicts ?? [],
      proposal,
    };

    try {
      const outcome = await this.writeAtomic(this.statusDir('pending'), `${id}${YAML_EXTENSION}`, this.serialize(doc));
      if (outcome === 'exists') {
        throw new DuplicateProposalError(id);
      }
    } catch (error) {
      storageFailure(`saving proposal "${id}"`, error);
    }
    return doc;
  }

  async getById(id: string): Promise<ProposalDocument | undefined> {
    const safe = safeId(id);
    for (const status of STATUS_SCAN_ORDER) {
      const filePath = this.filePathFor(status, safe);
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch (error) {
        if (isMissing(error)) {
          continue;
        }
        storageFailure(`reading proposal "${safe}"`, error);
      }
      return this.parse(filePath, text);
    }
    return undefined;
  }

  private async listStatus(status: ProposalLifecycleStatus): Promise<ProposalDocument[]> {
    const dir = this.statusDir(status);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      storageFailure(`listing status "${status}"`, error);
    }

    const documents: ProposalDocument[] = [];
    for (const name of names.filter((value) => value.endsWith(YAML_EXTENSION)).sort()) {
      const filePath = resolve(dir, name);
      if (!resolvedWithin(resolve(dir), filePath)) {
        throw new UnsafeProposalIdError(name);
      }
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch (error) {
        storageFailure(`reading "${filePath}" during listing`, error);
      }
      documents.push(this.parse(filePath, text));
    }
    documents.sort((a, b) => a.proposal.id.localeCompare(b.proposal.id));
    return documents;
  }

  listPending(): Promise<ProposalDocument[]> {
    return this.listStatus('pending');
  }

  listApproved(): Promise<ProposalDocument[]> {
    return this.listStatus('approved');
  }

  listRejected(): Promise<ProposalDocument[]> {
    return this.listStatus('rejected');
  }

  async moveStatus(id: string, status: ProposalLifecycleStatus): Promise<ProposalDocument> {
    const safe = safeId(id);

    for (const currentStatus of STATUS_SCAN_ORDER) {
      const sourcePath = this.filePathFor(currentStatus, safe);
      let text: string;
      try {
        text = await readFile(sourcePath, 'utf8');
      } catch (error) {
        if (isMissing(error)) {
          continue;
        }
        storageFailure(`reading proposal "${safe}"`, error);
      }

      const doc = this.parse(sourcePath, text);
      if (currentStatus === status) {
        return doc;
      }

      await this.ensureDirs();
      const destinationPath = this.filePathFor(status, safe);
      const moved: ProposalDocument = { ...doc, status };
      try {
        const outcome = await this.writeAtomic(this.statusDir(status), destinationPath, this.serialize(moved));
        if (outcome === 'exists') {
          throw new MoveDestinationConflictError(safe, status);
        }
      } catch (error) {
        storageFailure(`moving proposal "${safe}" to "${status}"`, error);
      }
      try {
        await unlink(sourcePath);
      } catch (error) {
        storageFailure(`removing source proposal "${safe}"`, error);
      }
      return moved;
    }

    throw new ProposalNotFoundError(safe);
  }
}