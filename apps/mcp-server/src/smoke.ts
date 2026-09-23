import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const TOOL_NAMES = [
  'search_yuzuu',
  'get_entity',
  'get_related_entities',
  'get_project',
  'get_decision',
  'get_current_state',
] as const;

function describe(result: CallToolResult): string {
  const block = result.content[0];
  const text = block?.type === 'text' ? block.text : '';
  return `isError=${result.isError === true} ${truncate(text, 160)}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function callAsToolResult(
  client: Client,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<CallToolResult> {
  return (await client.callTool(params)) as CallToolResult;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['apps/mcp-server/src/entry.ts'],
    cwd: process.cwd(),
    env: inheritEnv(),
  });
  const client = new Client(
    { name: 'yuzuu-mcp-smoke', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  const listed = await client.listTools();
  const actualNames = listed.tools.map((tool) => tool.name);
  const missing = TOOL_NAMES.filter((name) => !actualNames.includes(name));
  console.log(`tools (${actualNames.length}): ${actualNames.join(', ')}`);
  console.log(`missing: ${missing.length === 0 ? 'none' : missing.join(', ')}`);

  const results: Array<{ name: string; outcome: string }> = [
    {
      name: 'search_yuzuu',
      outcome: describe(await callAsToolResult(client, { name: 'search_yuzuu', arguments: { query: 'yuzuu', limit: 5 } })),
    },
    {
      name: 'get_entity',
      outcome: describe(await callAsToolResult(client, { name: 'get_entity', arguments: { id: 'yz-studio' } })),
    },
    {
      name: 'get_related_entities',
      outcome: describe(await callAsToolResult(client, { name: 'get_related_entities', arguments: { id: 'yz-studio' } })),
    },
    {
      name: 'get_current_state',
      outcome: describe(await callAsToolResult(client, { name: 'get_current_state' })),
    },
    {
      name: 'get_project_non_project',
      outcome: describe(await callAsToolResult(client, { name: 'get_project', arguments: { id: 'yz-studio' } })),
    },
    {
      name: 'get_decision_not_found',
      outcome: describe(await callAsToolResult(client, { name: 'get_decision', arguments: { id: 'no-such-item' } })),
    },
    {
      name: 'get_entity_invalid_argument',
      outcome: describe(await callAsToolResult(client, { name: 'get_entity', arguments: { id: '' } })),
    },
  ];
  for (const result of results) {
    console.log(`${result.name}: ${result.outcome}`);
  }

  await client.close();
}

function inheritEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

main().catch((error: unknown) => {
  console.error('smoke: failed', error);
  process.exitCode = 1;
});