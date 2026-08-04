# Hosted-vendor exit, support-economics, and handoff-acceptance record: [package]

Complete this record for every hosted service and every self-hosted or adopted
OSS dependency in the package. Hosted and self-hosted modes are distinct
adoption decisions and require separate exit evidence.

## Record identity and delivery profile

- Package: [package name and repository link]
- Package scope evidence: [repository task or approved upstream reference]
- Delivery profile: [MANAGED_ISOLATED | CLIENT_HANDOFF; exactly one]
- Delivery-profile decision evidence: [link]
- Isolation and data-lifecycle record: [completed record link]

Complete only the selected delivery-profile acceptance subsection. For the
other subsection, provide one N/A entry with rationale, risk, and evidence.

## Hosted-vendor exit

List each hosting, email, analytics, storage, monitoring, workflow, or other
hosted service. Repository OSS licensing never grants hosted-service rights.

| Hosted vendor/service and mode | Explicit interface or connector boundary | Adoption status/mode and decision evidence | Provider account owner | Credential owner and secret reference only | Portable configuration and data | Transfer, migration, or recreation path and test | Termination, export, and deletion evidence | Exit cost and support consequences | Operational responsibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [service/mode] | [boundary] | [T02 status/mode and link] | [owner] | [owner/reference; no value] | [formats/coverage] | [link] | [link] | [authoritative cost/support link] | [owner] |

## Self-hosted or adopted OSS exit

Use the exact status and adoption mode from the
[OSS adoption and abandonment register](../oss-adoption-register.md). This
record cannot promote Candidate/Gated, Learn From, Deferred, or Rejected
material, create a new OSS decision, or make a legal conclusion.

| OSS artifact, exact version/commit, and integrity source | T02 status and exact adoption mode | Interface or process boundary | Runtime/account/resource owner | Credential owner and secret reference only | Portable source, configuration, data, and notices | Migration, replacement, or recreation path and test | Removal and client-data deletion evidence | Maintenance, security, exit-cost, and support consequences |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [artifact/version/source] | [status/mode and link] | [boundary] | [owner] | [owner/reference; no value] | [coverage/link] | [link] | [link] | [evidence/link] |

## Incident ownership and support limits

Support commitments must be response boundaries sourced from the applicable
commercial agreement. They are not runtime configuration and must not imply
unfunded 24/7 support.

- Incident owner function: [contracted team/function, not an individual's name]
- Client incident contact boundary: [authoritative reference]
- Contracted business hours: [authoritative commercial source; no invented value]
- Contracted response boundary: [authoritative commercial source; no invented SLA]
- Included support: [scope/link]
- Excluded or separately priced support: [scope/link]
- Vendor escalation boundary: [provider support entitlement/link]
- Manual fallback or service-degradation path: [link]
- Incident evidence location and redaction rule: [link]
- 24/7 support promised: No, unless a separately approved authoritative
  contract explicitly replaces this statement and funds the obligation.

## Support economics

The minimum-margin threshold is an input from the authoritative commercial
source. Do not invent a number or store pricing/margin state in public runtime
configuration.

| Economic input or result | Value or evidence link | Source/owner | Acceptance note |
| --- | --- | --- | --- |
| Cost centre | [reference] | [authoritative commercial source] | [note] |
| Setup effort and direct cost | [estimate/link] | [source] | [note] |
| Recurring vendor and usage cost per client | [estimate/link] | [source] | [note] |
| Expected recurring support effort and cost | [estimate/link] | [source] | [note] |
| Incident and exit support exposure | [estimate/link] | [source] | [note] |
| Minimum-margin threshold | [input/link, not an invented value] | [authoritative commercial source] | [note] |
| Margin evaluation | [calculation/evidence link] | [commercial source of truth] | [Accepted \| Conditional \| Rejected] |

## MANAGED_ISOLATED acceptance

Complete only when `MANAGED_ISOLATED` is the selected profile.

- [ ] The package operates in one client-specific deployment and data plane.
- [ ] Account, credential, incident, and operational ownership remain explicit.
- [ ] Every hosted and OSS dependency has tested export, migration/recreation,
  deletion, and support-consequence evidence.
- [ ] A portable client-specific source/configuration/data path exists without
  exposing private factory IP or requiring an agency-only runtime.
- [ ] Exit-readiness, rollback, support limits, and economics are accepted.
- Managed exit-readiness evidence: [link]

## CLIENT_HANDOFF acceptance

Complete only when `CLIENT_HANDOFF` is the selected profile. Planned transfer
is insufficient; attach completed evidence.

- [ ] Client-specific source repository transfer is complete and independently
  verified.
- [ ] Hosting, domain/DNS, analytics, email, storage, monitoring, workflow, and
  other required provider accounts are client-owned, transferred, or recreated
  in client-owned accounts with evidence.
- [ ] Required credential references are documented; client-owned values were
  re-entered through approved provider boundaries; agency access was rotated,
  revoked, or removed with evidence.
- [ ] Portable configuration and data exports, integrity evidence, deletion
  evidence, recovery procedures, and provider-specific limitations were
  transferred.
- [ ] The delivered site runs without private agency repositories, registries,
  credentials, accounts, personal accounts, or agency-only runtime services.
- [ ] Operational responsibility, support boundaries, recurring costs, and
  exit responsibilities are accepted by the receiving client boundary.
- Source verification and digest evidence: [link]
- Account transfer/recreation evidence: [link]
- Final handoff acceptance evidence: [link]

## N/A and substitutions

Duplicate this block for the unselected delivery profile and every other N/A
or substitution.

- Field or gate: [name]
- Status: [N/A | Substituted]
- Rationale: [specific reason]
- Risk: [consequence]
- Evidence: [stable repository or approved source link]

## Final acceptance

- [ ] Exactly one delivery profile is selected and its acceptance evidence is
  complete.
- [ ] Hosted vendors and self-hosted/adopted OSS are separately inventoried.
- [ ] No secret values appear in the record.
- [ ] Incident ownership, contracted support limits, cost centre, recurring and
  support costs, authoritative minimum-margin input, and margin acceptance are
  complete.
- [ ] Every N/A or substitution includes rationale, risk, and evidence.
- Limitations and residual risks: [link or concise summary]
- Conditions or follow-up: [link or None]
- Final acceptance status and evidence: [Accepted | Conditional | Rejected;
  link]

## Governing references

- [Full-Package Definition of Done](../full-package-definition-of-done.md)
- [OSS adoption and abandonment register](../oss-adoption-register.md)
- [Commercial delivery model](../../product/commercial-delivery-model.md)
- [Client source handoff](../../runbooks/client-source-handoff.md)
- [Client recovery and ownership transfer](../../runbooks/client-recovery-and-transfer.md)
- [Optional-data backup and restore](../../runbooks/optional-data-backup-restore.md)
