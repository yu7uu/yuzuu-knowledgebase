import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type {
  CurrentStateView,
  DecisionKnowledgeItem,
  KnowledgeItem,
  ProjectKnowledgeItem,
  RelatedKnowledgeItem,
  SearchResponse,
} from '../../../src/api/index.ts';
import { knowledgeFail, knowledgeOk } from '../../../src/api/index.ts';
import { createYuzuuMcpServer } from './create-server.ts';
import type { KnowledgeServiceLike } from './create-server.ts';

const TOOL_NAMES = [
  'search_yuzuu',
  'get_entity',
  'get_related_entities',
  'get_project',
  'get_decision',
  'get_current_state',
] as const;

const baseItem: KnowledgeItem = {
  id: 'yz-studio',
  type: 'state',
  title: 'Yuzuu Studio Current State',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-02T00:00:00.000Z',
  source: 'manual',
  confidence: 'high',
  body: '# Yuzuu Studio\n',
  filePath: 'knowledge/core/yuzuu-studio.md',
};

function createFakeService(): KnowledgeServiceLike {
  return {
    getById: vi.fn() as unknown as KnowledgeServiceLike['getById'],
    getRelated: vi.fn() as unknown as KnowledgeServiceLike['getRelated'],
    search: vi.fn() as unknown as KnowledgeServiceLike['search'],
    getProject: vi.fn() as unknown as KnowledgeServiceLike['getProject'],
    getDecision: vi.fn() as unknown as KnowledgeServiceLike['getDecision'],
    getCurrentState: vi.fn() as unknown as KnowledgeServiceLike['getCurrentState'],
  };
}

async function withServer(
  service: KnowledgeServiceLike,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const yuzuu = createYuzuuMcpServer({ knowledgeService: service });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([yuzuu.server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await yuzuu.close();
  }
}

function parseText(result: CallToolResult): unknown {
  return JSON.parse(textOf(result));
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block === undefined || block.type !== 'text') {
    throw new Error('expected a single text content block');
  }
  return block.text;
}

