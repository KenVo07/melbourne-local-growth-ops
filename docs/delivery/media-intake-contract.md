# Media and business intake contract

The delivery contract the Tradies workflow implements. **Not a media-management
product, not an uploader, not a UI.** Schema and decision boundaries only.

## The operating principle

**The client experience is done-for-you.** A tradesperson is not asked to curate
design-ready media, and is never told "send better photos". They are asked for
what they have; the agency decides what it is worth and what is missing.

Stone & Line is the counter-example: 14 photographs placed by hand, with focal
points, aspect ratios and mobile crops as authored constants, and a single
`PROVENANCE` string applied to every asset — correct only because all 14 happened
to share one provenance. That does not survive a client with 200 phone photos of
varying quality.

## The seven stages

### 1. Business read

Existing site, Google Business presence, socials, reviews, the jobs they want and
the customers they want, positioning, and the brand reality that already exists.
Read before anything is asked for, because it determines what to ask for.

### 2. Raw client dump

Everything they have: photos, video, logo files, brochures, team shots, vehicle
livery, signage, site material. Unsorted and unjudged. The ask is *volume and
honesty*, not curation.

### 3. Media audit

Every asset classified into internal categories the client never sees:

| Class | Meaning |
|---|---|
| `PROOF_GRADE` | Substantiates a specific claim. This job, this place, this result. |
| `SALES_GRADE` | Good enough to sell with. Composition and light carry a page. |
| `RECOVERY_GRADE` | Usable after work — crop, correct, retouch, or re-light. |
| `REFERENCE_ONLY` | Tells the agency something true. Never published. |

Classification is a judgement recorded per asset, and it is **the input to stage 4**
rather than a filing exercise.

### 4. Shot gap analysis

The agency specifies the **exact missing shots**: subject, framing, orientation,
lighting condition, and what claim each one would substantiate.

The output is a shot list a person can execute, not feedback. "Three landscape
frames of a completed paved courtyard in overcast light, wide enough to show the
boundary" is a shot list. "Better photos of your work" is not.

### 5. Media production choice

Explicit lanes, chosen per gap and recorded:

| Lane | When |
|---|---|
| `SUPPLIED` | The client can shoot it against the shot list |
| `COMMISSIONED` | A photographer is engaged |
| `AI_ENHANCED` | A real asset is corrected, cropped or re-lit — the subject is real |
| `AI_RECOMPOSED` | A real asset is materially recomposed |
| `AI_GENERATED_SUPPORTING` | Non-representational supporting creative, generated |

### 6. Creative configuration

Business positioning, audience, and **media reality** together drive: palette,
typography, energy, motion appetite, density, image treatment, and whether there is
a signature opportunity at all.

**Media reality is an input to the design, not a constraint discovered afterwards.**
A client whose best assets are `RECOVERY_GRADE` phone photos should not be given a
full-bleed photographic hero grammar; that is a design decision made at stage 6, not
a disappointment at stage 7.

### 7. Factory or premium delivery

## The provenance contract, which is the part that must not be lost

**A published asset's provenance is per-asset, and it governs what claim that asset
is allowed to substantiate.**

| Provenance | May substantiate |
|---|---|
| `CLIENT_JOB_PHOTOGRAPH` | This business's own completed work, named |
| `CLIENT_PREMISES_OR_TEAM` | The business itself — people, vehicles, premises |
| `COMMISSIONED_PHOTOGRAPH` | Whatever it depicts, as shot |
| `ENHANCED_CLIENT_ASSET` | The same claim as its source asset, no more |
| `RECOMPOSED_CLIENT_ASSET` | Atmosphere and quality. **Not** a specific job claim |
| `GENERATED_SUPPORTING_MEDIA` | Nothing factual. Atmosphere only |
| `STOCK_OR_REFERENCE` | Nothing factual |

The invariant, which the Platform already enforces in spirit through
`MEDIA_CLAIM_UNSUPPORTED`: **an asset may not substantiate a client fact its
provenance class cannot carry.** A generated image beside the words "our recent
work in Hawthorn" is the failure this prevents, and it is a legal exposure as much
as a design one.

A single site-wide provenance constant cannot express this. Per-asset provenance is
a requirement of the intake schema.

## Required distinctions the schema must carry

Per asset: provenance class; audit class; the production lane that produced it;
whether a human approved publication; real intrinsic dimensions; a focal point; and
the specific claim it is permitted to support, if any.

**Focal point is decided by a person or a model, and recorded** — not inferred at
render time. Reading real asset dimensions at runtime already generalises and should
be kept; guessing what matters inside the frame does not.

## What this contract deliberately does not decide

Who builds the uploader, what the operator UI looks like, where assets are stored,
or how the audit is presented. Those are implementation choices for the Tradies
workflow. Freezing them here would be designing a product from one client's
evidence.
