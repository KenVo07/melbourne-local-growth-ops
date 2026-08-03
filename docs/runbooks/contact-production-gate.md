# Contact form production deployment gate

This runbook documents the required evidence and verification steps before
activating contact form capability in a production deployment.

## Gate requirements

A contact-enabled production package requires evidence of an active
host-enforced path limiter configured for the `/api/contact` endpoint. The
repository provides a route-boundary same-origin guard as defense-in-depth, but
this does not constitute distributed enforcement.

### For Vercel deployments

Vercel provides fixed-window rate limiting through Vercel Firewall (WAF). As of
the August 2026 documentation review:

- **Availability**: Fixed-window rate limiting is available on all plans
- **Hobby plan**: Includes one rule and 1,000,000 allowed requests
- **Usage pricing**: $0.50 per million allowed requests beyond the included quota
- **Documentation**:
  - Rate limiting: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
  - Usage and pricing: https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing

**Important**: The deployment account owner is responsible for monitoring usage
and costs.

### Required evidence checklist

Before activating contact capability, document and verify:

1. **Package-specific threshold rationale**: Analysis of expected legitimate
   submission volume for this specific deployment, provider quota and cost
   implications, and false-positive risk assessment
2. **WAF configuration**: Exported or redacted rule record showing the active
   `/api/contact` rate limit rule with the chosen threshold and time window
3. **Account ownership**: Explicit confirmation of who owns the Vercel account
   and accepts cost responsibility
4. **Verification result**: Safe test demonstrating the rate limit is active and
   rejects excess requests. The test must use a synthetic nonexistent module ID,
   contain no personal fields, and be bounded to the package-specific selected
   threshold plus the minimum requests needed to observe enforcement. Because the
   module does not exist, the application returns `FORM_NOT_FOUND` without
   invoking a provider — no credential manipulation is required.
5. **Handoff documentation**: Instructions for the client to monitor, adjust, or
   disable the rule post-handoff

## Verification procedure

1. Deploy the contact-enabled package to the target environment
2. Confirm the Vercel WAF rule is active in the Vercel dashboard
3. Issue requests against `/api/contact` using a synthetic nonexistent module ID
   with no personal fields; count bounded to the package-specific selected
   threshold plus the minimum requests needed to observe enforcement. Because the
   module does not exist, the application returns `FORM_NOT_FOUND` without
   invoking a provider — no credential manipulation required.
4. Verify that requests beyond the configured threshold return 429 status; the
   429 is supplied by the host limiter, not the route response
5. Verify that no submission data appears in error responses or logs
6. Document the verification result with timestamp and observed behavior

## Non-contact deployments

Packages that do not include `LEAD_FORM` modules remain database-free and
require no rate limiting configuration. The gate applies only when contact
capability is explicitly requested.

## Portability note

This runbook covers Vercel deployment only. Any other already-approved platform
requires primary-source-evidenced equivalent enforcement for that specific
package before activation. The repository's same-origin guard is not sufficient
as the sole production control.

---

**Runbook version**: 2026-08-03
**Vercel documentation reviewed**: 2026-08-03
**Next review**: Before next contact-enabled production deployment
