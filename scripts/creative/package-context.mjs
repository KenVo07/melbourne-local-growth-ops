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
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* Section items are not one shape. A service carries title/description, an FAQ
 * carries question/answer, a testimonial carries quote/attribution, and a trust
 * signal is a bare string. Reading only `title` silently drops most of a
 * client's actual copy, which is the copy a design session is told to build
 * from. Every shape is read, and anything unrecognised is kept verbatim rather
 * than discarded. */
const ITEM_LABEL_KEYS = ["title", "heading", "label", "question", "quote", "name"];
const ITEM_BODY_KEYS = ["description", "answer", "body", "summary", "attribution", "caption"];

function summariseItem(item) {
  if (typeof item === "string") {
    return { label: "", body: item.trim() };
  }
  if (item === null || typeof item !== "object") {
    return { label: "", body: "" };
  }
  const label = ITEM_LABEL_KEYS.map((key) => textOf(item[key])).find(
    (value) => value !== "",
  );
  const body = ITEM_BODY_KEYS.map((key) => textOf(item[key])).find(
    (value) => value !== "",
  );
  return {
    label: label ?? "",
    body: body ?? "",
    /* A testimonial's disclosure is the field that stops it being read as
     * evidence. It must never be dropped on the way to a design session. */
    disclosure: textOf(item.disclosure),
  };
}

/** Pulls readable copy out of a profile section without assuming its shape. */
function summariseSection(section) {
  const items = Array.isArray(section.items) ? section.items : [];
  const actions = Array.isArray(section.actions) ? section.actions : [];
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
    items: items.map(summariseItem),
    actions: actions.map((action) => ({
      kind: textOf(action.kind),
      state: textOf(action.state),
      label: textOf(action.label),
      message: textOf(action.message),
    })),
    disclaimer: textOf(section.disclaimer),
  };
}

/* A project's story blocks are the "substantial proof or content sequence" the
 * operator pack requires a Signature Slice to be built from. Carrying only a
 * count guarantees the session invents the narrative it was told not to. */
function summariseStoryBlock(block) {
  const media = Array.isArray(block.media) ? block.media : [];
  return {
    blockId: textOf(block.blockId),
    type: textOf(block.type),
    heading: textOf(block.heading),
    body: textOf(block.body),
    media: media.map((asset) => ({
      assetId: textOf(asset.assetId),
      alt: textOf(asset.alt),
      caption: textOf(asset.caption),
    })),
  };
}

export function buildContext(definition) {
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
      demonstrationDisclosure: textOf(project.demonstrationDisclosure),
      facts: (project.facts ?? []).map((fact) => ({
        label: textOf(fact.label),
        value: textOf(fact.value),
      })),
      story: (project.story ?? []).map(summariseStoryBlock),
      hero:
        project.hero === undefined
          ? null
          : {
              assetId: textOf(project.hero.assetId),
              alt: textOf(project.hero.alt),
              caption: textOf(project.hero.caption),
            },
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

export function renderBrief(context, envelope) {
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

  /* The summary tables above answer "what exists". A design session also has to
   * be able to *write with* the client's words, so the copy itself follows. */
  const sectionCopy = context.profileSections
    .map((section) => {
      const lines = [`#### ${section.heading || section.type} — \`${section.type}\``];
      if (section.eyebrow !== "") lines.push(`*${section.eyebrow}*`);
      if (section.body !== "") lines.push(section.body);
      for (const item of section.items ?? []) {
        if (item.label !== "" && item.body !== "") {
          lines.push(`- **${item.label}** — ${item.body}`);
        } else if (item.label !== "" || item.body !== "") {
          lines.push(`- ${item.label || item.body}`);
        }
        if (item.disclosure) lines.push(`  - Disclosure: ${item.disclosure}`);
      }
      for (const action of section.actions ?? []) {
        lines.push(`- **${action.label || action.kind}** (${action.state}) — ${action.message}`);
      }
      if (section.disclaimer !== "") lines.push(`> ${section.disclaimer}`);
      return lines.join("\n\n");
    })
    .join("\n\n");

  const projectCopy = projects
    .map((project) => {
      const lines = [
        `#### ${project.title} — \`${project.truthMode}\`${project.locationLabel ? ` · ${project.locationLabel}` : ""}`,
      ];
      if (project.summary !== "") lines.push(project.summary);
      if (project.demonstrationDisclosure) {
        lines.push(`> ${project.demonstrationDisclosure}`);
      }
      if (project.hero) {
        lines.push(
          `Hero \`${project.hero.assetId}\` — ${project.hero.alt}${project.hero.caption ? ` · ${project.hero.caption}` : ""}`,
        );
      }
      for (const block of project.story ?? []) {
        lines.push(`**${block.type} · ${block.heading}**`);
        if (block.body !== "") lines.push(block.body);
        for (const asset of block.media ?? []) {
          lines.push(`Media \`${asset.assetId}\` — ${asset.alt}${asset.caption ? ` · ${asset.caption}` : ""}`);
        }
      }
      if ((project.facts ?? []).length > 0) {
        lines.push(
          (project.facts ?? [])
            .map((fact) => `- ${fact.label}: ${fact.value}`)
            .join("\n"),
        );
      }
      return lines.join("\n\n");
    })
    .join("\n\n");

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

### The copy this content actually carries

A design session is required to build with these words rather than plausible
substitutes. Anything it needs that is not below is a missing input to request.

${sectionCopy || "No profile section copy is carried by this definition."}

## Projects

| Project | Truth mode | Depth |
|---|---|---|
${projectRows || "| — | — | — |"}

### The project record, in full

These are the story blocks a Signature Slice's proof sequence is built from.

${projectCopy || "This definition carries no projects."}

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

export async function packageCreativeContext(inputArgument, outputArgument) {
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

  const written = [
    join(outputDirectory, "CREATIVE_CONTEXT.md"),
    join(outputDirectory, "creative-context.json"),
    join(outputDirectory, "signature-capability-envelope.md"),
  ];
  await writeFile(written[1], `${JSON.stringify(context, null, 2)}\n`, "utf8");
  await writeFile(written[0], renderBrief(context, envelope), "utf8");
  await copyFile(
    resolve(repositoryRoot, "docs/creative/signature-capability-envelope.md"),
    written[2],
  );

  return { context, outputDirectory, written };
}

export async function runPackageContextCli(args = process.argv.slice(2)) {
  const [inputArgument, outputArgument] = args.filter((value) => !value.startsWith("--"));

  if (inputArgument === undefined || outputArgument === undefined) {
    process.stdout.write(
      "usage: pnpm creative:package <client-build-package-or-json> <output-directory>\n",
    );
    process.exitCode = 1;
    return;
  }

  const { context, outputDirectory } = await packageCreativeContext(
    inputArgument,
    outputArgument,
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

/*
 * The CLI runs only when this file is the process entry point. The premium
 * bridge imports the builders above so a prepared workspace carries exactly the
 * same context and scaffold as the commands produce, and an import that wrote to
 * stdout or set an exit code could not be used that way.
 */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runPackageContextCli();
}
