import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeApiError, KnowledgeApiResult } from '../../../src/api/index.ts';
import { sanitizeDetail, safeReason } from '../../../src/api/errors.ts';
import type { KnowledgeServiceLike } from './create-server.ts';

const ID_ARG_MAX_LENGTH = 256;
const SEARCH_QUERY_MAX_LENGTH = 500;
const SEARCH_LIMIT_MAX = 100;

const idArg = { id: z.string().min(1).max(ID_ARG_MAX_LENGTH) };
const searchArg = {
  query: z.string().min(1).max(SEARCH_QUERY_MAX_LENGTH),
  limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
};

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: KnowledgeApiError): CallToolResult {
  const payload: { code: string; message: string; details?: Record<string, string> } = {
    code: error.code,
    message: sanitizeDetail(error.message),
  };
  if (error.details !== undefined) {
    payload.details = { ...error.details };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: payload }, null, 2) }],
    isError: true,
  };
}

function fromResult<T>(result: KnowledgeApiResult<T>): CallToolResult {
  return result.ok ? ok(result.value) : fail(result.error);
}

async function run<T>(
  operation: () => Promise<KnowledgeApiResult<T>>,
): Promise<CallToolResult> {
  try {
    return fromResult(await operation());
  } catch (error) {
    return fail({
      code: 'internal_error',
      message: `internal knowledge retrieval failure (${safeReason(error)})`,
    });
  }
}

/**
 * Registers the six read-only Yuzuu tools on the given server.
 *
 * Every tool returns the Knowledge Service payload as a single pretty-printed
 * JSON text block. Service errors are surfaced as `isError: true` with `{ error:
 * { code, message } }` so callers keep structured error semantics.
 */
export function registerKnowledgeTools(server: McpServer, service: KnowledgeServiceLike): void {
  server.registerTool(
    'search_yuzuu',
    {
      title: 'Search Yuzuu knowledge',
      description:
        'Deterministic lexical search over Yuzuu knowledge items (id, type, title, status, source, confidence, body). Each query term must match at least one field; matches are weighted and ordered by score. Returns up to limit results (default 20, max 100). This is deterministic keyword search, not vector-based retrieval.',
      inputSchema: searchArg,
    },
    async (args) =>
      run(() =>
        service.search(args.query, args.limit === undefined ? {} : { limit: args.limit }),
      ),
  );

  server.registerTool(
    'get_entity',
    {
      title: 'Get knowledge entity',
      description:
        'Retrieves one canonical Yuzuu knowledge item by its stable id, with its full canonical body and provenance.',
      inputSchema: idArg,
    },
    async (args) => run(() => service.getById(args.id)),
  );

  server.registerTool(
    'get_related_entities',
    {
      title: 'Get related entities',
      description:
        'Returns explicitly represented one-hop graph relationships for the given knowledge item, in both directions (outgoing and incoming). Only relationships created from structured frontmatter are returned.',
      inputSchema: idArg,
    },
    async (args) => run(() => service.getRelated(args.id)),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'Retrieves a canonical knowledge item guaranteed to be of type "project". Returns an invalid_request error if the item exists with a different type.',
      inputSchema: idArg,
    },
    async (args) => run(() => service.getProject(args.id)),
  );

  server.registerTool(
    'get_decision',
    {
      title: 'Get decision',
      description:
        'Retrieves a canonical knowledge item guaranteed to be of type "decision". Hypotheses and prose are never reinterpreted as decisions.',
      inputSchema: idArg,
    },
    async (args) => run(() => service.getDecision(args.id)),
  );

  server.registerTool(
    'get_current_state',
    {
      title: 'Get current state',
      description:
        'Returns the current canonical state of the Yuzuu knowledgebase: the most recently updated state item and the number of state items. Returns not_available when no state item exists.',
    },
    async () => run(() => service.getCurrentState()),
  );
}