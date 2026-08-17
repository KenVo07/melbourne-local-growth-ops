# Plate illustration provenance

## What these are

Ten original orthographic "plate" illustrations created for the WEB-01B v2
client experience (`tests/fixtures/web01b/northline`). They are the entire media
set of that site: there is no other imagery.

| Asset | Path | Dimensions | SHA-256 |
|---|---|---|---|
| Board elevation | `switchboard.png` | 1600×1000 | `bfc04796aae033b145b4ef62022ab294d5525d2b0f2810678f0519bbca03c326` |
| Circuit plan | `circuit-plan.png` | 1600×1000 | `08773db557be5967e6cc47b6c1c427e6767ed701933aa1dc2d68437d2111004c` |
| Terrace facade | `facade.png` | 1600×1000 | `ab0007dea712707d236caf717ecd3315e5026dfb431df2d3da2a0cec91a15171` |
| Stud wall section | `wall-section.png` | 1600×1000 | `87d228480480d028787f13246d929a7e93af96f046b5c37942542f4746a8247b` |
| Single-line schematic | `schematic.png` | 1600×1000 | `418d2c50c3a3f26e0fc7d48d8dcb01440883e3cd312169535b5b4751d8c6ade3` |
| Roof void section | `roof-space.png` | 1600×1000 | `8e580570b39d2138e370e825cea662f7f52463ca988157826aea43158f3d7cbc` |
| Site plan | `site-plan.png` | 1600×1000 | `8f3c4c1438d00726f60fb18c12c1c23d84e6b6c435d38e096ba3e3676be3dd1a` |
| Junction detail | `junction-detail.png` | 1100×1100 | `44577e5ef07903e9b4425c8d7144cf9fe48d8c952e52542757b87da10121432a` |
| Cable schedule | `cable-schedule.png` | 1100×1100 | `78a109c4e268a86854e09827c4bc8a3ddbefe53e54ea26d05d1e2040fb0a0957` |
| Board interior detail | `board-detail.png` | 1100×1100 | `a221706ecf857ed2687fc24d6900e3bb621ae0f59b8aaac36137527d9cc7a0f9` |

## How they were made

Generated procedurally by `generate-plates.py`, kept beside them for
reproducibility. Flat geometric composition drawn with PIL primitives
(rectangles, ellipses, arcs, polylines), 2× supersampled and downsampled for
anti-aliasing.

Reproduce the exact set above with:

```
python3 generate-plates.py apps/managed-web/public/assets
```

The script prints each file's dimensions, byte size and SHA-256, so the table
above is checkable rather than asserted. Every plate in the set comes from this
one script — an earlier revision of this document listed only four plates while
ten were shipped, and six had been produced ad hoc and could not be regenerated.

This follows the idiom already accepted in this repository for the contractor,
restaurant and retailer example assets — see
`apps/managed-web/public/examples/contractor/assets/PROVENANCE.md`, whose
disposition (binding **K1**) required original, non-identifiable, provenanced
assets after undocumented photographs were removed.

## Lettering convention

The plates carry **no rendered text**. Where a real drawing would letter a note,
a dimension figure or a title-block field, the plate draws only the *rule* that
lettering would sit on.

This is a truthfulness measure, not a styling choice. A lettered plate would
appear to state a measurement, a circuit rating or a certification that nobody
has verified, on a site whose records are explicitly demonstrations. It also
keeps the drawings legible at the sizes the layout crops them to. All meaning
reaches the reader through real HTML text: the image's alt text, the figure
caption and the surrounding copy.

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
