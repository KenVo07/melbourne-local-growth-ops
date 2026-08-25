/**
 * The blank delivery workspace.
 *
 * Five JSON records with every field present and every value empty, plus a
 * README that says who owns each file. An operator starting a new client should
 * never have to remember a schema; they should open a file that already asks
 * the questions.
 *
 * The templates are deliberately *invalid* until answered — empty strings and
 * empty required lists — so `tradie check` reports exactly what is unanswered
 * rather than accepting a placeholder as an answer.
 */

export function scaffoldWorkspace(clientId, businessName) {
  return [
    { path: "README.md", contents: readme(clientId, businessName) },
    { path: "sale-handoff.json", contents: json(saleHandoff(clientId, businessName)) },
    { path: "business-read.json", contents: json(businessRead(clientId)) },
    { path: "client-intake.json", contents: json(clientIntake(clientId, businessName)) },
    { path: "media-inventory.json", contents: json(mediaInventory(clientId)) },
  ];
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(clientId, businessName) {
  return `# ${businessName} — delivery workspace

Client ID: \`${clientId}\`

Five records. **Who fills each one is the point of the split**, and it is what
keeps the client from being asked to act as their own designer.

| File | Who answers it | When |
|---|---|---|
| \`sale-handoff.json\` | The person who closed the sale | Immediately, before anything is asked of the client |
| \`business-read.json\` | Proportion, from public sources | Before the client is asked for anything |
| \`client-intake.json\` | The client, factual questions only | After the business read |
| \`media-inventory.json\` | The client sends; **Proportion audits** | After the intake |
| \`creative-configuration.json\` | Proportion derives; the client approves | \`tradie recommend\` writes the draft |

## The client is never asked

- which photographs are good;
- what colours, typefaces or layout they want;
- what their information architecture should be;
- to write marketing copy.

They are asked factual questions about their business, for everything they
already have, and to approve how they are represented.

## Commands

    pnpm tradie check     --workspace <this directory>
    pnpm tradie recommend --workspace <this directory>
    pnpm tradie shotlist  --workspace <this directory>
    pnpm tradie compose   --workspace <this directory>
    pnpm tradie p1        --workspace <this directory>

\`check\` is safe to run at any point and is the one to run when you are not sure
what to do next: it reports every gap with the person who has to close it.
`;
}

function saleHandoff(clientId, businessName) {
  return {
    schemaVersion: 1,
    kind: "SALE_HANDOFF",
    clientId,
    businessName,
    trade: "",
    tier: "",
    soldOn: "",
    soldBy: "",
    approvalAuthority: { name: "", role: "", email: "" },
    contacts: [{ name: "", role: "", email: "", phone: "" }],
    includedPages: ["HOME", "SERVICES_INDEX", "SERVICE_DETAIL", "ABOUT", "CONTACT"],
    includedCapabilities: ["CONTACT_FORM"],
    exclusions: [],
    /*
     * Required and often empty. An empty list is a positive statement that
     * nothing extra was promised in the sales conversation, and it is only a
     * statement because the field had to be filled in.
     */
    commitments: [],
    deadline: null,
    currentSite: null,
    domain: { name: "", registrar: "", controlledBy: "UNKNOWN" },
    notes: "",
  };
}

function businessRead(clientId) {
  return {
    schemaVersion: 1,
    kind: "BUSINESS_READ",
    clientId,
    readOn: "",
    readBy: "",
    sources: [
      { sourceId: "current-site", kind: "EXISTING_WEBSITE", reference: "", observedOn: "" },
    ],
    observations: [
      {
        observationId: "",
        sourceId: "current-site",
        statement: "",
        classification: "VERIFIED_PUBLIC_FACT",
      },
    ],
    positioning: {
      desiredPerception: [],
      antiPerception: [],
      targetCustomer: "",
      desiredJobs: [],
      avoidedJobs: [],
    },
    competitors: [],
    brandReality: "",
    trustStrategy: "",
  };
}

function clientIntake(clientId, businessName) {
  return {
    schemaVersion: 1,
    kind: "CLIENT_INTAKE",
    clientId,
    collectedOn: "",
    businessName,
    tagline: "",
    story: "",
    serviceGroups: [],
    services: [
      {
        serviceId: "",
        title: "",
        summary: "",
        narrative: "",
        featured: false,
        suitedTo: [],
        covers: [],
        excludes: [],
        whenToCall: [],
        customerProvides: [],
        stages: [],
        commercial: [],
        questions: [],
      },
    ],
    serviceAreas: [],
    process: [],
    credentials: [
      { label: "", evidence: "STATED", approvedWording: "" },
    ],
    projects: [],
    faqs: [],
    commercial: [],
    contact: {
      enquiryEmail: "",
      phone: "",
      quoteModel: "SITE_VISIT_THEN_QUOTE",
      emergencyAvailable: false,
    },
    team: [],
  };
}

function mediaInventory(clientId) {
  return {
    schemaVersion: 1,
    kind: "MEDIA_INVENTORY",
    clientId,
    receivedOn: "",
    assets: [
      {
        assetId: "",
        sourcePath: "",
        alt: "",
        mediaType: "image/jpeg",
        subject: "COMPLETED_WORK",
        audit: "SALES_GRADE",
        provenance: "CLIENT_JOB_PHOTOGRAPH",
        lane: "SUPPLIED",
        width: 0,
        height: 0,
        focalPoint: { x: 0.5, y: 0.5 },
        substantiates: { kind: "NONE", reference: null },
        approvedForPublication: false,
      },
    ],
  };
}
