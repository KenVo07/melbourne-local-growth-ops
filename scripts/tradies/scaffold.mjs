/**
 * The blank delivery workspace.
 *
 * Four JSON records with every *required* field present and empty, plus a README
 * that says who owns each file and which fields are optional. An operator
 * starting a new client should never have to remember a schema; they should open
 * a file that already asks the questions.
 *
 * The templates are deliberately *invalid* until answered — empty strings and
 * empty required lists — so `tradie check` reports exactly what is unanswered
 * rather than accepting a placeholder as an answer.
 *
 * **Optional fields are omitted rather than emitted empty.** An empty optional
 * string is not "no value", it is a malformed value, and a scaffold that emits
 * one hands the operator an error for a question they legitimately have no
 * answer to. The README names them instead.
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

## Optional fields, omitted from the templates

Add them if the answer exists. Leaving them out is a valid answer; leaving them
in as an empty string is not.

| File | Field | What it is |
|---|---|---|
| \`client-intake.json\` | \`tagline\` | One line under the business name |
| | \`services[].narrative\` | The longer read a service detail route opens with |
| | \`services[].groupId\` | Membership of a declared \`serviceGroups\` entry |
| | \`services[].stages\`, \`commercial\`, \`questions\` | Process, known costs, real questions |
| | \`contact.phone\` | International format only — \`+61390000000\`. A number that would not dial is refused |
| | \`projects[].brief\`, \`approach\`, \`outcome\` | Case-study prose for a job worth writing up |
| | \`projects[].completedYear\`, \`locationLabel\`, \`featured\` | |
| \`media-inventory.json\` | \`assets[].sourceAssetId\` | Required for \`AI_ENHANCED\` and \`AI_RECOMPOSED\` |
| \`sale-handoff.json\` | \`notes\`, \`domain.registrar\` | |

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
    contacts: [{ name: "", role: "", email: "" }],
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
    story: "",
    serviceGroups: [],
    services: [
      {
        serviceId: "",
        title: "",
        summary: "",
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
