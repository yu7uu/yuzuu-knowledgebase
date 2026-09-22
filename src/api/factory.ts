import { resolve } from 'node:path';
import type { Driver } from 'neo4j-driver';
import { createNeo4jDriver, loadNeo4jConfig } from '../graph/index.ts';
import { FilesystemCanonicalKnowledgeReader } from './canonical-reader.ts';
import { Neo4jGraphReader, UnavailableGraphReader } from './graph-reader.ts';
import type { GraphReader } from './readers.ts';
import { KnowledgeService } from './service.ts';

export interface CreateKnowledgeServiceOptions {
  /** Root of the canonical knowledge directory. Defaults to `<cwd>/knowledge`. */
  knowledgeRootPath?: string;
  /** Repository root used to relativize file paths. Defaults to `<cwd>`. */
  repositoryRootPath?: string;
  /** Optional Neo4j driver. When provided, the service does not own or close it. */
  driver?: Driver;
}

/**
 * Wires a KnowledgeService over the canonical repository and the Neo4j
 * projection.
 *
 * Graph configuration:
 * - an explicit `driver` is used as-is (caller owns its lifecycle);
 * - otherwise Neo4j env configuration is loaded and a driver is created
 *   (owned by the service, closed via `service.close()`);
 * - if Neo4j is not configured, graph operations report `graph_unavailable`
 *   while canonical operations continue to work.
 */
export function createKnowledgeService(options: CreateKnowledgeServiceOptions = {}): KnowledgeService {
  const repositoryRootPath = options.repositoryRootPath ?? process.cwd();
  const knowledgeRootPath = options.knowledgeRootPath ?? resolve(repositoryRootPath, 'knowledge');
  const canonical = new FilesystemCanonicalKnowledgeReader(knowledgeRootPath, repositoryRootPath);

  let graph: GraphReader;
  let onClose: (() => Promise<void>) | undefined;

  if (options.driver) {
    graph = new Neo4jGraphReader(options.driver);
  } else {
    try {
      const config = loadNeo4jConfig();
      const driver = createNeo4jDriver(config);
      graph = new Neo4jGraphReader(driver);
      onClose = () => driver.close();
    } catch {
      graph = new UnavailableGraphReader();
    }
  }

  return new KnowledgeService(canonical, graph, onClose);
}