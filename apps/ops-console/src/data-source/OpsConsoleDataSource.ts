import { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";

export interface OpsConsoleDataSource {
  listDeployments(): Promise<DeploymentRecord[]>;
  getDeployment(id: string): Promise<DeploymentRecord | null>;
  // For event inspector, though we didn't define TechnicalEvent schema in contracts, we can mock a basic one
  getDeploymentEvents(id: string): Promise<any[]>;
}
