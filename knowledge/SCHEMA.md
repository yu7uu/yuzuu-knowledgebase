# Yuzuu Knowledge Schema

## Purpose

This document defines the canonical structure and rules for persistent knowledge in the Yuzuu Knowledge System.

The canonical knowledge layer is the authoritative source of truth.

Canonical knowledge is human-readable, human-editable, AI-readable, Git-versioned, independent of any specific AI platform, independent of Neo4j, and rebuildable into derived systems.

Persistent knowledge is primarily stored as Markdown files with YAML frontmatter.

Neo4j, search indexes, embeddings, caches, and other derived systems must never become the only copy of knowledge.

If all derived systems are deleted, the knowledge system must be recoverable from the canonical files and Git history.

---

## Knowledge Item

Every persistent knowledge item is a Knowledge Item.

A Knowledge Item represents one meaningful, independently addressable piece of knowledge.

Examples include:

- organizations
- brands
- products
- services
- projects
- decisions
- goals
- tasks
- concepts
- research findings
- documents
- sessions
- current state

Every Knowledge Item must have a stable globally unique `id`.

The ID must remain stable if the title, file location, content, relationships, or lifecycle status changes.

---

## Canonical File Format

Persistent knowledge uses:

YAML frontmatter + Markdown body.

Example:

```yaml
---
id: yz-studio
type: organization
title: Yuzuu Studio
status: active
created_at: 2026-09-15T00:00:00+05:30
updated_at: 2026-09-15T00:00:00+05:30
source: manual
confidence: high
---
````

The YAML frontmatter contains structured metadata.

The Markdown body contains the human-readable knowledge.

A Knowledge Item should remain understandable without Neo4j.

---

## Required Metadata

Every Knowledge Item must contain:

```yaml
id:
type:
title:
status:
created_at:
updated_at:
source:
confidence:
```

### ID

The `id` is the permanent identity of the Knowledge Item.

Rules:

* unique across the knowledge base
* lowercase
* kebab-case
* stable
* never silently reused for another entity

Examples:

```text
yz-studio
yz-brand-merchantone
yz-service-websites
yz-project-knowledge-system
yz-decision-canonical-source-of-truth
```

---

## Knowledge Types

Initial supported types:

```text
organization
brand
product
service
project
decision
goal
task
concept
research
document
session
state
```

The ontology is intentionally small.

New types should only be added when real requirements justify them.

### Organization

A business, company, organization, or team.

### Brand

A brand or named business identity.

### Product

A product or productized system.

### Service

Something Yuzuu offers or intends to offer.

### Project

A bounded body of work.

### Decision

An intentional decision that has actually been made.

A decision should normally document:

* decision
* context
* reasoning
* alternatives considered
* consequences
* what it supersedes

### Goal

An intended outcome.

A goal is not automatically a decision or task.

### Task

Actionable work.

### Concept

An idea, principle, model, terminology, or reusable architectural concept.

### Research

A research finding, investigation, or source-derived insight.

Research should preserve enough provenance to distinguish external evidence from Yuzuu's conclusions.

### Document

A persistent document or important source artifact.

### Session

An AI or human working session intentionally retained for provenance or later processing.

A session is not automatically permanent knowledge.

### State

Current operational or project state.

State answers:

> What is true now?

Historical knowledge answers:

> What happened or was decided previously?

---

## Lifecycle Status

Allowed values:

```text
proposed
active
deprecated
superseded
rejected
archived
```

### proposed

Suggested knowledge that has not yet been approved as canonical.

### active

Currently accepted canonical knowledge.

### deprecated

Previously useful knowledge that should normally no longer be used as the current answer.

### superseded

Knowledge replaced by another item or decision.

The previous knowledge remains accessible.

### rejected

A proposed change explicitly rejected.

### archived

Retained for historical purposes but generally outside normal retrieval.

---

## Source

Every Knowledge Item must identify its primary origin.

Allowed initial values:

```text
manual
chatgpt
claude
claude-code
uploaded_document
website_research
client_conversation
git
project_file
external_research
decision_record
```

The source identifies where knowledge originated.

It does not establish correctness.

---

## Confidence

Allowed values:

```text
low
medium
high
```

Confidence describes confidence in the accuracy of the Knowledge Item.

Confidence does not mean human approval.

---

## Approval

Approval is separate from confidence.

Optional format:

```yaml
approval:
  status: approved
  approved_at: 2026-09-15T00:00:00+05:30
  approved_by: arvi
