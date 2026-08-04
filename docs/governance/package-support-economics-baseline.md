# Package support-cost and margin acceptance baseline: Website & Lead Systems

This record defines the proportionate, reusable support-cost model, labor
assumptions, provider cost structure, and gross-margin evaluation baseline for the
**Website & Lead Systems** capability (`@melbourne-local-growth-ops/site-core`,
`apps/managed-web`, and related packages).

This baseline links to accepted governance records and does not duplicate their
full content:
- [Business-object authority and workflow-state record](templates/business-object-authority-and-workflow-state.md)
- [Client-isolation and data-lifecycle record](templates/client-isolation-and-data-lifecycle.md)
- [Hosted-vendor exit, support-economics, and handoff-acceptance record](templates/hosted-vendor-exit-support-and-handoff.md)
- [Commercial delivery model](../product/commercial-delivery-model.md)

---

## 1. Package identity, tier, and delivery profile

- **Package identity**: Website & Lead Systems (`@melbourne-local-growth-ops/site-core`, `apps/managed-web`)
- **Architectural tier**: Tier A (database-free standard site delivery, isolated deployment per client)
- **Delivery profile**: `MANAGED_ISOLATED` or `CLIENT_HANDOFF` (exactly one profile evaluated per client deployment)
- **Tier A state-infrastructure boundary**: Current Tier A has zero database, authentication, object-storage, or background-job infrastructure cost. Per the accepted cumulative tier rule, any package or deployment requiring a database, authentication, object storage, or background jobs is Tier B — this applies even where that infrastructure is explicitly contracted by the client, and it cannot remain classified or costed as Tier A on that basis. Any such requirement triggers a separately approved Tier B classification and record, which then owns the corresponding costs; this baseline does not price or evaluate that state.

---

## 2. Single cost centre rule

- **Cost centre mapping**: Every client site deployment maps to **exact-one client cost centre**.
- **No cross-client cost pooling**: Cross-client mutable business-data or runtime pooling, cross-client revenue blurring, and shared multi-tenant business-data planes are prohibited. All recurring provider costs, variable usage, setup effort, and support labour are tracked against the client's single dedicated cost centre.
- **Shared factory/vendor overhead allocation**: Legitimate shared Website Factory or shared-vendor-account overhead (for example a factory-wide tooling subscription) may be allocated across client cost centres only under an evidenced commercial allocation rule sourced from the authoritative commercial agreement (`[commercial allocation rule link]`). Absent that evidence, no shared cost may be allocated to a client cost centre. This allocation rule never substitutes for, or blurs, the single client cost-centre mapping above.

---

## 3. Support window and support limits

Support commitments must be response boundaries sourced from the applicable
commercial agreement. They are not runtime configuration and this record does
not imply unfunded 24/7 support. Engineering never invents a support-hours
value, a response-time SLA, or a support-scope promise.

- **Contracted business hours**: Required input — authoritative commercial source (`[commercial source of truth link]`); no invented value.
- **Contracted response boundary**: Required input — authoritative commercial source (`[commercial source of truth link]`); no invented SLA (including no invented severity-1 or next-business-day figure).
- **Included support (package-record input, not a contracted promise)**: Draft example set for the authoritative agreement to confirm or replace — client site build and deployment updates, custom-domain configuration, standard platform maintenance, minor version updates, lead delivery configuration, and bug fixes. These examples become binding only once the authoritative commercial agreement confirms them.
- **Excluded or separately priced support (package-record input, not a contracted promise)**: Draft example set for the authoritative agreement to confirm or replace — custom feature development, third-party CRM/workflow platform integrations, custom backend API engineering, continuous 24/7 monitoring, and multi-tenant platform expansion. These examples become binding only once the authoritative commercial agreement confirms them.
- **24/7 support promised**: **No**, unless a separately approved authoritative contract explicitly replaces this statement and funds the obligation.
- **Acceptance gate**: This record is **BLOCKED** for support-limits acceptance until the contracted business hours and contracted response boundary inputs above are supplied from the authoritative commercial agreement. Draft included/excluded examples do not satisfy this gate.

---

## 4. Labour assumptions and effort allocation

All labour costs are estimated per client cost centre based on standard technical operational effort:

| Labour category | Allocation & description | Direct effort assumption |
| --- | --- | --- |
| **Setup effort** | Initial onboarding, custom domain binding, branding configuration, asset compilation, deployment verification. | Amortized onboarding labour per client cost centre over the evaluation period (§6). |
| **Recurring maintenance effort** | Monthly package dependency updates, security scans, build verification, platform maintenance. | Fixed monthly operational labour allowance. |
| **Support effort** | Client inquiry handling, minor copy/asset updates, domain DNS troubleshooting, within the contracted support limits in §3. | Monthly support effort allowance bounded by the authoritative support inputs in §3. |
| **Incident exposure** | Outage triage, Resend API key rotation, deployment rollback execution. | Risk-adjusted incident labour reserve. |
| **Upgrade effort** | Framework minor version upgrades, monorepo dependency sync. | Quarterly/annual upgrade allocation. |
| **Handoff / exit effort** | Source artifact generation, transfer verification, client account cutover support. | One-off handoff/exit effort allowance (when handoff is executed or contracted as an exit obligation). |

