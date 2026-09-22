import { isAbsolute, relative } from 'node:path';
import { discoverKnowledgeFiles, loadKnowledgeFile } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import { RepositoryLoadError } from './errors.ts';
import type { CanonicalKnowledgeReader } from './readers.ts';

interface Snapshot {
  byId: ReadonlyMap<string, KnowledgeDocument>;
  sorted: readonly KnowledgeDocument[];
}

function compareById(a: KnowledgeDocument, b: KnowledgeDocument): number {
  return a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0;
}

/**
 * Canonical knowledge reader backed by the canonical repository on disk.
 *
 * Loads the full validated repository once and serves subsequent reads from an
 * in-memory snapshot (a lightweight index for the service lifetime), avoiding
 * repeated discovery/parsing per query. `refresh()` invalidates the snapshot.
 *
 * The repository is strict: if any canonical file fails to load or validate,
 * every read fails with a repository validation error until the file is fixed.
 * Invalid canonical knowledge is never silently accepted.
 */
export class FilesystemCanonicalKnowledgeReader implements CanonicalKnowledgeReader {
  #knowledgeRootPath: string;
  #repositoryRootPath: string;
  #snapshot: Snapshot | undefined;

  constructor(knowledgeRootPath: string, repositoryRootPath: string) {
    this.#knowledgeRootPath = knowledgeRootPath;
    this.#repositoryRootPath = repositoryRootPath;
  }

  #relativePath(filePath: string): string {
    const rel = relative(this.#repositoryRootPath, filePath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return filePath;
    }
    return rel;
  }

  async #snapshotOrThrow(): Promise<Snapshot> {
    if (this.#snapshot === undefined) {
      const filePaths = await discoverKnowledgeFiles(this.#knowledgeRootPath);
      const byId = new Map<string, KnowledgeDocument>();
      const sorted: KnowledgeDocument[] = [];
      for (const filePath of filePaths) {
        try {
          const doc = await loadKnowledgeFile(filePath);
          const document: KnowledgeDocument = { ...doc, filePath: this.#relativePath(doc.filePath) };
          byId.set(document.metadata.id, document);
          sorted.push(document);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new RepositoryLoadError(this.#relativePath(filePath), reason);
        }
      }
      sorted.sort(compareById);
      this.#snapshot = { byId, sorted };
    }
    return this.#snapshot;
  }

  async getById(id: string): Promise<KnowledgeDocument | undefined> {
    const snapshot = await this.#snapshotOrThrow();
    return snapshot.byId.get(id);
  }

  async list(): Promise<KnowledgeDocument[]> {
    const snapshot = await this.#snapshotOrThrow();
    return [...snapshot.sorted];
  }

  refresh(): void {
    this.#snapshot = undefined;
  }
}