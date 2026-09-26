# Yuzuu Knowledgebase

The canonical, Git-versioned knowledge system for Yuzuu Studio and its products.

## Purpose

This repository stores structured, human-readable knowledge about:

- Yuzuu Studio
- Services and business operations
- MerchantOne
- Projects
- Decisions
- Goals
- Research
- Current operational state
- AI session-derived knowledge

## Architecture

The system is designed around a local-first architecture:

```text
AI / Agents
    │
    ▼
MCP Server
    │
    ▼
Knowledge API
    │
    ▼
Core Knowledge Layer
    │
    ├── Canonical Markdown/YAML
    │       │
    │       └── Git
    │
    └── Neo4j + Search Indexes
            │
            └── Derived from canonical knowledge

Session ingestion follows:
AI Session
    ↓
Session Inbox
    ↓
Extraction
    ↓
Classification
    ↓
Entity Resolution
    ↓
Conflict Detection
    ↓
Knowledge Proposal
    ↓
Human Approval
    ↓
Canonical Knowledge
    ↓
Neo4j / Search Synchronization
    ↓
Git Commit

Repository Structure
knowledge/       Canonical knowledge
proposals/       Durable, versioned knowledge change proposals
sessions/        AI session ingestion lifecycle
graph/           Neo4j schema, migrations, and seeds
apps/api/        Knowledge API
apps/mcp-server/ MCP interface
apps/ingestion/  Session ingestion
apps/dashboard/  Future management dashboard
scripts/         Development and maintenance scripts
tests/           Automated tests

Source of Truth

Canonical knowledge in knowledge/ is authoritative.

Neo4j, embeddings, search indexes, and other generated data are derived systems and must be rebuildable from the canonical repository.

See knowledge/SCHEMA.md for the canonical knowledge model and rules.

Development Status

This project is under active construction.

The system is being built incrementally, with architecture and implementation decisions recorded in the knowledgebase itself.

