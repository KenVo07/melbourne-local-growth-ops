import { describe, it, expect } from "vitest";
import { deriveDeploymentHealth } from "./DeploymentHealth";
import type { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
import type { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";

describe("deriveDeploymentHealth", () => {
  const mockDeployment: DeploymentRecord = {
    schemaVersion: 1,
    deploymentId: "dep_123" as any,
    clientId: "cli_123" as any,
    websiteConfigurationId: "cfg_123" as any,
    deliveryMode: "MANAGED_ISOLATED",
    operationalOwner: "AGENCY",
    hostingAccountOwner: "AGENCY",
    sourceRepositoryOwner: "AGENCY",
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: true,
    secretReferences: [],
  };

  it("returns unknown when there are no events", () => {
    expect(deriveDeploymentHealth(mockDeployment, [])).toBe("unknown");
  });

  it("returns failed when the most recent event has an error", () => {
    const events: ObservabilityEvent[] = [
      {
        schemaVersion: 1,
        eventName: "DeploymentStarted",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:00:00Z",
        correlationId: "corr_1",
      },
      {
        schemaVersion: 1,
        eventName: "DeploymentFailed",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:05:00Z",
        correlationId: "corr_1",
        errorCategory: "PROVIDER",
      },
    ];

    expect(deriveDeploymentHealth(mockDeployment, events)).toBe("failed");
  });

  it("returns degraded when the most recent event is successful but recent events had errors", () => {
    const events: ObservabilityEvent[] = [
      {
        schemaVersion: 1,
        eventName: "DeploymentFailed",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:00:00Z",
        correlationId: "corr_1",
        errorCategory: "PROVIDER",
      },
      {
        schemaVersion: 1,
        eventName: "DeploymentRecovered",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:10:00Z",
        correlationId: "corr_2",
      },
    ];

    expect(deriveDeploymentHealth(mockDeployment, events)).toBe("degraded");
  });

  it("returns healthy when there are no recent errors", () => {
    const events: ObservabilityEvent[] = [
      {
        schemaVersion: 1,
        eventName: "DeploymentStarted",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:00:00Z",
        correlationId: "corr_1",
      },
      {
        schemaVersion: 1,
        eventName: "DeploymentCompleted",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: "2026-07-29T10:05:00Z",
        correlationId: "corr_1",
      },
    ];

    expect(deriveDeploymentHealth(mockDeployment, events)).toBe("healthy");
  });
});
