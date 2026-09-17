# Yuzuu Knowledgebase — Agent Instructions

## Purpose

This repository is the canonical, Git-versioned knowledgebase for Yuzuu Studio and its products, services, projects, decisions, research, and operational state.

## Source of Truth

- Canonical knowledge lives in `knowledge/`.
- Markdown + YAML frontmatter is the primary human-readable format.
- Git history is the authoritative record of changes.
- Neo4j, search indexes, embeddings, and other databases are derived layers.
- Derived systems must be rebuildable from canonical files.

## Rules

1. Never silently overwrite existing knowledge.
2. Never turn speculation or conversation context into permanent fact without approval.
3. Preserve provenance for knowledge derived from AI sessions, research, documents, or other sources.
4. Detect and surface conflicts instead of resolving them silently.
5. Prefer superseding an outdated knowledge item over destroying its history.
6. Keep temporary session state separate from permanent knowledge.
7. Do not store secrets, API keys, credentials, or private authentication material in the repository.
8. Do not write directly to Neo4j as a substitute for updating canonical knowledge.
9. Validate knowledge before synchronizing derived systems.
10. Keep changes focused and explain significant architectural or schema changes.

## AI Session Handling

AI sessions are inputs to the knowledge system, not automatically trusted truth.

The intended flow is:

session → extraction → classification → entity resolution → conflict detection → proposal → human approval → canonical knowledge → derived indexes/graph → Git

Agents must preserve this distinction.

## Architecture

The planned system consists of:

- Canonical Markdown/YAML knowledge
- Git version control
- Neo4j graph database
- Hybrid lexical + semantic retrieval
- Knowledge API
- MCP server for AI access
- Session ingestion pipeline
- Optional dashboard

Do not introduce additional infrastructure unless there is a concrete requirement for it.

## Development Principles

- Prefer the smallest architecture that satisfies the requirement.
- Prefer local-first solutions.
- Keep provider-specific AI integrations modular.
- Use typed interfaces and explicit validation.
- Keep the graph ontology intentionally small until real use cases require expansion.
- Make important operations observable and reversible.
- Test knowledge transformations and synchronization logic.

## Change Discipline

Before making a significant change:

1. Understand the existing architecture and schema.
2. Check for related decisions and constraints.
3. Identify possible conflicts.
4. Make the smallest coherent change.
5. Validate it.
6. Update documentation when architecture or behavior changes.
7. Commit meaningful changes with a clear commit message.

## Repository Structure

- `knowledge/` — canonical knowledge
- `sessions/` — session ingestion lifecycle
- `graph/` — Neo4j schema, migrations, and seeds
- `apps/api/` — knowledge API
- `apps/mcp-server/` — MCP interface for AI agents
- `apps/ingestion/` — session ingestion pipeline
- `apps/dashboard/` — future management UI
- `scripts/` — development and maintenance scripts
- `tests/` — automated tests

## Canonical Schema

Read `knowledge/SCHEMA.md` before creating or modifying canonical knowledge.
