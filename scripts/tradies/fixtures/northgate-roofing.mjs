/**
 * Second-context generalisation fixture: **Northgate Roofing & Metal**.
 *
 * A synthetic delivery package for a fictional roofing and architectural
 * metalwork contractor, built to be materially unlike the first premium client
 * in every dimension that matters:
 *
 * | | first premium client | this fixture |
 * |---|---|---|
 * | trade | landscape construction | roofing and sheet metal |
 * | services | 3 peers | 10 across 3 groups |
 * | projects | 3 | 34 |
 * | media | 14 photographs, one provenance | 41 assets, five provenances, mixed grade |
 * | evidence | complete | deliberately incomplete, so the shot gap has work to do |
 *
 * Nothing here is anyone's real business, and nothing here is a Factory
 * default. Its purpose is to prove the semantics, the cardinality policy and
 * the delivery workflow generalise — not to be a second flagship website.
 *
 * The projects past the first eight are generated rather than written, using
 * the cardinality-harness method: synthetic records, varied along the axes the
 * archive actually reads (service, suburb, year), never touching real truth.
 */

const SUBURBS = [
  "Northcote", "Preston", "Thornbury", "Reservoir", "Coburg",
  "Brunswick West", "Pascoe Vale", "Fairfield", "Alphington", "Strathmore",
  "Heidelberg", "Rosanna", "Macleod", "Bundoora", "Fawkner",
];

const SERVICE_GROUPS = [
  { groupId: "roofing", title: "Roofing", description: "Everything that keeps water out of the building." },
  { groupId: "metalwork", title: "Architectural metal", description: "Fabricated and installed on site." },
  { groupId: "maintenance", title: "Maintenance and repair", description: "Work on roofs that already exist." },
];

function service({ serviceId, groupId, title, summary, narrative, covers, excludes, suitedTo, whenToCall, customerProvides, stages = [], commercial = [], questions = [], featured = false }) {
  return {
    serviceId, groupId, title, summary, narrative,
    covers, excludes, suitedTo, whenToCall, customerProvides,
    stages, commercial, questions, featured,
  };
}

