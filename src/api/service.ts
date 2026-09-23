import {
  RELATIONSHIP_TYPES,
  confidenceSchema,
  idSchema,
  sourceSchema,
  statusSchema,
  typeSchema,
} from '../knowledge/schema.ts';
import { KnowledgeFormatError, KnowledgeValidationError } from '../knowledge/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import {
  GraphUnavailableError,
  RepositoryLoadError,
  knowledgeFail,
  knowledgeFailFromError,
  knowledgeOk,
  safeReason,
  sanitizeDetail,
} from './errors.ts';
import type { KnowledgeApiError, KnowledgeApiResult } from './errors.ts';
import type {
  CanonicalKnowledgeReader,
  GraphReader,
  GraphRelationship,
} from './readers.ts';
import type {
  CurrentStateView,
  DecisionKnowledgeItem,
  KnowledgeItem,
  KnowledgeItemSummary,
  ProjectKnowledgeItem,
  RelatedKnowledgeItem,
  Relationship,
  SearchField,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchStrategy,
} from './types.ts';
import { SEARCH_FIELDS } from './types.ts';

const KNOWN_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES);
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
const SEARCH_STRATEGY: SearchStrategy = 'lexical-v1';

const SEARCH_FIELD_WEIGHTS: Readonly<Record<SearchField, number>> = {
  id: 4,
  type: 2,
  title: 3,
  status: 1,
  source: 1,
  confidence: 1,
  body: 1,
};

interface SearchableFields {
  id: string;
  type: string;
  title: string;
  status: string;
  source: string;
  confidence: string;
  body: string;
}

function truncateValue(value: string): string {
  return value.length > 100 ? `${value.slice(0, 100)}…` : value;
}

function toKnowledgeItem(document: KnowledgeDocument): KnowledgeItem {
  return { ...document.metadata, body: document.body, filePath: document.filePath };
}

function toSummary(document: KnowledgeDocument): KnowledgeItemSummary {
  const m = document.metadata;
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    status: m.status,
    created_at: m.created_at,
    updated_at: m.updated_at,
    source: m.source,
    confidence: m.confidence,
    filePath: document.filePath,
  };
}

function searchableFields(item: KnowledgeItem): SearchableFields {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    source: item.source,
    confidence: item.confidence,
    body: item.body,
  };
}

function scoreDocument(
  terms: readonly string[],
  fields: SearchableFields,
): { score: number; matchedFields: SearchField[] } | undefined {
  const matched = new Set<SearchField>();
  let score = 0;
  for (const term of terms) {
    let anyFieldMatched = false;
    for (const field of SEARCH_FIELDS) {
      if (fields[field].toLowerCase().includes(term)) {
        anyFieldMatched = true;
        score += SEARCH_FIELD_WEIGHTS[field];
        matched.add(field);
      }
    }
    if (!anyFieldMatched) {
      return undefined;
    }
  }
  return { score, matchedFields: matched.size === 0 ? [] : SEARCH_FIELDS.filter((f) => matched.has(f)) };
}

function compareRelatedItems(a: RelatedKnowledgeItem, b: RelatedKnowledgeItem): number {
  return (
    a.relationship.type.localeCompare(b.relationship.type) ||
    a.id.localeCompare(b.id) ||
    a.direction.localeCompare(b.direction)
  );
}

function compareNewestFirst(a: KnowledgeDocument, b: KnowledgeDocument): number {
  const byUpdated = b.metadata.updated_at.localeCompare(a.metadata.updated_at);
  if (byUpdated !== 0) {
    return byUpdated;
  }
  return a.metadata.id.localeCompare(b.metadata.id);
}

function mapRelated(reading: GraphRelationship, id: string): KnowledgeApiResult<RelatedKnowledgeItem> {
  const outgoing = reading.source.id === id;
  if (!outgoing && reading.target.id !== id) {
    return knowledgeFail('internal_error', 'graph reader returned a relationship unrelated to the requested item', {
      reason: 'graph reader contract violation',
    });
  }
  const other = outgoing ? reading.target : reading.source;

  const type = typeSchema.safeParse(other.type);
  const status = statusSchema.safeParse(other.status);
  const source = sourceSchema.safeParse(other.source);
  const confidence = confidenceSchema.safeParse(other.confidence);
  if (!type.success || !status.success || !source.success || !confidence.success) {
    return knowledgeFail('internal_error', 'graph returned an item that failed canonical validation', {
      reason: 'graph node properties are not valid canonical knowledge metadata',
    });
  }

  if (!KNOWN_RELATIONSHIP_TYPES.has(reading.type)) {
    return knowledgeFail('internal_error', 'graph returned a relationship type outside the canonical vocabulary', {
      reason: `relationship type "${reading.type}" is not part of the canonical vocabulary`,
    });
  }

  const relationship: Relationship = {
    sourceId: reading.source.id,
    type: reading.type as Relationship['type'],
    targetId: reading.target.id,
  };
  const item: RelatedKnowledgeItem = {
    id: other.id,
    type: type.data,
    title: other.title,
    status: status.data,
    created_at: other.created_at,
    updated_at: other.updated_at,
    source: source.data,
    confidence: confidence.data,
    filePath: other.file_path,
    relationship,
    direction: outgoing ? 'outgoing' : 'incoming',
  };
  return knowledgeOk(item);
}

