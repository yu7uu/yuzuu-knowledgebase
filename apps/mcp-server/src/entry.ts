import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKnowledgeService } from '../../../src/api/index.ts';
import { createYuzuuMcpServer } from './create-server.ts';

/**
 * STDIO entrypoint for the Yuzuu MCP server.
 *
 * All protocol traffic travels over stdin/stdout; diagnostics go to stderr so
 * the MCP channel stays clean. The Neo4j driver is owned by the Knowledge
 * Service and is closed when the transport closes.
 */
async function main(): Promise<void> {
  const service = createKnowledgeService();
  const { server } = createYuzuuMcpServer({ knowledgeService: service });
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void service.close();
  };
  await server.connect(transport);
  console.error('yuzuu-mcp: connected');
}

main().catch((error: unknown) => {
  console.error('yuzuu-mcp: fatal startup error', error);
  process.exitCode = 1;
});