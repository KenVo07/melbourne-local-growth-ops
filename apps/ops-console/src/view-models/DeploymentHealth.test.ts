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

  describe("defensive scoping rules", () => {
    it("ignores events from another client", () => {
      const events: ObservabilityEvent[] = [
        {
          schemaVersion: 1,
          eventName: "DeploymentFailed",
          category: "DEPLOYMENT",
          clientId: "cli_999" as any, // Different client
          deploymentId: "dep_123" as any,
          timestamp: "2026-07-29T10:00:00Z",
          correlationId: "corr_1",
          errorCategory: "PROVIDER",
        },
      ];
      expect(deriveDeploymentHealth(mockDeployment, events)).toBe("unknown");
    });

    it("ignores events from another deployment", () => {
      const events: ObservabilityEvent[] = [
        {
          schemaVersion: 1,
          eventName: "DeploymentFailed",
          category: "DEPLOYMENT",
          clientId: "cli_123" as any,
          deploymentId: "dep_999" as any, // Different deployment
          timestamp: "2026-07-29T10:00:00Z",
          correlationId: "corr_1",
          errorCategory: "PROVIDER",
        },
      ];
      expect(deriveDeploymentHealth(mockDeployment, events)).toBe("unknown");
    });

    it("uses only matching events from a mixed list", () => {
      const events: ObservabilityEvent[] = [
        {
          schemaVersion: 1,
          eventName: "DeploymentFailed",
          category: "DEPLOYMENT",
          clientId: "cli_999" as any,
          deploymentId: "dep_123" as any,
          timestamp: "2026-07-29T10:00:00Z",
          correlationId: "corr_1",
          errorCategory: "PROVIDER",
        },
        {
          schemaVersion: 1,
          eventName: "DeploymentCompleted",
          category: "DEPLOYMENT",
          clientId: "cli_123" as any,
          deploymentId: "dep_123" as any,
          timestamp: "2026-07-29T10:05:00Z",
          correlationId: "corr_2",
        },
      ];
      // Only the completed event matches, so it's healthy, not failed
      expect(deriveDeploymentHealth(mockDeployment, events)).toBe("healthy");
    });

    it("evaluates the latest-five-event boundary correctly", () => {
      const generateEvent = (i: number, isError: boolean): ObservabilityEvent => ({
        schemaVersion: 1,
        eventName: isError ? "DeploymentFailed" : "DeploymentStep",
        category: "DEPLOYMENT",
        clientId: "cli_123" as any,
        deploymentId: "dep_123" as any,
        timestamp: `2026-07-29T10:0${i}:00Z`,
        correlationId: `corr_${i}`,
        ...(isError ? { errorCategory: "PROVIDER" } : {}),
      });

      // 1 error (at index 5 when newest is 0) means it falls outside the 1..4 range (slice(1, 5))
      // Wait, slice(1, 5) takes index 1, 2, 3, 4. So 4 events prior to the latest.
      // If error is at index 5 (6th newest event), it's healthy.
      const eventsOutside = [
        generateEvent(6, false), // newest
        generateEvent(5, false),
        generateEvent(4, false),
        generateEvent(3, false),
        generateEvent(2, false),
        generateEvent(1, true),  // 6th newest, outside slice
      ];
      expect(deriveDeploymentHealth(mockDeployment, eventsOutside)).toBe("healthy");

      const eventsInside = [
        generateEvent(6, false), // newest
        generateEvent(5, false),
        generateEvent(4, false),
        generateEvent(3, false),
        generateEvent(2, true),  // 5th newest (index 4 in sorted), inside slice
        generateEvent(1, false),
      ];
      expect(deriveDeploymentHealth(mockDeployment, eventsInside)).toBe("degraded");
    });
  });
});
