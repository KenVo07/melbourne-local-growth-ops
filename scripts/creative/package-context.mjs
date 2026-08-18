/**
 * Packages a current P1 client into a creative exploration context.
 *
 *   pnpm creative:package <client-build-package-or-json> <output-directory>
 *
 * A creative exploration that starts from a blank canvas invents a business.
 * This reads the client's *validated definition* and emits the real material a
 * design session needs — the route set it must cover, the actual copy, the
 * media that exists, and the claims that are not evidenced — so exploration
 * starts from client truth rather than from a plausible-sounding fiction.
 *
 * It extracts. It never invents: every string in the output is either copied
 * from the definition or is a scaffold prompt. Anything the definition does not
 * carry is listed as a missing input rather than filled in.
 *
 * The output is deliberately tool-independent. It is equally usable by Claude
 * Design, another canvas tool, or a person with a sketchbook.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Pulls readable copy out of a profile section without assuming its shape. */
function summariseSection(section) {
  const items = Array.isArray(section.items) ? section.items : [];
  return {
    type: textOf(section.type),
    sectionId: textOf(section.sectionId),
    eyebrow: textOf(section.eyebrow),
    heading: textOf(section.heading),
    body: textOf(section.body),
    itemCount: items.length,
    itemTitles: items
      .map((item) => textOf(item.title) || textOf(item.heading) || textOf(item.label))
      .filter((title) => title !== ""),
    disclaimer: textOf(section.disclaimer),
  };
}

function buildContext(definition) {
  const display = definition.configuration?.display ?? {};
  const pages = definition.pageGraph?.pages ?? [];
  const projects = definition.projects?.projects ?? [];
  const assets = definition.assets ?? [];
  const sections = definition.profile?.sections ?? [];

  const demonstrationProjects = projects.filter(
    (project) => textOf(project.truthMode) !== "REAL",
  );

  return {
    schemaVersion: 1,
    generatedBy: "scripts/creative/package-context.mjs",
    client: {
      clientId: textOf(definition.configuration?.clientId),
      businessName: textOf(display.businessName),
      tagline: textOf(display.tagline),
      canonicalHostname: textOf(
        (definition.configuration?.domains ?? []).find((domain) => domain.canonical)
          ?.hostname,
      ),
      profile: textOf(definition.profile?.profile),
      archetype: textOf(definition.profile?.archetype),
    },
    pageGraph: {
      homePageId: textOf(definition.pageGraph?.homePageId),
      pageCount: pages.length,
      pages: pages.map((page) => ({
        pageId: textOf(page.pageId),
        path: textOf(page.path),
        kind: textOf(page.kind),
        experienceRouteId: textOf(page.experienceRouteId),
        title: textOf(page.title),
      })),
      routeKinds: [...new Set(pages.map((page) => textOf(page.kind)))].sort(),
      /* Navigation is grouped by placement (primary / utility / footer). */
      navigation: Object.fromEntries(
        Object.entries(definition.pageGraph?.navigation ?? {})
          .filter(([, items]) => Array.isArray(items))
          .map(([placement, items]) => [
            placement,
            items.map((item) => textOf(item.label)).filter((label) => label !== ""),
          ]),
      ),
    },
    profileSections: sections.map(summariseSection),
    projects: projects.map((project) => ({
      projectId: textOf(project.projectId),
      title: textOf(project.title),
      summary: textOf(project.summary),
      truthMode: textOf(project.truthMode),
      locationLabel: textOf(project.locationLabel),
      serviceIds: project.serviceIds ?? [],
      storyBlockCount: (project.story ?? []).length,
      factCount: (project.facts ?? []).length,
      galleryCount: (project.gallery ?? []).length,
      hasHero: project.hero !== undefined,
    })),
    media: {
      assetCount: assets.length,
      assets: assets.map((asset) => ({
        assetId: textOf(asset.assetId),
        kind: textOf(asset.kind),
        sourcePath: textOf(asset.sourcePath),
        mediaType: textOf(asset.mediaType),
        width: asset.width ?? null,
        height: asset.height ?? null,
        /* Provenance is not in the client definition. It must be classified by a
         * human in the media plan; recording it as UNCLASSIFIED keeps that
         * outstanding rather than letting it default to something reassuring. */
        provenance: "UNCLASSIFIED",
      })),
    },
    experience: {
      kind: textOf(definition.clientExperience?.kind),
      manifestPath: textOf(definition.clientExperience?.manifestPath),
    },
    truth: {
      demonstrationProjectCount: demonstrationProjects.length,
      demonstrationProjectIds: demonstrationProjects.map((project) =>
        textOf(project.projectId),
      ),
      /* What a creative direction must not assert on this client's behalf. */
      unevidencedClaimTypes: [
        "completed work presented as the client's own",
        "team members, premises or equipment",
        "measured results, ratings or reviews",
        "licences, certifications, insurance or awards",
      ],
    },
  };
}

