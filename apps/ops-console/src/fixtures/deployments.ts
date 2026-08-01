import { DeploymentRecord, DeploymentRecordSchema } from "@melbourne-local-growth-ops/contracts";

const rawDeployments = [
  {
    schemaVersion: 1,
    deploymentId: "dpl_prod_001",
    clientId: "cli_12345",
    websiteConfigurationId: "wcf_prod_001",
    deliveryMode: "MANAGED_ISOLATED",
    operationalOwner: "AGENCY",
    hostingAccountOwner: "AGENCY",
    sourceRepositoryOwner: "AGENCY",
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: true,
    secretReferences: [
      {
        secretReferenceId: "sec_gh_token",
        owner: "AGENCY"
      }
    ]
  },
  {
    schemaVersion: 1,
    deploymentId: "dpl_test_002",
    clientId: "cli_67890",
    websiteConfigurationId: "wcf_test_002",
    deliveryMode: "CLIENT_HANDOFF",
    operationalOwner: "CLIENT",
    hostingAccountOwner: "CLIENT",
    sourceRepositoryOwner: "CLIENT",
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: false,
    secretReferences: [],
    handoff: {
      status: "COMPLETED",
      targetOwner: "CLIENT",
      completedAt: "2026-01-15T10:00:00Z"
    }
  },
  {
    schemaVersion: 1,
    deploymentId: "dpl_fail_003",
    clientId: "cli_11111",
    websiteConfigurationId: "wcf_fail_003",
    deliveryMode: "MANAGED_ISOLATED",
    operationalOwner: "AGENCY",
    hostingAccountOwner: "AGENCY",
    sourceRepositoryOwner: "AGENCY",
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: true,
    secretReferences: []
  },
  {
    schemaVersion: 1,
    deploymentId: "dpl_unk_004",
    clientId: "cli_22222",
    websiteConfigurationId: "wcf_unk_004",
    deliveryMode: "MANAGED_ISOLATED",
    operationalOwner: "AGENCY",
    hostingAccountOwner: "AGENCY",
    sourceRepositoryOwner: "AGENCY",
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: true,
    secretReferences: []
  }
];

// Validate at load time
export const deploymentFixtures: DeploymentRecord[] = rawDeployments.map(d => DeploymentRecordSchema.parse(d));
