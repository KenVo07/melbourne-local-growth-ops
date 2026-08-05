# Contractor demo asset provenance

- Task: `WEB01A-T02`, run `web01a-20260805-100616`
- Disposition closed: binding **K1** — undocumented photographs of an identifiable
  person must not ship; replace with explicitly original, non-identifiable assets
  and record provenance (`claims-ledger.md` §4.1, `PLAN_READY.md` §11 K1,
  `WEB01A-T01-PLAN-REVIEW` finding T01PR-002).

## What was removed

Three photorealistic PNGs (`hero/primary.png`, `gallery/switchboard-detail.png`,
`gallery/work-context.png`) depicting an identifiable adult performing electrical
work. No licence, attribution, source, or model-release record existed anywhere in
the repository for these images (confirmed by repository-wide search prior to this
task). They have been permanently replaced; their prior content is recoverable only
from pre-`WEB01A-T02` Git history if the supervisor needs to re-inspect them.

## What replaced them

Three new PNGs, generated originally for this task by procedural composition (no
photograph, no traced or derived source image, no depiction of any real or
identifiable person, no AI photorealistic image generation):

| Asset | Path (both mirrors) | Dimensions | SHA-256 |
|---|---|---|---|
| Hero | `assets/hero/primary.png` | 1672×941 | `5b637819a3a16a19cff3f2b2b9de77ffb2074a72993533ab13d8c1d5d0b69a5c` |
| Gallery — switchboard detail | `assets/gallery/switchboard-detail.png` | 650×720 | `229efd9560eeb62c504ccdde3241409555c4ed967cfeb1a7a1ca2fd943ceefde` |
| Gallery — work context | `assets/gallery/work-context.png` | 950×820 | `e89c46cacae8032dbd89daddb9f594102fbb12933ff8b4d896927b63fb423dfd` |

Each is a flat-geometric illustration (gradient wall background, an abstract
switchboard/breaker-panel composition, an abstract tool-belt/tool silhouette, a
potted-plant motif) drawn with PIL primitives (rectangles, ellipses, bezier-curved
lines), 2x-supersampled and downsampled for anti-aliasing, in the same illustrative
idiom already accepted for the restaurant and retailer profiles' gallery/hero assets
(compare `apps/managed-web/public/examples/restaurant/assets/**`). No third-party
stock imagery, font, icon set, or other copyrighted work was used as a source.

Generation script (kept for reproducibility, not part of the shipped artifact):
`/tmp/claude-1000/-home-khoa-Projects--mlgo-worktrees-melbourne-local-growth-ops-web01a-20260805-100616-t02-contractor/450d0eac-53d7-4750-bf95-42e882edc96d/scratchpad/gen_contractor_assets.py`
(scratchpad path; not committed with the task's owned paths).

## Licence

These three PNGs are original work created for the Melbourne Local Growth Ops
repository and are licensed under the same terms as the rest of this repository's
first-party assets (agency-owned reusable background IP per `AGENTS.md`
"Non-negotiable boundaries"). No model release is required because no person is
depicted.

## Content-truthfulness disposition

Alt text and captions for the gallery items were updated in
`apps/managed-web/client/examples/contractor/client-website.json` and
`packages/templates/src/profiles/contractor/contractor-profile.ts` to remove
references to "an electrician" (a person) and instead describe the depicted
switchboard/tooling scene directly. This is a claim removal, not a new claim,
consistent with `claims-ledger.md` §5 rule 1 ("the set of claims may only shrink").
The existing "illustrative … not evidence of a completed client project /
work performed" disclosures are preserved unchanged and remain adjacent to each
image's caption.

## Performance gates closed

- **P20** (single source asset ≤ 600,000 B): all three assets are now
  16,284–62,931 B, well under budget (previously up to 1,774,217 B).
- **P21** (total source assets per profile ≤ 2.5 MB): total is now 106,627 B
  (previously ≈4.15 MB).
- **P17** (no image upscaled > 1.0×; no image served > 2.0× its rendered box):
  closed for the contractor gallery in `apps/managed-web/src/app/profiles/contractor.css`
  by overriding the shared `.profile-gallery img` fixed-height clamp with an
  intrinsic-aspect-ratio rule scoped to `[data-profile="CONTRACTOR"]`, so the
  rendered box never exceeds the delivered image's natural aspect.