const SERVICES = [
  service({
    serviceId: "roof-replacement",
    groupId: "roofing",
    title: "Full roof replacement",
    featured: true,
    summary: "Strip and replace a tile or metal roof, including battens, sarking and flashings.",
    narrative:
      "A replacement is the right call when a roof has reached the end of its life rather than developed a fault. We strip back to the rafters, replace battens and sarking, and install the new covering with all flashings renewed. Most single-storey homes are watertight again the same day the old covering comes off, and we do not leave a roof open overnight.",
    covers: [
      "Removal and disposal of the existing covering",
      "New battens and sarking where required",
      "New ridge, valley, apron and barge flashings",
      "Reconnecting existing solar mounts to the new covering",
    ],
    excludes: [
      "Structural repairs to rafters or trusses — we will tell you if you need them and who to call",
      "Asbestos removal, which is a licensed trade we do not hold",
      "Solar panel electrical work",
      "Internal ceiling or plaster repair",
    ],
    suitedTo: [
      "Roofs over about forty years old with recurring leaks",
      "Homes where more than a quarter of the tiles have failed",
      "A re-roof being done alongside an extension",
    ],
    whenToCall: [
      "A patch repair has failed twice in the same place",
      "You can see daylight from inside the roof space",
      "You are planning an extension and the existing roof will need to match",
    ],
    customerProvides: [
      "Access for a truck and a skip for the day",
      "Confirmation of anything in the roof space we should not disturb",
      "Body corporate approval, for a unit or a townhouse",
    ],
    stages: [
      { title: "Inspection and written quote", description: "We get on the roof, photograph what we find, and quote in writing against a fixed scope." },
      { title: "Strip and make safe", description: "The old covering comes off in sections so the building is never left open." },
      { title: "Install and flash", description: "New covering, new flashings, and a check of every penetration." },
      { title: "Clean and hand over", description: "Magnet sweep of the site, gutters cleared, and photographs of the finished work." },
    ],
    commercial: [
      { label: "Quotes", value: "Free", qualifier: "Written, after an on-roof inspection" },
      { label: "Workmanship warranty", value: "10 years", qualifier: "On installation; product warranties are the manufacturer's" },
    ],
    questions: [
      { question: "Can you re-roof in stages if I cannot do it all at once?", answer: "Sometimes. A roof with distinct sections can be staged; a simple gable usually cannot be split without leaving a join that will need redoing." },
      { question: "What happens if it rains?", answer: "We only strip what we can close the same day, and we watch the forecast. If a day is called off, the roof is closed before we leave." },
    ],
  }),
  service({
    serviceId: "metal-roofing",
    groupId: "roofing",
    title: "Colorbond and zinc roofing",
    featured: true,
    summary: "Standing seam, corrugated and tray roofing in coated steel and zinc.",
    narrative:
      "Metal suits low pitches, complex shapes and anywhere weight matters. We roll standing seam on site, which means the sheets run full length with no end laps on most houses. Zinc costs more and weathers rather than fades; we will show you both on a sample before you decide.",
    covers: [
      "Standing seam, corrugated and tray profiles",
      "On-site roll-forming for continuous sheet lengths",
      "Matching fascia, capping and barge",
      "Insulation and anti-condensation blanket",
    ],
    excludes: [
      "Structural steel and framing",
      "Roof plumbing beyond the gutter outlet",
    ],
    suitedTo: [
      "Low-pitch and skillion roofs a tile cannot serve",
      "Extensions where the new roof is visible from the street",
      "Coastal or exposed sites where fixings matter more than finish",
    ],
    whenToCall: [
      "An architect has specified a seam profile and you need it priced",
      "You want a roof that will not need re-bedding in fifteen years",
    ],
    customerProvides: [
      "Plans or elevations if the roof is part of a new build",
      "A decision on colour, from a physical sample rather than a screen",
    ],
    stages: [
      { title: "Measure and set out", description: "Every sheet is measured on the building, not off the plan." },
      { title: "Roll on site", description: "Sheets are formed at the kerb and lifted straight to the roof." },
      { title: "Fix and seam", description: "Clips, then the seam closed mechanically along its whole length." },
    ],
    commercial: [
      { label: "Typical lead time", value: "3–5 weeks", qualifier: "From accepted quote to start, subject to material" },
    ],
    questions: [
      { question: "Is metal noisy in rain?", answer: "Not with insulation and blanket under it, which we include. Bare metal over an open carport is a different matter and we will say so." },
    ],
  }),
  service({
    serviceId: "tile-roofing",
    groupId: "roofing",
    title: "Tile roofing and re-bedding",
    summary: "Terracotta and concrete tile work, ridge re-bedding and repointing.",
    narrative:
      "Most tile roofs fail at the mortar long before the tiles do. Re-bedding lifts the ridge and hip caps, renews the mortar bed underneath and repoints with a flexible pointing compound that moves with the roof instead of cracking away from it.",
    covers: ["Ridge and hip re-bedding", "Flexible repointing", "Broken tile replacement", "Valley iron replacement"],
    excludes: ["Slate roofing, which is a different trade and we will refer you", "Roof painting or sealing, which we do not believe in for terracotta"],
    suitedTo: ["Tile roofs between twenty and fifty years old", "A roof that sheds mortar into the gutters"],
    whenToCall: ["You are finding grit or mortar in the downpipes", "Ridge caps are visibly lifting or rocking"],
    customerProvides: ["Access to the roof line and somewhere to stand a ladder"],
    stages: [
      { title: "Inspect and photograph", description: "We walk the roof and show you what we found before quoting." },
      { title: "Re-bed and repoint", description: "Old mortar out, new bed, then flexible pointing over it." },
    ],
    commercial: [{ label: "Workmanship warranty", value: "10 years", qualifier: "On pointing and bedding" }],
    questions: [{ question: "Do I need the whole roof done?", answer: "Usually not. Ridges facing weather fail first, and we quote by run rather than by roof." }],
  }),
  service({
    serviceId: "guttering",
    groupId: "roofing",
    title: "Gutters, downpipes and stormwater",
    summary: "Replacement guttering, box gutters, downpipes and connection to stormwater.",
    covers: ["Quad, half-round and box gutters", "Downpipes and rainheads", "Connection to existing stormwater", "Leaf guard"],
    excludes: ["Underground stormwater beyond the first connection point", "Council drainage applications"],
    suitedTo: ["Gutters that overflow at the back rather than the front", "Box gutters with no overflow provision"],
    whenToCall: ["Water is getting behind the fascia", "A box gutter has been patched more than once"],
    customerProvides: ["Access along the eaves line", "Where the water currently goes, if you know"],
    stages: [{ title: "Measure and fall", description: "We set falls on the building; a gutter that looks level usually is not draining." }],
    commercial: [],
    questions: [],
  }),
  service({
    serviceId: "flashings",
    groupId: "metalwork",
    title: "Custom flashings and cappings",
    summary: "Folded on site to fit what is actually there rather than what the plan said.",
    covers: ["Apron, step and cover flashings", "Parapet and wall cappings", "Chimney and penetration flashings"],
    excludes: ["Waterproof membrane work"],
    suitedTo: ["Junctions between old and new work", "Anywhere a standard section does not fit"],
    whenToCall: ["A leak follows a wall junction rather than the roof field"],
    customerProvides: ["Access to measure the actual junction"],
    stages: [],
    commercial: [],
    questions: [],
  }),
  service({
    serviceId: "architectural-metal",
    groupId: "metalwork",
    title: "Architectural sheet metal",
    featured: true,
    summary: "Cladding, screens, planter linings and one-off fabrication in steel, zinc and copper.",
    narrative:
      "This is the work that has no catalogue number. Screens, cladding panels, letterbox surrounds, planter linings — folded in the shop from a real measurement and finished on site. If a builder or architect has drawn something and cannot find anyone to make it, this is usually where it ends up.",
    covers: ["Sheet cladding and panel systems", "Perforated and folded screens", "Planter and bench linings", "Copper and zinc one-offs"],
    excludes: ["Structural steel fabrication", "Powder coating, which we subcontract and pass through at cost"],
    suitedTo: ["Architect-drawn details with no off-the-shelf equivalent", "Heritage work where the original detail must be matched"],
    whenToCall: ["You have a drawing and three trades have said no"],
    customerProvides: ["The drawing, and access to measure before fabrication"],
    stages: [
      { title: "Measure and prototype", description: "One piece is made and fitted before the rest are cut." },
      { title: "Fabricate", description: "In the shop, from the measured piece rather than the drawing." },
      { title: "Install", description: "On site, with the fixings the substrate actually takes." },
    ],
    commercial: [{ label: "Quoting", value: "Per drawing", qualifier: "Fabrication is quoted from a drawing; site work is quoted after a measure" }],
    questions: [{ question: "Will you work from my architect's details?", answer: "Yes, and we will tell you early if a detail cannot be folded as drawn." }],
  }),
  service({
    serviceId: "skylights",
    groupId: "metalwork",
    title: "Skylights and roof windows",
    summary: "Supply and install, including the flashing kit and the internal shaft.",
    covers: ["Fixed and opening roof windows", "Flashing kits for tile and metal", "Internal shaft framing and lining"],
    excludes: ["Plaster finishing and painting of the internal shaft", "Electrical work for powered units"],
    suitedTo: ["Dark rooms with no external wall", "Bathrooms and stairwells"],
    whenToCall: ["You are already having roof work done and the access is there"],
    customerProvides: ["Ceiling access and a decision on shaft position"],
    stages: [],
    commercial: [],
    questions: [],
  }),
  service({
    serviceId: "leak-repair",
    groupId: "maintenance",
    title: "Leak investigation and repair",
    featured: true,
    summary: "Find the actual source rather than sealing the nearest suspicious thing.",
    narrative:
      "Most leaks are not where the water appears. We hose-test in sections from the bottom up until it shows, then repair what is actually wrong. If the honest answer is that the roof needs replacing rather than repairing, we say that instead of selling you a repair that will fail.",
    covers: ["Sectional hose testing", "Flashing and penetration repair", "Tile and sheet replacement", "A written report with photographs"],
    excludes: ["Internal water damage, plaster and painting", "Mould remediation"],
    suitedTo: ["A stain that returns after rain", "A leak that three people have already failed to find"],
    whenToCall: ["Water is appearing inside", "An insurer has asked for a cause-of-damage report"],
    customerProvides: ["Access to the affected room", "When it leaks — steady rain, driving rain, or only some directions"],
    stages: [
      { title: "Test", description: "From the bottom up, in sections, until the water shows." },
      { title: "Report", description: "Photographs and a written cause, whether or not you use us for the repair." },
      { title: "Repair", description: "The actual source, quoted separately from the investigation." },
    ],
    commercial: [
      { label: "Investigation", value: "$385", qualifier: "Fixed, includes the written report; credited against a repair over $1,500" },
    ],
    questions: [
      { question: "What if you cannot find it?", answer: "You still get the report showing what was tested and ruled out, which is what an insurer wants. We do not charge twice to come back." },
    ],
  }),
  service({
    serviceId: "roof-maintenance",
    groupId: "maintenance",
    title: "Scheduled roof maintenance",
    summary: "An annual visit for buildings where a failure is expensive.",
    covers: ["Gutter and box gutter clearing", "Flashing and fixing check", "Photographic condition report"],
    excludes: ["Repairs, which are quoted separately after the visit"],
    suitedTo: ["Commercial buildings", "Homes under heavy tree cover"],
    whenToCall: ["Before autumn, rather than after the first blocked gutter"],
    customerProvides: ["Roof access and keys where needed"],
    stages: [],
    commercial: [{ label: "Annual visit", value: "From $290", qualifier: "Single-storey residential; commercial quoted on inspection" }],
    questions: [],
  }),
  service({
    serviceId: "storm-response",
    groupId: "maintenance",
    title: "Storm damage make-safe",
    summary: "Temporary make-safe after wind or hail, and the report an insurer will accept.",
    covers: ["Emergency tarping and make-safe", "Photographic damage report", "Quoting for permanent repair"],
    excludes: ["Dealing with your insurer on your behalf", "Tree removal"],
    suitedTo: ["Wind-lifted sheets or ridge caps", "Hail damage requiring assessment"],
    whenToCall: ["Immediately after damage, before the next front"],
    customerProvides: ["Your insurer's claim number if you have one"],
    stages: [],
    commercial: [],
    questions: [{ question: "Do you attend after hours?", answer: "For make-safe, yes, within our service area. Permanent repairs are booked in normal hours." }],
  }),
];