```

Allowed approval statuses:

```text
pending
approved
rejected
```

Proposed knowledge should normally be pending.

Permanent knowledge requiring approval must be approved before becoming canonical.

---

## Provenance

Important Knowledge Items may include:

```yaml
provenance:
  source_session: session-2026-09-15-001
  source_document: document-id
  source_reference: user-approved decision
  author: arvi
```

Useful provenance fields include:

* source_session
* source_document
* source_reference
* author

Decisions, research, and AI-generated proposals should retain provenance whenever possible.

---

## Relationships

Knowledge Items may reference other Knowledge Items.

Format:

```yaml
relationships:
  - type: OWNS
    target: yz-product-merchantone

  - type: PART_OF
    target: yz-project-knowledge-system
```

Relationships are directional and explicit.

The `target` must reference a Knowledge Item ID.

---

## Initial Relationship Vocabulary

Initial relationship types:

```text
OWNS
OFFERS
CONTAINS
INCLUDES
CREATED
BUILT_FOR
BELONGS_TO
USES
DEPENDS_ON
RELATED_TO
SUPPORTS
REQUIRES
TARGETS
SERVES
PART_OF
DECIDED_BY
SUPERSEDES
SUPERSEDED_BY
CONFLICTS_WITH
DERIVED_FROM
SOURCED_FROM
MENTIONED_IN
BLOCKED_BY
ENABLES
```

This vocabulary is not permanent.

New relationship types should only be introduced when actual requirements justify them.

---

## Historical Changes

Knowledge must never be silently overwritten when new information contradicts existing knowledge.

When one Knowledge Item replaces another:

```yaml
relationships:
  - type: SUPERSEDES
    target: previous-knowledge-id
```

The previous item should normally become:

```yaml
status: superseded
```

This preserves historical context.

The system must be able to answer both:

> What is true now?

and:

> What did we previously believe or decide?

---

## Conflicts

If two pieces of knowledge cannot both be considered true, the system must not silently choose one.

Potential representation:

```yaml
relationships:
  - type: CONFLICTS_WITH
    target: another-knowledge-id
```

The ingestion system should detect potential conflicts and create a proposal for human review.

Example:

```text
Existing:
Yuzuu uses technology A.

New session:
Yuzuu decided to use technology B instead.
```

The system should detect the conflict instead of silently rewriting existing knowledge.

---

## Facts, Decisions, Hypotheses, and Unknowns

The system must distinguish:

### Fact

Information believed to be established and supported by its source.

### Decision

Something intentionally chosen by the user or team.

### Hypothesis

A proposed or uncertain idea.

### Unknown

Information that has not been established.

The system must never turn:

```text
we could use Neo4j
```

into:

```text
Yuzuu uses Neo4j
```

unless that decision has actually been made.

AI suggestions must not automatically become canonical facts.

---

## Permanent, Temporary, and Ephemeral Information

The system distinguishes:

```text
Permanent Knowledge
Temporary State
Ephemeral Conversation
```

### Permanent Knowledge

Information that should survive across sessions.

Examples:

* approved decisions
* business facts
* architecture choices
* product definitions
* service definitions
* important research findings
* long-term goals

### Temporary State

Short-lived information useful for current work.

Examples:

* current implementation status
* pending tasks
* debugging state
* temporary research direction

### Ephemeral Conversation

Material that does not need persistence.

Examples:

* greetings
* discarded brainstorming
* repeated explanations
* temporary wording
* irrelevant conversation

The ingestion pipeline must classify session information before creating permanent Knowledge Items.

---

## File Naming

Canonical files should normally use:

```text
<stable-id>.md
```

Examples:

```text
yz-studio.md
yz-product-merchantone.md
yz-project-knowledge-system.md
yz-decision-canonical-source-of-truth.md
```

Moving a file must not change its identity.

---

## Directory Organization

Initial canonical directories:

```text
knowledge/
├── core/
├── studio/
│   ├── services/
│   ├── sales/
│   ├── process/
│   └── pricing/
├── merchantone/
├── website/
├── projects/
├── research/
├── decisions/
├── goals/
└── state/
```

Directory placement is organizational.

Stable IDs determine identity.

---

## Validation Rules

Every canonical Knowledge Item must eventually pass validation.

Minimum requirements:

1. `id` exists.
2. `id` is unique.
3. `type` is recognized.
4. `title` exists.
5. `status` is valid.
6. `created_at` is valid.
7. `updated_at` is valid.
8. `source` is valid.
9. `confidence` is valid.
10. relationship targets exist or are explicitly unresolved.
11. YAML frontmatter is valid.
12. Markdown body exists.
13. referenced IDs are not silently changed.

Validation will later be implemented as code.

This document defines the rules; it is not itself the validator.

---

## Graph Synchronization

Neo4j is a derived representation of canonical knowledge.

The intended direction is:

```text
Canonical Markdown/YAML
        ↓
