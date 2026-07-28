# ADR-0001: One product family with independent capabilities

- Status: Accepted
- Decision date: 27 July 2026

## Context

Website delivery, Google Business Profile operations, and reputation work share
client identity and commercial cross-sell opportunities. Treating them as one
runtime would couple unrelated workflows; treating them as unrelated products
would duplicate identity, positioning, and operational context.

## Decision

Melbourne Local Growth Ops is one product family with three independently
sellable capabilities:

1. Website & Lead Systems
2. Google Presence Operations
3. Reputation Operations

Capabilities can be sold separately or in packages. Packages are commercial
combinations, not runtime dependencies. Each capability has independent
activation, onboarding, permissions, delivery, billing, pausing, cancellation,
and data ownership.

Website & Lead Systems is the primary engineering focus. Google Presence and
Reputation Operations may be sold without a website and remain manual-first
until their service workflows validate software investment.

## Consequences

- Shared approved business information needs explicit contracts.
- Website launch cannot depend on Google or Reputation automation.
- Cancelling one capability cannot disable another.
- Website modules, managed-service workflows, and connectors remain distinct.
- Cross-capability packages cannot be implemented as runtime feature bundles.

## Superseded interpretation

The phrase “separately deployable capabilities” means independently deliverable
and operable. It does not require three software applications today.

## Sources

- [Product decision](https://app.notion.com/p/3a88d3550dc3810d9619c23fe8784140)
- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-43](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-88](https://app.notion.com/p/3aa8d3550dc381139645e4a62ca0aa84)
