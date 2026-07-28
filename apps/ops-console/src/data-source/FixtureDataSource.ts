import { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
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

  async getDeploymentEvents(id: string): Promise<any[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    // Mock events
    return [
      { id: "evt_1", type: "DEPLOYMENT_STARTED", timestamp: "2026-07-28T10:00:00Z" },
      { id: "evt_2", type: "BUILD_COMPLETED", timestamp: "2026-07-28T10:02:00Z" },
      { id: "evt_3", type: "DEPLOYMENT_SUCCESS", timestamp: "2026-07-28T10:05:00Z" },
    ];
  }
}

export const dataSource = new FixtureDataSource();
