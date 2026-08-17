# Plate illustration provenance

## What these are

Four original orthographic "plate" illustrations created for the WEB-01B v2
Signature Slice (`tests/fixtures/web01b/northline`).

| Asset | Path | Dimensions |
|---|---|---|
| Board elevation | `switchboard.png` | 1600×1000 |
| Circuit plan | `circuit-plan.png` | 1600×1000 |
| Terrace facade | `facade.png` | 1600×1000 |
| Junction detail | `junction-detail.png` | 1100×1100 |

## How they were made

Generated procedurally by `generate-plates.py`, kept beside them for
reproducibility. Flat geometric composition drawn with PIL primitives
(rectangles, ellipses, arcs, polylines), 2× supersampled and downsampled for
anti-aliasing.

This follows the idiom already accepted in this repository for the contractor,
restaurant and retailer example assets — see
`apps/managed-web/public/examples/contractor/assets/PROVENANCE.md`, whose
disposition (binding **K1**) required original, non-identifiable, provenanced
assets after undocumented photographs were removed.

## What they are not

- **No photograph**, and no image traced or derived from a photograph.
- **No AI image generation** of any kind, photorealistic or otherwise.
- **No depiction of any person**, real or imagined, so no model release applies.
- **No third-party** stock image, icon set, font, texture or other copyrighted
  work was used as a source or reference.
- Not a depiction of any real building, address or completed job. The subjects
  are generic residential electrical arrangements.

## Content truthfulness

These illustrations accompany `DEMONSTRATION` project records for a fictional
business. They must never be presented as photographs of completed client work,
premises, team or results. Every route that renders them also renders the
project's demonstration disclosure.

## Licence

Original work created for this repository and licensed on the same terms as the
rest of its first-party assets: agency-owned reusable background IP per
`AGENTS.md`.