---

## 5. Provider costs (recurring & variable)

| Provider / resource | Cost classification | Metering & allocation boundary |
| --- | --- | --- |
| **Vercel / Hosting** | Recurring provider cost | Single isolated Vercel project deployment per client cost centre |
| **Resend / Email delivery** | Variable provider cost | Per-client transactional email volume (form submissions) |
| **Google Analytics 4** | Zero direct vendor cost | Client-owned GA4 measurement ID, zero direct agency vendor fee |
| **Optional Data Infrastructure** | Not part of this Tier A baseline | Zero for Tier A; any database, authentication, object-storage, or background-job requirement is out of Tier A scope and reclassifies the deployment to Tier B, whose separate record owns those costs (§1) |

---

## 6. Explicit revenue, gross contribution, and gross margin calculation

### Evaluation period

- **Evaluation period ($T$)**: Required input — authoritative commercial source (`[commercial source of truth link]`); no invented allocation period. Setup effort is amortized across this period.

### Formulas

- **Forecast Monthly Revenue ($R$)**: Total contracted monthly recurring revenue for the client cost centre.
- **Recurring & Variable Costs ($C_{\text{vendor}}$)**: Direct Tier A provider costs ($C_{\text{hosting}} + C_{\text{resend\_variable}}$), inclusive of any evidenced shared factory/vendor overhead allocation from §2. This baseline carries no conditional state-infrastructure cost term; a database, authentication, object-storage, or background-job requirement reclassifies the deployment to Tier B (§1), whose separate record owns and prices that cost.
- **Direct Labour Costs ($C_{\text{labour}}$)**: Direct operational labour ($C_{\text{setup\_amortized}(T)} + C_{\text{maintenance}} + C_{\text{support}} + C_{\text{incident\_reserve}} + C_{\text{upgrade}} + C_{\text{handoff\_exit\_exposure}}$), where $C_{\text{setup\_amortized}(T)}$ is one-off setup effort amortized across the evaluation period $T$, $C_{\text{incident\_reserve}}$ is the risk-adjusted incident labour reserve from §4, and $C_{\text{handoff\_exit\_exposure}}$ is the handoff/exit support exposure only (one-off handoff/exit effort from §4; incident exposure is already represented separately by $C_{\text{incident\_reserve}}$).

$$\text{Gross Contribution} = R - (C_{\text{vendor}} + C_{\text{labour}})$$

$$\text{Gross Margin \%} = \left( \frac{\text{Gross Contribution}}{R} \right) \times 100$$

No rate, price, percentage, threshold, or allocation period in this formula is
invented by engineering; every input above is sourced from the authoritative
commercial agreement or measured provider/labour evidence.

---

## 7. Authoritative minimum-margin threshold reference & acceptance rules

The minimum-margin threshold is an input supplied by authoritative commercial governance (e.g. [Commercial Delivery Model](../product/commercial-delivery-model.md) or an approved commercial contract). **Engineering never invents a percentage threshold.**

- **Referenced commercial threshold**: Input from commercial governance source of truth (`[commercial source of truth link]`).
- **Acceptance Status Gate**:
  - **PASS / Accepted**: Computed Gross Margin % $\ge$ Referenced Commercial Minimum-Margin Threshold, AND cost centre, provider cost, labour, evaluation period, support limits (§3), and data ownership evidence are complete.
  - **BLOCKED / Rejected**: Computed Gross Margin % $<$ Referenced Commercial Minimum-Margin Threshold, OR **no commercial threshold is referenced/supplied**, OR **the §3 support-limits inputs (contracted business hours, contracted response boundary) are missing**, OR evaluation-period or other evidence/ownership is incomplete.

---

## 8. Non-negotiable platform & isolation boundaries

- **Single private factory, isolated deployments**: One reusable Website Factory, one isolated deployment per client. No shared public multi-tenant runtime.
- **No database by default**: Standard Tier A site delivery requires no database, authentication, object storage, or background jobs. Any such requirement triggers a separately approved Tier B classification and record (§1).
- **No generic CRM / workflow data plane**: Client systems remain authoritative unless replacement is contracted. No shared customer database or generic multi-tenant booking/CRM platform.
- **Client ownership & handoff**: Client owns domain, content, analytics, and business data. A handed-off site runs without private agency repositories, credentials, or accounts.
- **Commercial/runtime boundary**: Pricing, margin, cost-centre, and threshold state defined in this record are commercial governance state. They never enter public website runtime configuration, per the [Commercial delivery model](../product/commercial-delivery-model.md#commercial-state-boundary).