const AUTHORED_PROJECTS = [
  { projectId: "thornbury-terrace-reroof", title: "Thornbury terrace re-roof", serviceIds: ["roof-replacement", "guttering"], suburb: "Thornbury", year: 2025, featured: true,
    summary: "A 1910 terrace with a failed terracotta roof, re-roofed in matching profile with new box gutters behind the parapet.",
    brief: "The owners had patched the same valley three times in two winters. The roof was original, the valley irons had rusted through, and the box gutter behind the parapet had no overflow.",
    approach: "Stripped in two halves so the building was never open, replaced battens and sarking, and formed a new box gutter with a rainhead and an overflow that discharges where it can be seen.",
    outcome: "Watertight through the following winter with no callbacks. The overflow has run twice, which is the point of having one." },
  { projectId: "northcote-standing-seam", title: "Northcote standing seam extension", serviceIds: ["metal-roofing", "flashings"], suburb: "Northcote", year: 2025, featured: true,
    summary: "A rear extension in zinc standing seam, rolled on site so the sheets run unbroken from ridge to gutter.",
    brief: "The architect had drawn a 3-degree skillion in zinc with no visible fixings and no end laps.",
    approach: "Rolled 11-metre sheets at the kerb, lifted them in one piece, and clipped and seamed on the roof. Every penetration was set out before the sheets went down.",
    outcome: "No end laps anywhere on the roof, which is what the detail needed and what a factory-length sheet could not have given." },
  { projectId: "preston-warehouse-metal", title: "Preston warehouse screen", serviceIds: ["architectural-metal"], suburb: "Preston", year: 2024, featured: true,
    summary: "A perforated steel screen wrapping a warehouse conversion's stair, folded from a measured prototype.",
    brief: "The drawn detail had a 6mm shadow gap that could not survive the tolerance of the existing brickwork.",
    approach: "Made and fitted one panel first, measured what the wall actually did, then fabricated the rest to suit.",
    outcome: "The shadow gap reads consistent along the whole run because the panels are not identical." },
  { projectId: "coburg-leak-investigation", title: "Coburg leak, four years old", serviceIds: ["leak-repair"], suburb: "Coburg", year: 2024, featured: true,
    summary: "A recurring ceiling stain that two previous trades had sealed in the wrong place.",
    brief: "Water appeared over a bedroom after driving rain from the south-west only. The roof above it had been re-sealed twice.",
    approach: "Hose-tested from the gutter line upward in sections. It showed at a wall junction two metres from the stain, where a step flashing had been cut short behind render.",
    outcome: "One flashing replaced. The stain has not returned in two winters." },
  { projectId: "fairfield-tile-rebed", title: "Fairfield ridge re-bed", serviceIds: ["tile-roofing"], suburb: "Fairfield", year: 2024,
    summary: "Ridge and hip re-bedding on a 1960s concrete tile roof shedding mortar into the gutters." },
  { projectId: "strathmore-copper-planters", title: "Strathmore copper planter linings", serviceIds: ["architectural-metal"], suburb: "Strathmore", year: 2023,
    summary: "Six copper planter linings, folded and soldered, to a landscape architect's section." },
  { projectId: "reservoir-storm-response", title: "Reservoir storm make-safe", serviceIds: ["storm-response", "roof-replacement"], suburb: "Reservoir", year: 2023,
    summary: "Overnight make-safe after wind lifted eleven sheets, followed by a full replacement once the insurer settled." },
  { projectId: "brunswick-skylights", title: "Brunswick West skylights", serviceIds: ["skylights", "tile-roofing"], suburb: "Brunswick West", year: 2023,
    summary: "Three fixed roof windows into a dark central hallway, with framed and lined shafts." },
];