function mapErrorToResult<T>(error: unknown): KnowledgeApiResult<T> {
  if (error instanceof RepositoryLoadError) {
    return knowledgeFail('repository_validation_failed', error.message, {
      file: error.filePath,
      reason: error.reason,
    });
  }
  if (error instanceof KnowledgeFormatError || error instanceof KnowledgeValidationError) {
    return knowledgeFail('repository_validation_failed', 'canonical knowledge repository is invalid', {
      reason: sanitizeDetail(error.message),
    });
  }
  if (error instanceof GraphUnavailableError) {
    return knowledgeFail('graph_unavailable', error.message, { reason: error.reason });
  }
  return knowledgeFail('internal_error', 'internal knowledge retrieval failure', { reason: safeReason(error) });
}

/**
 * Read-only Knowledge API service.
 *
 * Future interfaces (MCP, HTTP, CLI, agents) should depend on this boundary. It
 * exposes typed operations over canonical knowledge and the Neo4j projection
 * without ever exposing raw storage, Cypher, or driver objects.
 *
 * Results are deterministic for an equivalent repository/graph state.
 */
export class KnowledgeService {
  private readonly canonical: CanonicalKnowledgeReader;
  private readonly graph: GraphReader;
  private readonly onClose?: () => Promise<void>;

  constructor(
    canonical: CanonicalKnowledgeReader,
    graph: GraphReader,
    onClose?: () => Promise<void>,
  ) {
    this.canonical = canonical;
    this.graph = graph;
    this.onClose = onClose;
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }

  refresh(): void {
    this.canonical.refresh();
  }

  private idOrError(id: string): { kind: 'id'; value: string } | { kind: 'error'; error: KnowledgeApiError } {
    const parsed = idSchema.safeParse(id);
    if (parsed.success) {
      return { kind: 'id', value: parsed.data };
    }
    return {
      kind: 'error',
      error: { code: 'invalid_request', message: `invalid knowledge item id "${truncateValue(id)}"` },
    };
  }

  private async run<T>(operation: () => Promise<KnowledgeApiResult<T>>): Promise<KnowledgeApiResult<T>> {
    try {
      return await operation();
    } catch (error) {
      return mapErrorToResult<T>(error);
    }
  }

  /**
   * Retrieves a canonical Knowledge Item by its stable id. The canonical
   * repository is authoritative and does not require the graph to be present.
   */
  async getById(id: string): Promise<KnowledgeApiResult<KnowledgeItem>> {
    return this.run(async () => {
      const identity = this.idOrError(id);
      if (identity.kind === 'error') {
        return knowledgeFailFromError(identity.error);
      }
      const document = await this.canonical.getById(identity.value);
      if (document === undefined) {
        return knowledgeFail('not_found', `knowledge item "${identity.value}" not found`);
      }
      return knowledgeOk(toKnowledgeItem(document));
    });
  }

  /**
   * Returns explicitly represented graph relationships (both directions, one
   * hop) for a canonical Knowledge Item. Only relationships created from
   * structured frontmatter are returned; Markdown prose is never used to infer
   * relatedness.
   */
  async getRelated(id: string): Promise<KnowledgeApiResult<RelatedKnowledgeItem[]>> {
    return this.run(async () => {
      const identity = this.idOrError(id);
      if (identity.kind === 'error') {
        return knowledgeFailFromError(identity.error);
      }
      const document = await this.canonical.getById(identity.value);
      if (document === undefined) {
        return knowledgeFail('not_found', `knowledge item "${identity.value}" not found`);
      }
      const readings = await this.graph.getRelationshipsFor(identity.value);
      const related: RelatedKnowledgeItem[] = [];
      for (const reading of readings) {
        const mapped = mapRelated(reading, identity.value);
        if (!mapped.ok) {
          return mapped;
        }
        related.push(mapped.value);
      }
      related.sort(compareRelatedItems);
      return knowledgeOk(related);
    });
  }

