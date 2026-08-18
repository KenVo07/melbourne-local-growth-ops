# Media art direction

How a delivery gets the imagery its creative direction needs without ever
falsifying what the client has actually done.

## The one rule everything else serves

**Only `REAL_CLIENT_EVIDENCE` may substantiate completed work, team, premises,
measured results or certifications.**

Everything else — generated, extended, stock, reference — may carry atmosphere,
texture, mood and abstraction. None of it may stand behind a claim. This is
enforced by `pnpm creative:validate`, which fails any media plan where an asset
substantiating a fact is classified as anything else.

The failure this prevents is not usually deliberate. It is a beautiful generated
interior placed next to "our workshop", or an AI-extended site photograph beside a
certification, where nobody decided to lie and the page lies anyway.

## Provenance classes

| Class | What it is | May substantiate a claim? |
|---|---|---|
| `REAL_CLIENT_EVIDENCE` | Photography or documentation of the client's own work, team, premises or results. | **Yes** — the only class that may. |
| `AI_ASSISTED_REAL` | A real client asset cleaned, corrected, cropped or retouched, where the subject remains what it was. | Only for what the original evidenced. Extension that adds subject matter makes it generated. |
| `AI_GENERATED_CREATIVE` | Generated imagery: texture, abstraction, illustration, ornament. | **No.** |
| `LICENSED_STOCK` | Licensed third-party imagery. | **No.** |
| `REFERENCE_ONLY` | Used to calibrate a direction. Never shipped. | **No** — and must not reach the artifact at all. |

### Where `AI_ASSISTED_REAL` stops

The line is subject matter, not technique. Colour correction, straightening,
dust removal, a tighter crop, a background extended to fit an aspect ratio — the
photograph still shows what it showed. Adding a person, a vehicle, equipment, a
finished surface or a second storey creates something the client did not do. That
is `AI_GENERATED_CREATIVE`, and it may no longer stand behind the claim.

When it is genuinely ambiguous, classify down. The cost of classifying down is a
weaker page; the cost of classifying up is a false claim.

## The workflow

1. **Inventory.** `pnpm creative:package` lists every asset the client definition
   carries, with intrinsic dimensions, marked `UNCLASSIFIED`. It is deliberately
   not guessed.
2. **Classify.** Every asset gets a class and a named human approver in
   `media-plan.md`. An asset with no approver fails validation.
3. **Identify the gap.** The territory needs imagery the client does not have.
   Name it plainly. This is normally the largest real input request in a delivery.
4. **Decide honestly what fills it.** In order of preference: commission real
   photography; use what exists more ambitiously; make the absence part of the
   direction; and only then generate creative material that carries no claim.
5. **Art-direct.** Crop, focal points, responsive behaviour, sequence and pacing.
   The Platform already carries focal behaviour and art-directed crops — use them
   rather than pre-baking crops.
6. **Approve.** A named human signs the media plan.
7. **Deliver.** Validated client media renders through the Platform `Image`
   primitive. CSS may not reference raster files, so there is no back door.

### Making the absence part of the direction

This is the most under-used option and often the strongest. northline's "Drawn to
code" direction exists because the business had no photography: rather than
apologising with stock, it made original technical illustration the point, and the
result reads as more considered than a photographic site built on someone else's
photographs.

A client with thin media is not automatically a client with a weak site. It is a
client whose direction has to be about something other than photography.

## Generation providers

Image and video generation tools are **replaceable providers, not architecture**.
Current tools worth evaluating change frequently; none of them may become a
dependency of the Platform, the artifact or the delivery process.

Two boundaries hold regardless of which tool is used:

- **No production client data goes to a new provider without founder
  provider/privacy/data-use approval.** Business content, unpublished project
  detail and client photography are client data.
- **Provenance survives the tool.** Whatever generated it, the asset is classified
  by what it depicts and what it is allowed to support.

## Video

Permitted: a `<video>` element with a client-owned relative source. Refused:
anything that fetches, and any remote-hosted embed. An `<iframe>` is refused
outright, so third-party video platforms cannot be embedded in client-local
source.

Video is expensive in bandwidth and attention. It earns its place when it shows
something a still cannot, and it must respect reduced motion.

## What a delivery hands to production

`media-plan.md`, validated, with every asset carrying a class, what it
substantiates, and a named approver — plus a plain list of the media the direction
needs and the client does not yet have.
