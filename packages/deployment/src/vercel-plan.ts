import type { DeploymentIntent } from "./deployment-intent.js";
import type {
  VercelHttpOperation,
} from "./vercel-http.js";

export interface VercelPlanOptions {
  readonly teamId?: string;
}

export interface VercelPlannedAction {
  readonly sequence: number;
  readonly operation: VercelHttpOperation;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly mode: "READ" | "WRITE";
  readonly condition: "ALWAYS" | "IF_MISSING";
}

export interface VercelDeploymentPlan {
  readonly schemaVersion: 1;
  readonly providerName: "VERCEL";
  readonly projectIdentity: string;
  readonly projectName: string;
  readonly actions: readonly VercelPlannedAction[];
  readonly externalDnsMutation: false;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized.length === 0 ? "client" : normalized;
}

export function vercelProjectName(intent: DeploymentIntent): string {
  return [
    "mlgo",
    safeSegment(intent.clientId),
    safeSegment(intent.deploymentId),
    stableHash(intent.projectIdentity),
  ].join("-").slice(0, 100);
}

function action(
  sequence: number,
  operation: VercelHttpOperation,
  method: "GET" | "POST",
  path: string,
  mode: "READ" | "WRITE",
  condition: "ALWAYS" | "IF_MISSING",
): VercelPlannedAction {
  return Object.freeze({
    sequence,
    operation,
    method,
    path,
    mode,
    condition,
  });
}

export function planVercelDeployment(
  intent: DeploymentIntent,
  _options: VercelPlanOptions = {},
): VercelDeploymentPlan {
  const projectName = vercelProjectName(intent);
  const actions: VercelPlannedAction[] = [
    action(
      1,
      "GET_PROJECT",
      "GET",
      `/v9/projects/${encodeURIComponent(projectName)}`,
      "READ",
      "ALWAYS",
    ),
    action(
      2,
      "CREATE_PROJECT",
      "POST",
      "/v11/projects",
      "WRITE",
      "IF_MISSING",
    ),
    action(
      3,
      "CREATE_DEPLOYMENT",
      "POST",
      "/v13/deployments",
      "WRITE",
      "ALWAYS",
    ),
    action(
      4,
      "GET_DEPLOYMENT",
      "GET",
      "/v13/deployments/{providerDeploymentId}",
      "READ",
      "ALWAYS",
    ),
  ];

  for (const domain of [...intent.domains].sort((left, right) =>
    left.hostname.localeCompare(right.hostname)
  )) {
    const hostname = encodeURIComponent(domain.hostname);
    actions.push(
      action(
        actions.length + 1,
        "GET_PROJECT_DOMAIN",
        "GET",
        `/v9/projects/{providerProjectId}/domains/${hostname}`,
        "READ",
        "ALWAYS",
      ),
      action(
        actions.length + 2,
        "ADD_PROJECT_DOMAIN",
        "POST",
        "/v10/projects/{providerProjectId}/domains",
        "WRITE",
        "IF_MISSING",
      ),
      action(
        actions.length + 3,
        "GET_PROJECT_DOMAIN",
        "GET",
        `/v9/projects/{providerProjectId}/domains/${hostname}`,
        "READ",
        "ALWAYS",
      ),
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    providerName: "VERCEL",
    projectIdentity: intent.projectIdentity,
    projectName,
    actions: Object.freeze(actions),
    externalDnsMutation: false,
  });
}
