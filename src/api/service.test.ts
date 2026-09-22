import { describe, expect, it } from 'vitest';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import { KnowledgeValidationError } from '../knowledge/index.ts';
import { KnowledgeService } from './index.ts';
import { GraphUnavailableError } from './index.ts';
import type { KnowledgeApiResult } from './index.ts';
import type {
  CanonicalKnowledgeReader,
  GraphKnowledgeNode,
  GraphReader,
  GraphRelationship,
} from './index.ts';

const TS = '2026-09-15T00:00:00+05:30';
const OLD_TS = '2026-09-01T00:00:00+05:30';

interface DocumentOptions {
  body?: string;
  status?: KnowledgeDocument['metadata']['status'];
  source?: KnowledgeDocument['metadata']['source'];
  confidence?: KnowledgeDocument['metadata']['confidence'];
  updated_at?: string;
  relationships?: KnowledgeDocument['metadata']['relationships'];
  provenance?: KnowledgeDocument['metadata']['provenance'];
  approval?: KnowledgeDocument['metadata']['approval'];
}

function document(id: string, type: string, title: string, options: DocumentOptions = {}): KnowledgeDocument {
  const metadata: KnowledgeDocument['metadata'] = {
    id,
    type: type as KnowledgeDocument['metadata']['type'],
    title,
    status: options.status ?? 'active',
    created_at: TS,
    updated_at: options.updated_at ?? TS,
    source: options.source ?? 'manual',
    confidence: options.confidence ?? 'high',
    ...(options.relationships !== undefined ? { relationships: options.relationships } : {}),
    ...(options.provenance !== undefined ? { provenance: options.provenance } : {}),
    ...(options.approval !== undefined ? { approval: options.approval } : {}),
  };
  return {
    metadata,
    body: options.body ?? '# Title\n\nBody paragraph about MerchantOne and websites.\n',
    filePath: `knowledge/${id}.md`,
  };
}

function graphNode(id: string, type: string, title: string): GraphKnowledgeNode {
  return {
    id,
    type,
    title,
    status: 'active',
    created_at: TS,
    updated_at: TS,
    source: 'manual',
    confidence: 'high',
    file_path: `knowledge/${id}.md`,
  };
}

class FakeCanonicalReader implements CanonicalKnowledgeReader {
  constructor(private readonly documents: KnowledgeDocument[]) {}

  async getById(id: string): Promise<KnowledgeDocument | undefined> {
    return this.documents.find((doc) => doc.metadata.id === id);
  }

  async list(): Promise<KnowledgeDocument[]> {
    return [...this.documents];
  }

  refresh(): void {}
}

class FakeGraphReader implements GraphReader {
  constructor(
    private readonly readings: GraphRelationship[] | ((id: string) => GraphRelationship[]),
    private readonly throwWith?: () => Error,
  ) {}

  async getRelationshipsFor(id: string): Promise<GraphRelationship[]> {
    if (this.throwWith) {
      throw this.throwWith();
    }
    return typeof this.readings === 'function' ? this.readings(id) : [...this.readings];
  }
}

function serviceWith(canonical: CanonicalKnowledgeReader, graph: GraphReader): KnowledgeService {
  return new KnowledgeService(canonical, graph);
}

function okValue<T>(result: KnowledgeApiResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.value;
}

function errorCode<T>(result: KnowledgeApiResult<T>): string {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected error result');
  }
  return result.error.code;
}

