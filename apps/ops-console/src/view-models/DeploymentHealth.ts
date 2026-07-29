import type { DeploymentRecord } from "@melbourne-local-growth-ops/contracts";
import type { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";

export type HealthStatus = "healthy" | "degraded" | "failed" | "unknown";

export function deriveDeploymentHealth(
  deployment: DeploymentRecord,
  events: ObservabilityEvent[]
): HealthStatus {
  if (!events || events.length === 0) {
    return "unknown";
  }

  // Sort events newest first
  const sortedEvents = [...events].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const latestEvent = sortedEvents[0];

  if (latestEvent.errorCategory) {
    return "failed";
  }

  // Check the last 5 events for any errors to determine if degraded
  const recentEvents = sortedEvents.slice(1, 5);
  const hasRecentErrors = recentEvents.some((event) => event.errorCategory);

  if (hasRecentErrors) {
    return "degraded";
  }

  return "healthy";
}
