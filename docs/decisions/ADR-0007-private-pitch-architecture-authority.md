# ADR-0007: Separate authority for private pitch architecture

- Status: Candidate under independent review
- Decision owner: Proportion Systems product/technical authority
- Scope: Tradies Factory private nonproduction pitch composition

## Context

A private sales pitch sometimes needs enough proposed service and information
architecture to render P1 before the business owner has supplied factual intake.
Writing those proposals into `client-intake.json` would falsely attribute them to
the client and turn assumptions into `VERIFIED_CLIENT_FACT`.

## Decision

Accept exactly one of two structural records:

- `client-intake.json` remains the client's factual authority and preserves the
  ordinary `VERIFIED_CLIENT_FACT` path.
- `pitch-architecture.json` is agency-authored, `NONPRODUCTION_PITCH` authority.
  Its ledger entries are `PROPOSED_PITCH_ARCHITECTURE`, its enquiry connector is
  explicitly `PROPORTION_CONTROLLED` at an agency address and projects downstream
  as agency-managed. It cannot carry credentials, completed jobs, testimonials,
  client approval or Production authority.

Pitch direction approval is recorded separately from client approval. The
Factory refuses ambiguous dual structural authority. Real client factual input
supersedes the pitch proposal at the orchestration boundary; historical proposal
material remains audit evidence.

## Consequences

- Private P1 composition can proceed without laundering assumptions into fact.
- Claim-critical gaps may remain unresolved while build-critical structure is
  present.
- Private-pitch output must retain its proposal disclosure and cannot be promoted
  directly to Production. The composed display tagline carries that visible
  disclosure into generated experience source.
- The normal real-client workflow remains unchanged.

## Rejected alternatives

- Put proposed structure in `client-intake.json` and relabel it later: provenance
  is already false at ingestion.
- Treat Founder pitch approval as client approval: the actors and scopes differ.
- Allow both records and choose one by file order: ambiguous authority must fail
  closed.
