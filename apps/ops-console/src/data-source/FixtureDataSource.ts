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
    // Mock events conforming to ObservabilityEvent
    return [
      {
        schemaVersion: 1,
        eventName: "DEPLOYMENT_STARTED",
        category: "DEPLOYMENT",
        clientId: "cli_12345" as any,
        deploymentId: id as any,
        timestamp: "2026-07-28T10:00:00Z",
        correlationId: "cor_1",
      },
      {
        schemaVersion: 1,
        eventName: "BUILD_COMPLETED",
        category: "BUILD",
        clientId: "cli_12345" as any,
        deploymentId: id as any,
        timestamp: "2026-07-28T10:02:00Z",
        correlationId: "cor_2",
      },
      {
        schemaVersion: 1,
        eventName: "DEPLOYMENT_SUCCESS",
        category: "DEPLOYMENT",
        clientId: "cli_12345" as any,
        deploymentId: id as any,
        timestamp: "2026-07-28T10:05:00Z",
        correlationId: "cor_3",
      },
    ];
  }
}

export const dataSource = new FixtureDataSource();
