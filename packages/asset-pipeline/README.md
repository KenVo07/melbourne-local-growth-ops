# `@melbourne-local-growth-ops/asset-pipeline`

Build-time validation and deterministic manifest generation for portable local
website images. The package does not render images, probe image bytes,
transcode files, fetch remote assets, or introduce runtime storage.

## Supported image references

Every reference supplies a stable asset ID, a path beneath the deployment
`public/assets` namespace, and structural intrinsic metadata:

```ts
{
  assetId: "hero-primary",
  kind: "IMAGE",
  sourcePath: "assets/hero/primary.png",
  mediaType: "image/png",
  width: 1672,
  height: 941,
}
```

Supported formats are PNG, JPEG, WebP, and AVIF. SVG and GIF are rejected.
Paths must be portable forward-slash paths beginning with `assets/`; absolute
paths, traversal, URLs, backslashes, queries, fragments, empty segments, and
unsafe path characters are rejected.

## Generation and validation

`generateAssetManifest` accepts the client identity, an absolute build-time
`publicDirectory`, and image references. It:

1. validates the reference structure and supported media type;
2. rejects duplicate IDs and case-insensitive path collisions;
3. verifies each path resolves to a regular file inside `publicDirectory`,
   including after symlink resolution;
4. derives a deployment-local public URL such as
   `/assets/hero/primary.png`;
5. sorts entries deterministically by asset ID and source path;
6. returns a deeply immutable manifest.

The absolute build path is never emitted into the manifest. A handed-off
deployment therefore retains only repository-relative source paths and local
public URLs.

`validateAssetManifest` revalidates unknown manifest data and canonicalizes
entry order without filesystem access. `createEmptyAssetManifest` provides the
backward-compatible no-assets case.

## Client isolation

`createAssetResolver(manifest, expectedClientId)` validates the manifest before
binding it to exactly one client identity. A mismatch throws
`ASSET_CLIENT_MISMATCH`. Required lookup throws `UNKNOWN_ASSET_ID`; optional
lookup returns `undefined`.

Two isolated deployments may use the same asset ID and public URL because the
files and manifests live inside separate deployment roots. The client identity
remains in the manifest and resolver boundary, not in the public URL.

## Error behavior

All operational failures throw `AssetPipelineError` with a stable `code`.
Relevant codes cover invalid manifests, client IDs, public directories, asset
IDs and paths, public paths, metadata, unsupported formats, media mismatches,
duplicate IDs or paths, missing files, client mismatches, and unknown IDs.

## Commands

```powershell
pnpm --filter @melbourne-local-growth-ops/asset-pipeline test
pnpm --filter @melbourne-local-growth-ops/asset-pipeline typecheck
pnpm --filter @melbourne-local-growth-ops/asset-pipeline build
```
