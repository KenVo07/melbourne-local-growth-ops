import { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
import { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";
import { OpsConsoleDataSource } from "./OpsConsoleDataSource";
import { deploymentFixtures } from "../fixtures/deployments";

export class FixtureDataSource implements OpsConsoleDataSource {
  async listDeployments(): Promise<DeploymentRecord[]> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return deploymentFixtures;
  }

  async getDeployment(id: string): Promise<DeploymentRecord | null> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const deployment = deploymentFixtures.find(d => d.deploymentId === id);
    return deployment || null;
  }

  async getDeploymentEvents(id: string): Promise<ObservabilityEvent[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (id === "dpl_unk_004") {
      return [];
    }

    const baseEvent = {
      schemaVersion: 1 as const,
      clientId: "cli_12345" as any,
      deploymentId: id as any,
    };

    if (id === "dpl_fail_003") {
      return [
        { ...baseEvent, eventName: "DEPLOYMENT_STARTED", category: "DEPLOYMENT", timestamp: "2026-07-28T10:00:00Z", correlationId: "cor_1" },
        { ...baseEvent, eventName: "DEPLOYMENT_FAILED", category: "DEPLOYMENT", timestamp: "2026-07-28T10:05:00Z", correlationId: "cor_2", errorCategory: "PROVIDER" },
      ];
    }

    if (id === "dpl_test_002") {
      return [
        { ...baseEvent, eventName: "DEPLOYMENT_STARTED", category: "DEPLOYMENT", timestamp: "2026-07-28T10:00:00Z", correlationId: "cor_1" },
        { ...baseEvent, eventName: "DEPLOYMENT_FAILED", category: "DEPLOYMENT", timestamp: "2026-07-28T10:05:00Z", correlationId: "cor_2", errorCategory: "TIMEOUT" },
        { ...baseEvent, eventName: "DEPLOYMENT_RETRY", category: "DEPLOYMENT", timestamp: "2026-07-28T10:10:00Z", correlationId: "cor_3" },
        { ...baseEvent, eventName: "DEPLOYMENT_SUCCESS", category: "DEPLOYMENT", timestamp: "2026-07-28T10:15:00Z", correlationId: "cor_3" },
      ];
    }

    // Default healthy for dpl_prod_001
    return [
      { ...baseEvent, eventName: "DEPLOYMENT_STARTED", category: "DEPLOYMENT", timestamp: "2026-07-28T10:00:00Z", correlationId: "cor_1" },
      { ...baseEvent, eventName: "BUILD_COMPLETED", category: "BUILD", timestamp: "2026-07-28T10:02:00Z", correlationId: "cor_2" },
      { ...baseEvent, eventName: "DEPLOYMENT_SUCCESS", category: "DEPLOYMENT", timestamp: "2026-07-28T10:05:00Z", correlationId: "cor_3" },
    ];
  }
}

export const dataSource = new FixtureDataSource();
