# Proposals

Durable, inspectable, versioned knowledge change proposals. Proposals are the
output of the session ingestion and AI-session pipeline: they describe a
specific change to canonical knowledge (create, update, or supersede) before it
is ever approved or applied.

## Status

This directory is the persistence surface for proposals. It contains one file
per proposal (`<proposal-id>.yaml`) organized by lifecycle status:

- `pending/` — proposed, awaiting human approval.
- `approved/` — approved and awaiting application to canonical knowledge.
- `rejected/` — rejected or no longer relevant.

Status transitions are explicit and mechanical. The `FilesystemProposalStore`
moves a proposal file between these directories only when asked to via
`moveStatus`; it never invents approval or rejection semantics.

## Important rules

- Proposals are **not canonical knowledge**. Nothing here is authoritative; the
  canonical, Git-versioned knowledge lives in `knowledge/`.
- Proposal files are immutable once written: saving an id that already exists is
  an error, never a silent overwrite.
- Every proposal file is validated against its schema on load, so malformed or
  hand-edited files are surfaced as typed errors instead of being trusted.
- Proposal ids are deterministic and repository-provenance-free
  (`yzp-<hex>`); they are derived from the proposal content itself.
- Do not bypass the store to hand-edit proposal files outside of an approval or
  rejection flow.
- `pending/`, `approved/`, and `rejected/` directories are created lazily by the
  store on first write.

## Document shape

Each file is YAML serialization of a `ProposalDocument`:

```yaml
schema: proposal/v1
status: pending
summary: <deterministic one-line summary>
validationValid: true
conflicts: []
proposal:
  id: <proposal-id>
  createdAt: <timestamp>
  operation: create | update | supersede
  request: <original request>
  provenance: <requester provenance>
  approval:
    status: pending
  diff:
    kind: create | update | supersede
    ...
```

The full proposal (request, provenance, approval state, and resolved diff) is
preserved so that a proposal can be reviewed, discussed, and applied exactly as
intended.

## Lifecycle

1. A pure-domain function turns a request + repository snapshot into a
   validated `Proposal`.
2. `savePending` persists it under `pending/`.
3. A human reviews the proposal and either:
   - moves it to `approved/` for later application to canonical knowledge, or
   - moves it to `rejected/`.

Applying an approved proposal to `knowledge/` is a separate, future milestone.