const GENERATED_SERVICE_CYCLE = [
  ["roof-replacement"], ["metal-roofing"], ["tile-roofing"], ["guttering"],
  ["leak-repair"], ["roof-maintenance"], ["flashings", "guttering"],
  ["metal-roofing", "flashings"], ["tile-roofing", "leak-repair"], ["architectural-metal"],
  ["storm-response"], ["skylights"], ["roof-replacement", "guttering"],
];

/**
 * The archive tail.
 *
 * Deliberately plain: a real trade archive is mostly one-line records, and an
 * archive that only works when every record is a case study is not an archive.
 */
function generatedProjects(count) {
  return Array.from({ length: count }, (_unused, index) => {
    const suburb = SUBURBS[index % SUBURBS.length];
    const serviceIds = GENERATED_SERVICE_CYCLE[index % GENERATED_SERVICE_CYCLE.length];
    const year = 2019 + (index % 6);
    const label = serviceIds[0].replace(/-/g, " ");
    return {
      projectId: `archive-${String(index + 1).padStart(2, "0")}`,
      title: `${suburb} ${label}`,
      serviceIds: [...serviceIds],
      suburb,
      year,
      summary: `A ${label} job in ${suburb}, completed in ${year}. Recorded for the archive rather than written up as a case study.`,
    };
  });
}