describe('KnowledgeService', () => {
  it('getById returns the expected canonical item', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([]),
    );
    const item = okValue(await service.getById('yz-studio'));
    expect(item).toEqual({
      id: 'yz-studio',
      type: 'organization',
      title: 'Yuzuu Studio',
      status: 'active',
      created_at: TS,
      updated_at: TS,
      source: 'manual',
      confidence: 'high',
      body: expect.stringContaining('MerchantOne'),
      filePath: 'knowledge/yz-studio.md',
    });
  });

  it('getById reports not found correctly', async () => {
    const service = serviceWith(new FakeCanonicalReader([]), new FakeGraphReader([]));
    expect(errorCode(await service.getById('does-not-exist'))).toBe('not_found');
  });

  it('getById returns invalid_request for a malformed id', async () => {
    const service = serviceWith(new FakeCanonicalReader([]), new FakeGraphReader([]));
    expect(errorCode(await service.getById('Not A Valid Id @#'))).toBe('invalid_request');
  });

  it('getRelated maps graph relationships into typed API results', async () => {
    const readings: GraphRelationship[] = [
      {
        type: 'OWNS',
        source: graphNode('yz-studio', 'organization', 'Yuzuu Studio'),
        target: graphNode('yz-product', 'product', 'Product'),
      },
      {
        type: 'PART_OF',
        source: graphNode('yz-project', 'project', 'Project'),
        target: graphNode('yz-studio', 'organization', 'Yuzuu Studio'),
      },
    ];
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader(readings),
    );
    const related = okValue(await service.getRelated('yz-studio'));
    expect(related).toHaveLength(2);
    expect(related[0]).toEqual({
      id: 'yz-product',
      type: 'product',
      title: 'Product',
      status: 'active',
      created_at: TS,
      updated_at: TS,
      source: 'manual',
      confidence: 'high',
      filePath: 'knowledge/yz-product.md',
      relationship: { sourceId: 'yz-studio', type: 'OWNS', targetId: 'yz-product' },
      direction: 'outgoing',
    });
    expect(related[1]).toEqual({
      id: 'yz-project',
      type: 'project',
      title: 'Project',
      status: 'active',
      created_at: TS,
      updated_at: TS,
      source: 'manual',
      confidence: 'high',
      filePath: 'knowledge/yz-project.md',
      relationship: { sourceId: 'yz-project', type: 'PART_OF', targetId: 'yz-studio' },
      direction: 'incoming',
    });
  });

  it('getRelated returns not_found when the source item does not exist canonically', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([]),
      new FakeGraphReader([
        {
          type: 'OWNS',
          source: graphNode('yz-studio', 'organization', 'Yuzuu Studio'),
          target: graphNode('yz-product', 'product', 'Product'),
        },
      ]),
    );
    expect(errorCode(await service.getRelated('yz-studio'))).toBe('not_found');
  });

  it('getRelated does not infer prose relationships', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([
        document('yz-studio', 'organization', 'Yuzuu Studio', {
          body: '# Studio\n\nDevelops and offers MerchantOne.',
        }),
      ]),
      new FakeGraphReader([]),
    );
    const related = okValue(await service.getRelated('yz-studio'));
    expect(related).toEqual([]);
  });

  it('getRelated returns graph_unavailable when the graph cannot be read', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([], () => new GraphUnavailableError('Neo4j down')),
    );
    const result = await service.getRelated('yz-studio');
    expect(errorCode(result)).toBe('graph_unavailable');
    if (result.ok) return;
    expect(result.error.message).toBe('knowledge graph is unavailable');
  });

  it('search finds matching canonical knowledge and explains the match', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([
        document('yz-studio', 'organization', 'Yuzuu Studio', { body: '# Studio\n\nPremium websites.' }),
        document('yz-merchant-one', 'product', 'MerchantOne', {
          body: '# MerchantOne\n\nInvoicing and POS.',
        }),
      ]),
      new FakeGraphReader([]),
    );
    const response = okValue(await service.search('MerchantOne'));
    expect(response.strategy).toBe('lexical-v1');
    expect(response.total).toBe(1);
    expect(response.results[0]).toMatchObject({
      item: { id: 'yz-merchant-one', title: 'MerchantOne' },
      matchedFields: ['title', 'body'],
      matchedTerms: ['merchantone'],
    });
  });

  it('search scores title matches above body-only matches', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([
        document('yz-a', 'product', 'Invoicing software'),
        document('yz-b', 'product', 'Other', { body: '# Other\n\nInvoicing is mentioned here only.' }),
      ]),
      new FakeGraphReader([]),
    );
    const response = okValue(await service.search('invoicing'));
    expect(response.results.map((r) => r.item.id)).toEqual(['yz-a', 'yz-b']);
    expect(response.results[0]!.score).toBeGreaterThan(response.results[1]!.score);
  });

  it('search results have stable deterministic ordering', async () => {
    const docs = [
      document('yz-one', 'product', 'Sigma thing'),
      document('yz-two', 'product', 'Alpha sigma'),
    ];
    const first = serviceWith(new FakeCanonicalReader(docs), new FakeGraphReader([]));
    const second = serviceWith(new FakeCanonicalReader([...docs].reverse()), new FakeGraphReader([]));
    const resultA = okValue(await first.search('sigma'));
    const resultB = okValue(await second.search('sigma'));
    expect(resultA.results).toEqual(resultB.results);
    expect(resultA.results.map((r) => r.item.id)).toEqual(['yz-one', 'yz-two']);
  });

  it('search rejects an empty query as invalid_request', async () => {
    const service = serviceWith(new FakeCanonicalReader([]), new FakeGraphReader([]));
    expect(errorCode(await service.search('   '))).toBe('invalid_request');
  });

  it('search rejects an out-of-range limit as invalid_request', async () => {
    const service = serviceWith(new FakeCanonicalReader([]), new FakeGraphReader([]));
    expect(errorCode(await service.search('x', { limit: 0 }))).toBe('invalid_request');
  });

  it('getProject returns a project item', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-project', 'project', 'Knowledge System')]),
      new FakeGraphReader([]),
    );
    const item = okValue(await service.getProject('yz-project'));
    expect(item.type).toBe('project');
    expect(item.id).toBe('yz-project');
  });

  it('getProject rejects a non-project item with a typed error', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([]),
    );
    const result = await service.getProject('yz-studio');
    expect(errorCode(result)).toBe('invalid_request');
    if (result.ok) return;
    expect(result.error.details).toEqual({ expectedType: 'project', actualType: 'organization' });
  });

  it('getDecision returns a decision item preserving canonical metadata', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([
        document('yz-decision', 'decision', 'Adopt canonical source of truth', {
          status: 'active',
          source: 'decision_record',
          confidence: 'high',
          provenance: { author: 'arvi', source_reference: 'user-approved decision' },
          approval: { status: 'approved', approved_at: TS, approved_by: 'arvi' },
        }),
      ]),
      new FakeGraphReader([]),
    );
    const item = okValue(await service.getDecision('yz-decision'));
    expect(item).toMatchObject({
      type: 'decision',
      status: 'active',
      source: 'decision_record',
      confidence: 'high',
      created_at: TS,
      updated_at: TS,
      provenance: { author: 'arvi', source_reference: 'user-approved decision' },
      approval: { status: 'approved', approved_at: TS, approved_by: 'arvi' },
    });
  });

  it('getDecision rejects a non-decision item', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([]),
    );
    const result = await service.getDecision('yz-studio');
    expect(errorCode(result)).toBe('invalid_request');
    if (result.ok) return;
    expect(result.error.details).toEqual({ expectedType: 'decision', actualType: 'organization' });
  });

  it('getCurrentState returns not_available when no state item exists', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([]),
    );
    expect(errorCode(await service.getCurrentState())).toBe('not_available');
  });

  it('getCurrentState returns the most recently updated state item', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([
        document('yz-state-old', 'state', 'Old state', { updated_at: OLD_TS }),
        document('yz-state-new', 'state', 'New state'),
      ]),
      new FakeGraphReader([]),
    );
    const view = okValue(await service.getCurrentState());
    expect(view.item.id).toBe('yz-state-new');
    expect(view.stateItemCount).toBe(2);
  });

  it('maps repository validation failures to repository_validation_failed', async () => {
    const reader = new FakeCanonicalReader([]);
    reader.getById = async () => {
      throw new KnowledgeValidationError([]);
    };
    const service = serviceWith(reader, new FakeGraphReader([]));
    expect(errorCode(await service.getById('yz-studio'))).toBe('repository_validation_failed');
  });

  it('API errors do not expose secrets', async () => {
    const service = serviceWith(
      new FakeCanonicalReader([document('yz-studio', 'organization', 'Yuzuu Studio')]),
      new FakeGraphReader([], () => new GraphUnavailableError('auth failed password=F9x7!secret token=abc123')),
    );
    const result = await service.getRelated('yz-studio');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/F9x7!secret/i);
    expect(JSON.stringify(result)).not.toMatch(/abc123/i);
    if (result.ok) return;
    expect(result.error.code).toBe('graph_unavailable');
  });

  it('internal failures do not expose raw error messages', async () => {
    const reader = new FakeCanonicalReader([]);
    reader.list = async () => {
      throw new Error('sensitive internal detail: password=hunter2');
    };
    const service = serviceWith(reader, new FakeGraphReader([]));
    const result = await service.getCurrentState();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/hunter2/i);
  });
});