function renderBrief(context, envelope) {
  const { client, pageGraph, projects, media, truth } = context;
  const routeRows = pageGraph.pages
    .map(
      (page) =>
        `| \`${page.path || "—"}\` | ${page.kind} | ${page.experienceRouteId} |`,
    )
    .join("\n");
  const sectionRows = context.profileSections
    .map(
      (section) =>
        `| ${section.type} | ${section.heading || "—"} | ${section.itemCount || "—"} |`,
    )
    .join("\n");
  const assetRows = media.assets
    .map(
      (asset) =>
        `| \`${asset.assetId}\` | ${asset.kind} | ${asset.width ?? "?"}×${asset.height ?? "?"} | ${asset.provenance} |`,
    )
    .join("\n");
  const projectRows = projects
    .map(
      (project) =>
        `| ${project.title} | ${project.truthMode} | ${project.storyBlockCount} story · ${project.galleryCount} gallery |`,
    )
    .join("\n");

  const permitted = envelope.techniques
    .filter((technique) => technique.status === "PERMITTED")
    .map((technique) => technique.id);

  return `# Creative context — ${client.businessName || client.clientId}

**Generated by \`pnpm creative:package\`. Everything below is copied from the
client's validated definition. Nothing here is invented.**

This is the material a creative exploration starts from. Use it so the work is
about *this* business rather than a plausible one. Where something you need is
not here, it is a missing input to request — not a detail to imagine.

## The business, as the definition states it

| | |
|---|---|
| Client id | \`${client.clientId || "—"}\` |
| Business name | ${client.businessName || "—"} |
| Tagline | ${client.tagline || "—"} |
| Profile | ${client.profile || "—"} |
| Archetype | ${client.archetype || "—"} |
| Canonical hostname | ${client.canonicalHostname || "—"} |

## Routes the design must cover

${pageGraph.pageCount} pages across ${pageGraph.routeKinds.length} page kinds. A territory that only designs a home page has not been designed.

| Path | Page kind | Experience route |
|---|---|---|
${routeRows}

${Object.entries(pageGraph.navigation)
  .filter(([, labels]) => labels.length > 0)
  .map(
    ([placement, labels]) =>
      `${placement[0].toUpperCase()}${placement.slice(1)} navigation: ${labels.map((label) => `**${label}**`).join(" · ")}`,
  )
  .join("\n\n") || "No navigation labels declared."}

## Content the profile actually carries

| Section | Heading | Items |
|---|---|---|
${sectionRows}

## Projects

| Project | Truth mode | Depth |
|---|---|---|
${projectRows || "| — | — | — |"}

## Media that exists

${media.assetCount} assets. Provenance is **UNCLASSIFIED** here because the client definition does not carry it — classify every one of them in the media plan before any of it substantiates a claim.

| Asset | Kind | Intrinsic size | Provenance |
|---|---|---|---|
${assetRows || "| — | — | — | — |"}

## What this client may not claim

${truth.demonstrationProjectCount} of ${projects.length} projects are not \`REAL\` truth mode${truth.demonstrationProjectIds.length > 0 ? ` (${truth.demonstrationProjectIds.map((id) => `\`${id}\``).join(", ")})` : ""}.

A creative direction must not assert, imply or illustrate:

${truth.unevidencedClaimTypes.map((claim) => `- ${claim}`).join("\n")}

unless real client evidence exists and is classified \`REAL_CLIENT_EVIDENCE\` in
the media plan. Art direction that needs a claim the client cannot make is a
direction that has to change.

## What a Signature may actually do here

The client-local source policy decides this, and it fails closed. ${permitted.length} techniques are permitted; see \`signature-capability-envelope.md\` beside this file for the measured matrix and the refusals.

Permitted: ${permitted.map((id) => `\`${id}\``).join(", ")}

The constraint that most often surprises a prototype: **a Signature cannot fetch
anything at runtime.** Shaders must be inline, geometry authored in source, and
all validated client imagery rendered through the Platform image primitive.

## Next step

The scaffolded creative artifacts are in this directory. Fill
\`creative-intent.md\` first, then three materially different territories, then
run:

\`\`\`
pnpm creative:validate <this directory>
\`\`\`
`;
}

const args = process.argv.slice(2);
const [inputArgument, outputArgument] = args.filter((value) => !value.startsWith("--"));

if (inputArgument === undefined || outputArgument === undefined) {
  process.stdout.write(
    "usage: pnpm creative:package <client-build-package-or-json> <output-directory>\n",
  );
  process.exitCode = 1;
} else {
  const inputPath = resolve(inputArgument);
  const definitionPath = inputPath.endsWith(".json")
    ? inputPath
    : join(inputPath, "client-website.json");
  const definition = JSON.parse(await readFile(definitionPath, "utf8"));

  const envelopePath = resolve(
    repositoryRoot,
    "docs/creative/signature-capability-envelope.json",
  );
  const envelope = JSON.parse(await readFile(envelopePath, "utf8"));

  const context = buildContext(definition);
  const outputDirectory = resolve(outputArgument);
  await mkdir(outputDirectory, { recursive: true });

  await writeFile(
    join(outputDirectory, "creative-context.json"),
    `${JSON.stringify(context, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "CREATIVE_CONTEXT.md"),
    renderBrief(context, envelope),
    "utf8",
  );
  await copyFile(
    resolve(repositoryRoot, "docs/creative/signature-capability-envelope.md"),
    join(outputDirectory, "signature-capability-envelope.md"),
  );

  process.stdout.write(
    `Packaged ${context.client.businessName || context.client.clientId} for creative exploration:\n` +
      `  ${outputDirectory}/CREATIVE_CONTEXT.md\n` +
      `  ${outputDirectory}/creative-context.json\n` +
      `  ${outputDirectory}/signature-capability-envelope.md\n\n` +
      `${context.pageGraph.pageCount} pages · ${context.projects.length} projects · ${context.media.assetCount} assets · ` +
      `${context.truth.demonstrationProjectCount} non-REAL project(s)\n\n` +
      `Scaffold the creative artifacts alongside it with:\n` +
      `  pnpm creative:new ${context.client.clientId || "<client-id>"} ${outputArgument}\n`,
  );
}
