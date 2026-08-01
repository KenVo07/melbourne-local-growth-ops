import { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
import { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";

export interface OpsConsoleDataSource {
  listDeployments(): Promise<DeploymentRecord[]>;
  getDeployment(id: string): Promise<DeploymentRecord | null>;
  getDeploymentEvents(id: string): Promise<ObservabilityEvent[]>;
}