  /**
   * Deterministic lexical search over canonical metadata (id, type, title,
   * status, source, confidence) and body. Each query term must match at least
   * one field; results are ordered by score, then item id.
   *
   * This is the initial lexical implementation; it can later be extended into
   * hybrid (lexical + semantic) search without changing the result contract.
   */
  async search(query: string, options: SearchOptions = {}): Promise<KnowledgeApiResult<SearchResponse>> {
    return this.run(async () => {
      const trimmed = query.trim();
      if (trimmed === '') {
        return knowledgeFail('invalid_request', 'search query must not be empty');
      }
      if (trimmed.length > MAX_QUERY_LENGTH) {
        return knowledgeFail('invalid_request', `search query must not exceed ${MAX_QUERY_LENGTH} characters`);
      }
      const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
      if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_RESULT_LIMIT) {
        return knowledgeFail('invalid_request', `search limit must be an integer between 1 and ${MAX_RESULT_LIMIT}`);
      }
      const terms = trimmed.toLowerCase().split(/\s+/);

      const documents = await this.canonical.list();
      const matches: SearchResult[] = [];
      for (const document of documents) {
        const scored = scoreDocument(terms, searchableFields(toKnowledgeItem(document)));
        if (scored === undefined) {
          continue;
        }
        matches.push({
          item: toSummary(document),
          score: scored.score,
          matchedFields: scored.matchedFields,
          matchedTerms: [...terms],
        });
      }
      matches.sort(
        (a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id),
      );
      return knowledgeOk({
        query: trimmed,
        strategy: SEARCH_STRATEGY,
        total: matches.length,
        results: matches.slice(0, limit),
      });
    });
  }

  /**
   * Retrieves a canonical Knowledge Item guaranteed to be a `project`. If the
   * item exists but has another type, an `invalid_request` error is returned.
   */
  async getProject(id: string): Promise<KnowledgeApiResult<ProjectKnowledgeItem>> {
    return this.run(async () => {
      const identity = this.idOrError(id);
      if (identity.kind === 'error') {
        return knowledgeFailFromError(identity.error);
      }
      const document = await this.canonical.getById(identity.value);
      if (document === undefined) {
        return knowledgeFail('not_found', `knowledge item "${identity.value}" not found`);
      }
      const item = toKnowledgeItem(document);
      if (item.type !== 'project') {
        return knowledgeFail('invalid_request', `knowledge item "${identity.value}" has type "${item.type}", not "project"`, {
          expectedType: 'project',
          actualType: item.type,
        });
      }
      return knowledgeOk(item as ProjectKnowledgeItem);
    });
  }

  /**
   * Retrieves a canonical Knowledge Item guaranteed to be a `decision`. Only
   * items whose canonical type is `decision` are returned; hypotheses and
   * prose are never reinterpreted as decisions. Status, source, confidence,
   * timestamps, provenance, and approval are preserved via the canonical
   * metadata.
   */
  async getDecision(id: string): Promise<KnowledgeApiResult<DecisionKnowledgeItem>> {
    return this.run(async () => {
      const identity = this.idOrError(id);
      if (identity.kind === 'error') {
        return knowledgeFailFromError(identity.error);
      }
      const document = await this.canonical.getById(identity.value);
      if (document === undefined) {
        return knowledgeFail('not_found', `knowledge item "${identity.value}" not found`);
      }
      const item = toKnowledgeItem(document);
      if (item.type !== 'decision') {
        return knowledgeFail('invalid_request', `knowledge item "${identity.value}" has type "${item.type}", not "decision"`, {
          expectedType: 'decision',
          actualType: item.type,
        });
      }
      return knowledgeOk(item as DecisionKnowledgeItem);
    });
  }

  /**
   * Returns the current canonical state. The current state is the canonical
   * Knowledge Item(s) of type `state`. The most recently updated state item is
   * selected when more than one exists (ties broken by id ascending).
   * Returns `not_available` when no canonical state item exists.
   */
  async getCurrentState(): Promise<KnowledgeApiResult<CurrentStateView>> {
    return this.run(async () => {
      const documents = await this.canonical.list();
      const states = documents.filter((doc) => doc.metadata.type === 'state');
      if (states.length === 0) {
        return knowledgeFail('not_available', 'no canonical state knowledge item exists');
      }
      states.sort(compareNewestFirst);
      return knowledgeOk({ item: toKnowledgeItem(states[0]!), stateItemCount: states.length });
    });
  }
}