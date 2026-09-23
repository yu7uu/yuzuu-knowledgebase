import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeService } from '../../../src/api/index.ts';
import { registerKnowledgeTools } from './tools.ts';

/**
 * The read-only subset of the Knowledge Service that the MCP server depends on.
 *
 * Declared structurally (Pick) so tests and future backends can inject a plain
 * object without reproducing the service's private fields.
 */
export type KnowledgeServiceLike = Pick<
  KnowledgeService,
  'getById' | 'getRelated' | 'search' | 'getProject' | 'getDecision' | 'getCurrentState'
>;

export interface CreateYuzuuMcpServerOptions {
  /** Read-only knowledge backend. The server never writes. */
  knowledgeService: KnowledgeServiceLike;
  /** Server identity reported to clients. Defaults to `yuzuu-mcp` 0.0.0. */
  serverInfo?: { name: string; version: string };
}

export interface YuzuuMcpServer {
  /** The underlying MCP server; connect it to a transport. */
  readonly server: McpServer;
  /** Closes the MCP server connection. */
  close(): Promise<void>;
}

/**
 * Creates the Yuzuu MCP server with all six read-only tools registered.
 *
 * The server is transport-agnostic: attach any inbound transport (e.g.
 * `StdioServerTransport`) via `server.connect()`. All knowledge access is
 * delegated to the injected {@link KnowledgeServiceLike}; no storage, driver,
 * Cypher, or filesystem objects are ever exposed.
 */
export function createYuzuuMcpServer(options: CreateYuzuuMcpServerOptions): YuzuuMcpServer {
  const server = new McpServer({
    name: options.serverInfo?.name ?? 'yuzuu-mcp',
    version: options.serverInfo?.version ?? '0.0.0',
  });
  registerKnowledgeTools(server, options.knowledgeService);
  return {
    server,
    async close(): Promise<void> {
      await server.close();
    },
  };
}