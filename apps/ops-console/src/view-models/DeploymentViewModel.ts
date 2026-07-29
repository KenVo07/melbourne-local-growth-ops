import { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
import type { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";
import { deriveDeploymentHealth, HealthStatus } from "./DeploymentHealth";

export class DeploymentViewModel {
  constructor(private deployment: DeploymentRecord, private events: ObservabilityEvent[] = []) {}

  get id() {
    return this.deployment.deploymentId;
  }

  get clientId() {
    return this.deployment.clientId;
  }

  get deliveryMode() {
    return this.deployment.deliveryMode;
  }

  get isHandoffCompleted() {
    return this.deployment.handoff?.status === "COMPLETED";
  }

  get statusBadge() {
    if (this.isHandoffCompleted) return "Handed Off";
    if (this.deliveryMode === "MANAGED_ISOLATED") return "Active Managed";
    return "Pending Handoff";
  }

  get health(): HealthStatus {
    return deriveDeploymentHealth(this.deployment, this.events);
  }

  get raw() {
    return this.deployment;
  }
}
