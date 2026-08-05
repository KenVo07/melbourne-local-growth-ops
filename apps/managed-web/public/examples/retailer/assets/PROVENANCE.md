# Retailer demo asset provenance

Scope: `apps/managed-web/public/examples/retailer/assets/**` (Fernbank Trading Co.,
the `RETAILER` fictional demonstration profile). Recorded per claims-ledger.md rule 5
("Any new asset must arrive with recorded provenance and licence in the same change")
and the WEB01A-T04 binding disposition ("Use repository-local provenance-recorded
imagery through the existing assetId seam").

## `hero/primary.png`

Pre-existing WEB-01 baseline asset. Unchanged by this task.

## `products/*.png` (7 files, added by WEB01A-T04)

| File | Product |
|---|---|
| `ceramic-vase.png` | Hand-thrown ceramic vase, sage |
| `linen-table-runner.png` | Linen table runner, natural |
| `glass-tumbler-set.png` | Recycled glass tumbler set (4pc) |
| `storage-basket.png` | Woven seagrass storage basket |
| `cushion-cover.png` | Oat boucle cushion cover |
| `candle-snuffer.png` | Brass candle snuffer |
| `plant-pot.png` | Terracotta plant pot, medium |

- **Origin:** self-authored, generated programmatically for this task using Python
  Pillow (PIL) — flat, geometric, brand-colour vector-style illustrations (rectangles,
  polygons, arcs). No photograph, no scanned or scraped image, no third-party stock
  asset, no generative-AI image model was used or is depicted.
- **Depicts:** no real product, no real person, no identifiable individual, no
  trademark or brand mark of any real business.
- **Licence:** none required. This is original work created directly for the
  Melbourne Local Growth Ops repository and is agency-owned reusable background IP,
  matching the existing restaurant profile's flat-vector-art precedent
  (`apps/managed-web/public/examples/restaurant/assets/gallery/*.png`).
- **Colours used:** the profile's own validated brand tokens only — `accentColor
  #1f6f5c`, `surfaceColor #fbf7f0`, `textColor #1c2321` (`client-website.json` →
  `profile.brand`) — plus a neutral line tint. No new colour authority was introduced;
  the images simply render the already-validated brand palette.
- **Format/size:** 1000×1000 px RGB PNG, 4.5–6.1 KB each (≈36 KB total for the seven
  files), generated with `Image.save(..., optimize=True)`. Well within the P16 (≤120 KB
  per image), P20 (≤600 KB per source asset) and P21 (≤2.5 MB per profile) frozen
  performance gates.
- **Generation script:** kept outside the repository (scratchpad-only, not a build
  dependency) — the PNG outputs are the durable, reviewable artifact; no repository
  script or dependency was added to produce them.