const ALL_PROJECTS = [...AUTHORED_PROJECTS, ...generatedProjects(26)];

/* ---- media ------------------------------------------------------------- */

function asset(overrides) {
  return {
    subject: "COMPLETED_WORK",
    audit: "SALES_GRADE",
    provenance: "CLIENT_JOB_PHOTOGRAPH",
    lane: "SUPPLIED",
    width: 4032,
    height: 3024,
    mediaType: "image/jpeg",
    focalPoint: { x: 0.5, y: 0.45 },
    substantiates: { kind: "NONE", reference: null },
    approvedForPublication: true,
    approvedBy: "Dana Okafor",
    ...overrides,
  };
}

function jobAsset(projectId, ordinal, extra = {}) {
  return asset({
    assetId: `${projectId}-${ordinal}`,
    sourcePath: `assets/${projectId}-${ordinal}.jpg`,
    alt: `Completed roofing work on the ${projectId.replace(/-/g, " ")} job.`,
    substantiates: { kind: "SPECIFIC_JOB", reference: projectId },
    audit: "PROOF_GRADE",
    ...extra,
  });
}

const MEDIA_ASSETS = [
  /* The four featured jobs are properly documented. */
  ...AUTHORED_PROJECTS.slice(0, 4).flatMap((project) => [
    jobAsset(project.projectId, "01"),
    jobAsset(project.projectId, "02", { audit: "SALES_GRADE" }),
  ]),
  /* Two of the remaining authored jobs have exactly one usable frame each. */
  jobAsset("fairfield-tile-rebed", "01", { audit: "RECOVERY_GRADE", width: 3024, height: 4032 }),
  jobAsset("strathmore-copper-planters", "01"),

  /* A real asset improved, and the asset it came from — the pair the contract requires. */
  asset({
    assetId: "reservoir-storm-response-01",
    sourcePath: "assets/reservoir-storm-response-01.jpg",
    alt: "Wind-lifted roof sheets photographed the night of the storm.",
    audit: "RECOVERY_GRADE",
    substantiates: { kind: "SPECIFIC_JOB", reference: "reservoir-storm-response" },
    approvedForPublication: false,
  }),
  asset({
    assetId: "reservoir-storm-response-01-corrected",
    sourcePath: "assets/reservoir-storm-response-01-corrected.jpg",
    alt: "Wind-lifted roof sheets after the storm, exposure corrected.",
    audit: "SALES_GRADE",
    provenance: "ENHANCED_CLIENT_ASSET",
    lane: "AI_ENHANCED",
    sourceAssetId: "reservoir-storm-response-01",
    substantiates: { kind: "SPECIFIC_JOB", reference: "reservoir-storm-response" },
  }),

  /* Business-itself media. */
  asset({ assetId: "team-01", sourcePath: "assets/team-01.jpg", subject: "TEAM", alt: "Two roofers setting out a standing seam roof.", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "BUSINESS_ITSELF", reference: null } }),
  asset({ assetId: "vehicle-01", sourcePath: "assets/vehicle-01.jpg", subject: "VEHICLE", alt: "The signwritten work ute at a job site.", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "BUSINESS_ITSELF", reference: null } }),
  asset({ assetId: "workshop-01", sourcePath: "assets/workshop-01.jpg", subject: "PREMISES", alt: "The sheet metal folder in the workshop.", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "BUSINESS_ITSELF", reference: null } }),
  asset({ assetId: "detail-01", sourcePath: "assets/detail-01.jpg", subject: "MATERIAL_DETAIL", alt: "A closed standing seam running into a hidden gutter.", audit: "PROOF_GRADE", substantiates: { kind: "ATMOSPHERE", reference: null } }),

  /* Atmosphere, generated, carrying no factual claim. */
  asset({
    assetId: "texture-zinc",
    sourcePath: "assets/texture-zinc.jpg",
    subject: "OTHER",
    alt: "An abstract weathered zinc surface used as a background texture.",
    audit: "SALES_GRADE",
    provenance: "GENERATED_SUPPORTING_MEDIA",
    lane: "AI_GENERATED_SUPPORTING",
    substantiates: { kind: "NONE", reference: null },
  }),

  /* Reference material the agency keeps and never publishes. */
  asset({ assetId: "ref-old-site-hero", sourcePath: "assets/ref-old-site-hero.jpg", subject: "OTHER", alt: "", audit: "REFERENCE_ONLY", provenance: "STOCK_OR_REFERENCE", substantiates: { kind: "NONE", reference: null }, approvedForPublication: false }),
  asset({ assetId: "ref-logo-original", sourcePath: "assets/ref-logo-original.png", subject: "LOGO", alt: "", audit: "REFERENCE_ONLY", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "NONE", reference: null }, approvedForPublication: false, mediaType: "image/png" }),

  /* The long tail: phone photographs of archive jobs, mostly unusable as shot. */
  ...generatedProjects(26).slice(0, 22).map((project, index) =>
    asset({
      assetId: `${project.projectId}-01`,
      sourcePath: `assets/${project.projectId}-01.jpg`,
      alt: `${project.title}, photographed on completion.`,
      audit: index % 3 === 0 ? "RECOVERY_GRADE" : "PROOF_GRADE",
      width: index % 4 === 0 ? 1200 : 3024,
      height: index % 4 === 0 ? 1600 : 4032,
      substantiates: { kind: "SPECIFIC_JOB", reference: project.projectId },
      approvedForPublication: index % 5 !== 4,
      ...(index % 5 === 4 ? { approvedBy: undefined } : {}),
    }),
  ),
];