async function callAsToolResult(
  client: Client,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<CallToolResult> {
  return (await client.callTool(params)) as CallToolResult;
}

describe('createYuzuuMcpServer', () => {
  it('registers exactly the six read-only Yuzuu tools', async () => {
    const service = createFakeService();
    await withServer(service, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      const search = tools.find((tool) => tool.name === 'search_yuzuu');
      expect(search?.description?.toLowerCase()).toContain('lexical');
      expect(search?.description?.toLowerCase()).not.toContain('semantic');
    });
  });

  it('search_yuzuu forwards query and limit to the service and returns its payload', async () => {
    const service = createFakeService();
    const response: SearchResponse = {
      query: 'yuzuu',
      strategy: 'lexical-v1',
      total: 1,
      results: [],
    };
    (
      service.search as ReturnType<typeof vi.fn>
    ).mockResolvedValue(knowledgeOk(response));
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'search_yuzuu',
        arguments: { query: 'yuzuu', limit: 3 },
      });
      expect(result.isError).toBeFalsy();
      expect(service.search).toHaveBeenCalledWith('yuzuu', { limit: 3 });
      expect(parseText(result)).toEqual(response);
    });
  });

  it('search_yuzuu omits limit using the service default when not provided', async () => {
    const service = createFakeService();
    (
      service.search as ReturnType<typeof vi.fn>
    ).mockResolvedValue(knowledgeOk({ query: 'x', strategy: 'lexical-v1', total: 0, results: [] }));
    await withServer(service, async (client) => {
      await callAsToolResult(client, { name: 'search_yuzuu', arguments: { query: 'x' } });
      expect(service.search).toHaveBeenCalledWith('x', {});
    });
  });

  it('get_entity forwards id to getById and returns the item payload', async () => {
    const service = createFakeService();
    (service.getById as ReturnType<typeof vi.fn>).mockResolvedValue(knowledgeOk(baseItem));
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'get_entity',
        arguments: { id: 'yz-studio' },
      });
      expect(result.isError).toBeFalsy();
      expect(service.getById).toHaveBeenCalledWith('yz-studio');
      expect(parseText(result)).toEqual(baseItem);
    });
  });

  it('get_related_entities forwards id to getRelated', async () => {
    const service = createFakeService();
    (service.getRelated as ReturnType<typeof vi.fn>).mockResolvedValue(
      knowledgeOk<RelatedKnowledgeItem[]>([]),
    );
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'get_related_entities',
        arguments: { id: 'yz-studio' },
      });
      expect(result.isError).toBeFalsy();
      expect(service.getRelated).toHaveBeenCalledWith('yz-studio');
      expect(parseText(result)).toEqual([]);
    });
  });

  it('get_project forwards id to getProject', async () => {
    const service = createFakeService();
    const project: ProjectKnowledgeItem = { ...baseItem, type: 'project' };
    (service.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(knowledgeOk(project));
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'get_project',
        arguments: { id: 'p-1' },
      });
      expect(result.isError).toBeFalsy();
      expect(service.getProject).toHaveBeenCalledWith('p-1');
      expect(parseText(result)).toEqual(project);
    });
  });

  it('get_decision forwards id to getDecision', async () => {
    const service = createFakeService();
    const decision: DecisionKnowledgeItem = { ...baseItem, id: 'd-1', type: 'decision' };
    (service.getDecision as ReturnType<typeof vi.fn>).mockResolvedValue(knowledgeOk(decision));
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'get_decision',
        arguments: { id: 'd-1' },
      });
      expect(result.isError).toBeFalsy();
      expect(service.getDecision).toHaveBeenCalledWith('d-1');
      expect(parseText(result)).toEqual(decision);
    });
  });

  it('get_current_state forwards no arguments to getCurrentState', async () => {
    const service = createFakeService();
    const view: CurrentStateView = { item: baseItem, stateItemCount: 1 };
    (service.getCurrentState as ReturnType<typeof vi.fn>).mockResolvedValue(knowledgeOk(view));
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, { name: 'get_current_state' });
      expect(result.isError).toBeFalsy();
      expect(service.getCurrentState).toHaveBeenCalledWith();
      expect(parseText(result)).toEqual(view);
    });
  });

  it('maps a not_found service result to an isError response with code and message', async () => {
    const service = createFakeService();
    (service.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      knowledgeFail('not_found', 'knowledge item "x" not found'),
    );
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, { name: 'get_entity', arguments: { id: 'x' } });
      expect(result.isError).toBe(true);
      const parsed = parseText(result) as { error: { code: string; message: string } };
      expect(parsed.error.code).toBe('not_found');
      expect(parsed.error.message).toBe('knowledge item "x" not found');
    });
  });

  it('redacts credential-like values from error messages before returning them', async () => {
    const service = createFakeService();
    (service.getCurrentState as ReturnType<typeof vi.fn>).mockResolvedValue(
      knowledgeFail('internal_error', 'connection failed token=sk-live-abcdef123456'),
    );
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, { name: 'get_current_state' });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).not.toContain('sk-live-abcdef123456');
      expect(text).toContain('[redacted]');
    });
  });

  it.each([
    ['get_entity', { id: '' }],
    ['search_yuzuu', { query: '' }],
    ['search_yuzuu', { query: 'x', limit: 0 }],
    ['search_yuzuu', { query: 'x', limit: 101 }],
    ['get_entity', { id: 'a'.repeat(257) }],
    ['search_yuzuu', { query: 'x'.repeat(501) }],
  ])('rejects invalid input for %s %s without contacting the service', async (name, args) => {
    const service = createFakeService();
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, { name, arguments: args });
      expect(result.isError).toBe(true);
      for (const method of [
        service.getById,
        service.getRelated,
        service.search,
        service.getProject,
        service.getDecision,
        service.getCurrentState,
      ]) {
        expect(method).not.toHaveBeenCalled();
      }
    });
  });

  it('surfaces an unknown-thrown error as a safe internal_error response', async () => {
    const service = createFakeService();
    (service.getRelated as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('raw driver detail neo4j://localhost:7687');
    });
    await withServer(service, async (client) => {
      const result = await callAsToolResult(client, {
        name: 'get_related_entities',
        arguments: { id: 'x' },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).not.toMatch(/neo4j:\/\//);
      const parsed = parseText(result) as { error: { code: string } };
      expect(parsed.error.code).toBe('internal_error');
    });
  });

  it('never invokes write operations on the injected service', async () => {
    const service = createFakeService();
    (service.getById as ReturnType<typeof vi.fn>).mockResolvedValue(knowledgeOk(baseItem));
    await withServer(service, async (client) => {
      await callAsToolResult(client, { name: 'get_entity', arguments: { id: 'yz-studio' } });
      await callAsToolResult(client, { name: 'get_current_state' });
      await callAsToolResult(client, { name: 'search_yuzuu', arguments: { query: 'a' } });
    });
    expect(service.getById).toHaveBeenCalledTimes(1);
    expect(service.getCurrentState).toHaveBeenCalledTimes(1);
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(service.getRelated).not.toHaveBeenCalled();
    expect(service.getProject).not.toHaveBeenCalled();
    expect(service.getDecision).not.toHaveBeenCalled();
  });
});