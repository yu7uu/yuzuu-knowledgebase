# Yuzuu Knowledge Graph — Initial Projection Specification

> Status: design/specification. No Neo4j code, constraints, or indexes are implemented yet.

## 1. Purpose

This document defines the minimal Neo4j graph projection for the current canonical
knowledge model. It specifies how canonical Markdown/YAML Knowledge Items map into a
graph so that later milestones can implement synchronization, indexing, and traversal.

The scope is intentionally small. It covers what the repository contains today: a single
typed Knowledge Item model, validated metadata, optional structured relationships, and
optional provenance/approval fields.

## 2. Source-of-truth rule

AUTHORITATIVE:

- canonical Markdown/YAML in `knowledge/`
- Git history

DERIVED:

- Neo4j node labels, properties, relationships
- Neo4j indexes and constraints
- search indexes, embeddings, and any other derived layer

Neo4j is a derived projection. It must never become the only copy of knowledge. It must
be possible to delete Neo4j entirely and rebuild the same logical graph from the
canonical repository.

## 3. Graph projection principles

1. One canonical Knowledge Item maps to exactly one graph node.
2. Node properties mirror validated canonical metadata (and only that metadata).
3. Edges are created ONLY from explicit structured `relationships` frontmatter.
4. Nothing is inferred from Markdown prose — not entities, not edges, not properties.
5. The graph contains no information that cannot be traced back to a canonical file or
   to metadata explicitly derived from canonical files (such as the file path).
6. The mapping is deterministic: the same canonical input always produces the same
   logical graph.
7. The ontology stays minimal until real use cases require expanding it.

## 4. Initial node model

A single node label represents a canonical Knowledge Item:

```text
(:KnowledgeItem)
```

There are no other node types in the first projection. No nodes for organizations,
products, services, projects, paragraphs, headings, keywords, mentions, sessions, or
documents. The canonical `type` (organization, project, decision, …) is NOT used to
create additional labels (see §5).

## 5. Node properties

All properties are stored as strings and mirror the canonical metadata keys exactly.
Optional fields are stored only when present in the canonical frontmatter.

| Property     | Source (canonical field)                         | Always present |
|--------------|--------------------------------------------------|----------------|
| `id`         | `id`                                             | yes            |
| `type`       | `type`                                           | yes            |
| `title`      | `title`                                          | yes            |
| `status`     | `status`                                         | yes            |
| `created_at` | `created_at`                                     | yes            |
| `updated_at` | `updated_at`                                     | yes            |
| `source`     | `source`                                         | yes            |
| `confidence` | `confidence`                                     | yes            |
| `file_path`  | derived: canonical file path                     | yes            |
| `source_session`    | `provenance.source_session`     | when present    |
| `source_document`   | `provenance.source_document`    | when present    |
| `source_reference`  | `provenance.source_reference`   | when present    |
| `author`     | `provenance.author`              | when present    |
| `approval_status`    | `approval.status`     | when present    |
| `approval_approved_at` | `approval.approved_at` | when present    |
| `approval_approved_by` | `approval.approved_by` | when present    |

Rule: no property may be invented beyond validated canonical metadata and `file_path`.
If SCHEMA.md defines a new optional field in the future, it is projected the same way.

## 6. Label/type strategy

Decision: `type` is a **property**, not a label (single `:KnowledgeItem` label only).

Rationale, evaluated against this project's requirements:

- **Reliable lookup** — canonical ID is unique and indexed (§10). Lookup does not need
  type labels.
- **Filtering** — filtering by type uses a property index (`type`). Equivalent query
  performance for the current dataset size.
- **Future graph traversal** — traversals filter on `type` as a property. If traffic
  patterns later demand label-scoped scans, adding a label for a specific type is a
  non-breaking additive change; removing that option today is not a loss.
- **Schema evolution** — adding a new canonical `type` value changes a property value,
  not the graph schema. With per-type labels, every vocabulary addition would require a
  graph migration and could strand mismatched labels.
- **Rebuildability** — a single label keeps the projection a 1:1 mechanical mirror of
  validated metadata. Property-based types cannot drift from canonical data.
- **Simple implementation** — one label, one property set, one merge key.

Option A (per-type labels like `:Organization`) and option C (both) were rejected: they
duplicate the canonical vocabulary into the Neo4j schema, add migration burden for a
small ontology, and invite label/property inconsistency. A label may be introduced later
as a derived convenience for a hot type if real usage justifies it — additively.

## 7. Relationship projection rules

The relationship vocabulary is the SCHEMA.md vocabulary, unchanged:

```text
OWNS OFFERS CONTAINS INCLUDES CREATED BUILT_FOR BELONGS_TO USES DEPENDS_ON
RELATED_TO SUPPORTS REQUIRES TARGETS SERVES PART_OF DECIDED_BY SUPERSEDES
SUPERSEDED_BY CONFLICTS_WITH DERIVED_FROM SOURCED_FROM MENTIONED_IN BLOCKED_BY ENABLES
```

Rules:

1. An edge is created ONLY for an entry in the explicit `relationships:` frontmatter
   block of a canonical file.
2. The relationship type in Neo4j is the SCHEMA.md vocabulary value itself
   (e.g. `:OWNS`, `:PART_OF`, `:SUPERSEDES`).
3. `target` is a canonical Knowledge Item `id`. The edge connects the source node to the
   node whose `id` equals `target`.