/* ---- the five records -------------------------------------------------- */

export const saleHandoff = Object.freeze({
  schemaVersion: 1,
  kind: "SALE_HANDOFF",
  clientId: "northgate-roofing",
  businessName: "Northgate Roofing & Metal",
  trade: "ROOFING",
  tier: "P2",
  soldOn: "2026-08-03",
  soldBy: "Founder",
  approvalAuthority: { name: "Marek Sowinski", role: "Director", email: "marek@northgate-roofing.example.com.au" },
  contacts: [
    { name: "Marek Sowinski", role: "Director", email: "marek@northgate-roofing.example.com.au" },
    { name: "Dana Okafor", role: "Office manager", email: "office@northgate-roofing.example.com.au" },
  ],
  includedPages: ["HOME", "SERVICES_INDEX", "SERVICE_DETAIL", "PROJECTS_INDEX", "PROJECT_DETAIL", "ABOUT", "CONTACT"],
  includedCapabilities: ["CONTACT_FORM"],
  exclusions: ["Online booking", "Customer login", "Price calculator"],
  commitments: [
    "The architectural metal page will show the Preston screen specifically — asked for by name during the sale.",
    "Two rounds of factual corrections included before launch.",
  ],
  deadline: "2026-10-15",
  currentSite: "https://northgate-roofing.example.com.au",
  domain: { name: "northgate-roofing.example.com.au", registrar: "Example Registrar", controlledBy: "CLIENT" },
  notes: "Sold on the strength of the metalwork, not the roofing. The site should lead with what is unusual about them.",
});