Validation
        ↓
Parsing
        ↓
Neo4j synchronization
        ↓
Search indexes
```

Canonical files remain authoritative.

Neo4j is used for:

* entity relationships
* graph traversal
* graph-aware retrieval
* derived search capabilities

If Neo4j is destroyed, it must be possible to rebuild it from canonical knowledge.

---

## Search and Embeddings

Search indexes and embeddings are derived data.

They may always be regenerated from canonical knowledge.

The initial architecture does not require a separate vector database.

Embedding providers must remain replaceable.

Changing an embedding model must not require rewriting canonical knowledge.

---

## Git

Git tracks the historical evolution of canonical knowledge.

Important changes should use meaningful commit messages.

Examples:

```text
knowledge: add Yuzuu Studio definition
decision: adopt canonical markdown as source of truth
project: record knowledge system architecture
research: add MCP ingestion findings
```

Git is the historical record of canonical file changes.

Git does not replace provenance metadata.

---

## AI Access Rules

AI clients must not directly modify canonical knowledge or Neo4j outside the controlled knowledge workflow.

Intended flow:

```text
AI session
    ↓
Session ingestion
    ↓
Extraction
    ↓
Classification
    ↓
Entity resolution
    ↓
Conflict detection
    ↓
Proposed changes
    ↓
Human approval
    ↓
Canonical knowledge
    ↓
Validation
    ↓
Neo4j synchronization
    ↓
Search indexes
```

AI clients should receive safe, typed operations rather than unrestricted database access.

---

## Core Design Rules

1. Canonical Markdown/YAML is the source of truth.
2. Every persistent item has a stable ID.
3. Neo4j is derived.
4. Search indexes are derived.
5. Embeddings are derived.
6. Git preserves canonical history.
7. Important knowledge retains provenance.
8. Conflicts must never be silently overwritten.
9. Superseded knowledge remains historically accessible.
10. AI suggestions are not automatically facts.
11. Permanent changes requiring approval must be human-approved.
12. Temporary conversation must not automatically become permanent knowledge.
13. Unknown information must remain unknown.
14. The graph must be rebuildable from canonical files.
15. The system must not depend on ChatGPT or Claude internal memory.
16. The ontology should grow only when real use cases require it.
17. The canonical layer must remain useful without Neo4j.
18. AI clients must use controlled interfaces rather than unrestricted database access.

---

## Schema Evolution

This schema is expected to evolve.

When the knowledge model changes:

* existing knowledge should remain readable where possible
* migrations should be explicit
* historical knowledge should not be silently rewritten
* new fields should have sensible defaults
* breaking changes should be documented
* graph migrations must be separate from canonical knowledge history

The exact schema-version mechanism will be implemented later.

---

## What This Schema Does Not Define Yet

This document intentionally does not fully define:

* Neo4j node labels
* Neo4j indexes
* Cypher migrations
* embedding models
* chunking strategy
* search ranking
* API endpoints
* MCP tools
* session extraction algorithms
* entity-resolution algorithms
* conflict-resolution algorithms
* AI provider integrations
* automatic ChatGPT ingestion
* automatic Claude ingestion
* dashboard behavior

Those belong to later implementation phases.

---

## Core Principle

The Yuzuu Knowledge System should always be able to answer:

> What do we know?

> Why do we believe it?

> Where did it come from?

> When did it become true?

> What did it replace?

> What is related to it?

> Is it a fact, decision, hypothesis, or unknown?

> What is the current state?

> Can we rebuild the entire system if Neo4j or an AI platform disappears?

If the system cannot answer these questions reliably, the knowledge architecture is incomplete.