4. An edge is created only when both endpoint nodes exist. If a `target` id has no
   canonical file (an explicitly unresolved reference), the synchronization must not
   fabricate a node: it skips the edge and reports the unresolved target for human
   review. This matches SCHEMA.md validation rule 10 ("relationship targets exist or are
   explicitly unresolved").
5. A dirty/rollback-free rule for rebuilds: edges are recomputed entirely from
   canonical data on each sync; they are never edited manually in Neo4j.

Current canonical data contains NO explicit `relationships:` blocks, so the first real
sync produces only `KnowledgeItem` nodes and zero edges.

### Prose inference is forbidden

The canonical body is prose, not structured knowledge. Text such as:

> "Yuzuu Studio also develops and offers MerchantOne"

does NOT automatically produce `(:KnowledgeItem)-[:OFFERS]->(:KnowledgeItem)`. Only
structured relationship metadata can create an edge. This rule is absolute; entity
resolution and mention extraction are explicitly out of scope for this projection.

## 8. Provenance strategy

A graph result must always be traceable to its canonical source. Every node therefore
stores:

- `id` — canonical Knowledge Item identity.
- `file_path` — the canonical file the node was projected from; consumers read the
  authoritative body from this file.
- `source` — the canonical origin enum (manual, chatgpt, …), part of the metadata.
- `created_at` / `updated_at` — canonical timestamps.
- `provenance.*` and `approval.*` fields — projected verbatim when present in the
  canonical frontmatter (§5).

No provenance fields beyond those defined by SCHEMA.md are supported.

## 9. Canonical body strategy

Decision: the full Markdown body is NOT stored in Neo4j.

Rationale:

- The canonical body is authoritative; Neo4j must not become a second content store.
- Embedding, summarization, or hybrid retrieval is a separate derived layer built from
  canonical content later — not part of graph nodes.
- A graph node carries only the traceability needed to reach the body: `id` and
  `file_path`. A traversal result points back to the canonical file, and the consumer
  (API, MCP, dashboard) reads the body from `file_path` on demand.

No summary, keyword chunk, or truncated snippet is generated in this projection.

## 10. Constraints/indexes planned for later

Not created now. Documented so the future synchronization milestone implements:

1. **Uniqueness of canonical ID** — UNIQUE constraint on `KnowledgeItem.id`. This gives
   both integrity and an idempotent merge key for rebuilds.
2. **Lookup by type** — index on `KnowledgeItem.type`.
3. **Lookup by status** — index on `KnowledgeItem.status`.
4. **Lookup by source** — index on `KnowledgeItem.source`.
5. **Lookup by file path** — index on `KnowledgeItem.file_path` (traceability).
6. **Future full-text / vector indexes** — for derived text and embeddings, built later
   from canonical content, not from graph node properties. These are separate derived
   layers and must not become the only copy of any content.

Indexes (2)–(5) are optional conveniences for a small dataset; the uniqueness
constraint in (1) is the only structural requirement.

## 11. Rebuildability invariant

If Neo4j is deleted completely:

```text
canonical Markdown/YAML (knowledge/)  →  validate  →  parse  →  sync  →  same logical graph
```

The invariant holds because the projection is a deterministic function of validated
canonical data: one node per Knowledge Item with fixed properties, edges only from
explicit structured relationships, and the mapping defined in this document. No sync
step may consult Neo4j's previous state as an input; the graph is always reconstructed
from canonical files.

## 12. Explicit non-goals (version 1)

- No Neo4j driver, connection, constraints, or indexes yet.
- No full Markdown body, summary, or content in graph nodes.
- No embeddings, vector search, or full-text index.
- No semantic graph, NLP, entity resolution, or mention/paragraph/heading/keyword nodes.
- No conflict detection or AI session ingestion.
- No inferred edges or entities from prose.
- No graph mutations performed manually; Neo4j is written only by the future
  synchronization process.
- No separate nodes for brands, products, services, projects, etc. Their canonical
  `type` is a property on `:KnowledgeItem`.

## 13. Concrete example — `knowledge/core/yuzuu-studio.md`

Canonical frontmatter (verbatim):

```yaml
id: yz-studio
type: organization
title: Yuzuu Studio
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: high
```

No `relationships:`, `provenance:`, or `approval:` block is present.

Projected graph (illustrative Cypher — not executed):

```cypher
MERGE (item:KnowledgeItem { id: "yz-studio" })
SET item.type = "organization",
    item.title = "Yuzuu Studio",
    item.status = "active",
    item.created_at = "2026-09-15T00:00:00+05:30",
    item.updated_at = "2026-09-15T00:00:00+05:30",
    item.source = "manual",
    item.confidence = "high",
    item.file_path = "knowledge/core/yuzuu-studio.md"
```

Result: exactly one `:KnowledgeItem` node with nine properties. **Zero edges.**

In particular, the Markdown body contains the sentence "Yuzuu Studio also develops and
offers MerchantOne". This does not create an `[:OFFERS]` edge to any product node. No
MerchantOne node exists, because no canonical file declares an item with that id and no
structured relationship declares this edge. The mention lives only in canonical prose.

### Illustrative relationship mapping (hypothetical — not present in current data)

If a future canonical file declared structured metadata, for example:

```yaml
---
id: yz-merchant-one
type: product
title: MerchantOne
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: medium
relationships:
  - type: OFFERS
    target: yz-studio
---
```

it would project to:

```cypher
MERGE (item:KnowledgeItem { id: "yz-merchant-one" })
SET item.type = "product",
    item.title = "MerchantOne",
    item.status = "active",
    item.created_at = "2026-09-15T00:00:00+05:30",
    item.updated_at = "2026-09-15T00:00:00+05:30",
    item.source = "manual",
    item.confidence = "medium",
    item.file_path = "knowledge/core/yz-merchant-one.md"

MERGE (studio:KnowledgeItem { id: "yz-studio" })
MERGE (item)-[:OFFERS]->(studio)
```

The edge exists only because the canonical frontmatter declares it explicitly: the
relationship type comes from the SCHEMA.md vocabulary, and the target comes from
`target: yz-studio`. Neither is inferred from prose.