export const businessRead = Object.freeze({
  schemaVersion: 1,
  kind: "BUSINESS_READ",
  clientId: "northgate-roofing",
  readOn: "2026-08-05",
  readBy: "Founder",
  sources: [
    { sourceId: "current-site", kind: "EXISTING_WEBSITE", reference: "https://northgate-roofing.example.com.au", observedOn: "2026-08-05" },
    { sourceId: "gbp", kind: "GOOGLE_BUSINESS", reference: "Google Business Profile, Northgate Roofing & Metal", observedOn: "2026-08-05" },
    { sourceId: "instagram", kind: "SOCIAL", reference: "Instagram, 340 posts of in-progress metalwork", observedOn: "2026-08-05" },
    { sourceId: "competitor-a", kind: "COMPETITOR", reference: "Three metro roofing contractors ranking for the same suburbs", observedOn: "2026-08-05" },
  ],
  observations: [
    { observationId: "site-is-roofing-only", sourceId: "current-site", statement: "The current site presents the business as a general roofing contractor and does not mention architectural metalwork at all.", classification: "VERIFIED_PUBLIC_FACT" },
    { observationId: "reviews-mention-diagnosis", sourceId: "gbp", statement: "Reviews repeatedly praise finding a leak others could not.", classification: "VERIFIED_PUBLIC_FACT" },
    { observationId: "instagram-is-the-portfolio", sourceId: "instagram", statement: "The real portfolio lives on Instagram and is invisible to anyone arriving from search.", classification: "VERIFIED_PUBLIC_FACT" },
    { observationId: "metal-is-the-differentiator", sourceId: "competitor-a", statement: "No competitor in the same suburbs offers architect-grade sheet metal, so the metalwork is the position worth taking.", classification: "INFERRED_OPPORTUNITY" },
    { observationId: "diagnosis-as-entry", sourceId: "gbp", statement: "Leak investigation is likely the cheapest first job that leads to a re-roof.", classification: "INFERRED_OPPORTUNITY" },
  ],
  positioning: {
    desiredPerception: ["Precise", "Straight-talking", "The people other trades call"],
    antiPerception: ["Cheap and fast", "A franchise", "Salesy"],
    targetCustomer: "Owners of period homes in Melbourne's inner north, and the architects and builders who specify metalwork for them.",
    desiredJobs: ["Standing seam and zinc roofs", "Architect-drawn metalwork", "Full re-roofs on period homes"],
    avoidedJobs: ["Insurance-only hail chasing", "Roof painting", "Anything requiring asbestos removal"],
  },
  competitors: [
    { name: "Three metro roofing contractors", reference: "competitor-a", note: "All lead with price and speed; none show a folded detail." },
  ],
  brandReality: "MINIMAL",
  trustStrategy: "WORK_EVIDENCE_LED",
});

export const clientIntake = Object.freeze({
  schemaVersion: 1,
  kind: "CLIENT_INTAKE",
  clientId: "northgate-roofing",
  collectedOn: "2026-08-08",
  businessName: "Northgate Roofing & Metal",
  tagline: "Roofing and architectural metal, Melbourne's inner north",
  story:
    "Northgate started in 2009 as two roof plumbers working out of a van in Preston. The metalwork came later, when an architect asked for a folded screen nobody else would quote, and it is now about a third of what the business does. There are eleven people, one workshop, and a rule that nothing leaves the shop that has not been fitted to a real measurement.",
  services: SERVICES,
  serviceGroups: SERVICE_GROUPS,
  serviceAreas: ["Melbourne's inner north", "Northcote", "Preston", "Thornbury", "Coburg", "Brunswick", "Strathmore", "Heidelberg"],
  process: [
    { title: "We get on the roof", description: "Nothing is quoted from the ground or from a photograph. We inspect, and we photograph what we find." },
    { title: "Written quote against a fixed scope", description: "You get the scope, the exclusions and the price in writing. Variations are agreed before they happen." },
    { title: "The work", description: "One crew, one job, start to finish. We do not leave a roof open overnight." },
    { title: "Hand over", description: "Site swept, gutters cleared, and photographs of the finished work sent through." },
  ],
  credentials: [
    { label: "Roof plumbing licence", evidence: "SIGHTED", approvedWording: "Licensed roof plumbers (VIC licence sighted by Proportion, August 2026)" },
    { label: "Public liability insurance", evidence: "SIGHTED", approvedWording: "$20 million public liability cover, certificate current" },
    { label: "Manufacturer accreditation", evidence: "STATED", approvedWording: "Accredited installers for the standing seam system we use" },
  ],
  projects: ALL_PROJECTS.map((project) => ({
    projectId: project.projectId,
    title: project.title,
    summary: project.summary,
    serviceIds: project.serviceIds,
    locationLabel: project.suburb,
    completedYear: project.year,
    featured: project.featured === true,
    ...(project.brief === undefined ? {} : { brief: project.brief }),
    ...(project.approach === undefined ? {} : { approach: project.approach }),
    ...(project.outcome === undefined ? {} : { outcome: project.outcome }),
  })),
  faqs: [
    { question: "Do you work outside the inner north?", answer: "For metalwork, yes, anywhere in metropolitan Melbourne. For roofing we stay within about fifteen kilometres of the workshop so we can get back quickly if something needs attention." },
    { question: "Can you match an existing tile or profile?", answer: "Usually. Bring us one and we will tell you honestly whether it can be matched or only approximated." },
    { question: "Do you do asbestos?", answer: "No. It is a licensed trade we do not hold, and we will refer you to someone who does." },
    { question: "How long does a re-roof take?", answer: "A single-storey house is typically three to five days. We do not leave a roof open overnight at any point." },
  ],
  commercial: [
    { label: "Quotes", value: "Free and in writing, after an on-roof inspection" },
    { label: "Payment", value: "Deposit on booking, balance on completion. No progress claims on residential work under $30,000." },
  ],
  contact: {
    enquiryEmail: "office@northgate-roofing.example.com.au",
    phone: "+61394450000",
    quoteModel: "SITE_VISIT_THEN_QUOTE",
    emergencyAvailable: true,
  },
  team: [
    { name: "Marek Sowinski", role: "Director and roof plumber" },
    { name: "Dana Okafor", role: "Office manager" },
  ],
});

export const mediaInventory = Object.freeze({
  schemaVersion: 1,
  kind: "MEDIA_INVENTORY",
  clientId: "northgate-roofing",
  receivedOn: "2026-08-11",
  assets: MEDIA_ASSETS,
});

export const creativeConfiguration = Object.freeze({
  schemaVersion: 1,
  kind: "CREATIVE_CONFIGURATION",
  clientId: "northgate-roofing",
  derivedOn: "2026-08-12",
  derivedBy: "Founder",
  perceptionTargets: ["Precise", "Straight-talking", "The people other trades call"],
  antiTargets: ["Cheap and fast", "A franchise", "Salesy"],
  brandConstraints: { hasExistingBrand: false, lockedColours: [], lockedTypefaces: [] },
  palette: {
    direction: "Steel and oxide against a cool paper ground. Nothing decorative competes with a folded edge.",
    accentColor: "#9a3b1f",
    accentContrastColor: "#ffffff",
    surfaceColor: "#ffffff",
    textColor: "#16191c",
  },
  ground: "COOL_STONE",
  typography: {
    character: "Plain and structural. Set like a specification, read like a person talking.",
    displayFamily: "GROTESQUE_SANS",
    textFamily: "HUMANIST_SANS",
  },
  density: "MEASURED",
  imageTreatment: "BALANCED",
  temperament: "Direct and unhurried. The site should read like the business answering the phone properly.",
  motionAppetite: "ENTRANCE",
  proofEmphasis: "WORK",
  signatureOpportunity: {
    present: true,
    material: "Folded sheet-metal sections from the workshop's own setting-out drawings.",
    note: "Only if the parity slice proves the metalwork photography can carry it. Not committed.",
  },
  clientApproval: {
    approved: true,
    approvedBy: "Marek Sowinski",
    approvedOn: "2026-08-14",
    scope: "REPRESENTATION_AND_DIRECTION",
  },
});

export const deliveryPackage = Object.freeze({
  saleHandoff,
  businessRead,
  clientIntake,
  mediaInventory,
  creativeConfiguration,
});
