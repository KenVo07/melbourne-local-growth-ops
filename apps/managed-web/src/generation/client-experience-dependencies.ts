import type {
  ClientExperienceDependency,
  ClientExperienceManifest,
} from "@melbourne-local-growth-ops/site-core";

export interface ApprovedClientExperienceDependency {
  readonly name: string;
  readonly version: string;
  readonly licenceReviewed: true;
  readonly runtimeAllowed: true;
}

export type ClientExperienceDependencyMap = Readonly<Record<string, string>>;

/**
 * Projects exact manifest dependencies into the generated client package only
 * after the repository-approved catalogue confirms the same name and version.
 * It never accepts ranges, tags, workspace/file protocols or silent version
 * substitution.
 */
export function resolveClientExperienceDependencies(
  manifest: ClientExperienceManifest,
  approved: readonly ApprovedClientExperienceDependency[],
): ClientExperienceDependencyMap {
  const approvedByName = new Map(approved.map((entry) => [entry.name, entry]));
  const dependencies: Record<string, string> = {};

  for (const dependency of [...manifest.publicDependencies].sort(compareDependency)) {
    const approval = approvedByName.get(dependency.name);
    if (approval === undefined) {
      throw new Error(
        `Client experience dependency "${dependency.name}" has no repository approval.`,
      );
    }
    if (approval.version !== dependency.version) {
      throw new Error(
        `Client experience dependency "${dependency.name}" requires ${dependency.version}, but approval covers ${approval.version}.`,
      );
    }
    assertExactRegistryVersion(dependency);
    dependencies[dependency.name] = dependency.version;
  }

  return Object.freeze(dependencies);
}

function assertExactRegistryVersion(
  dependency: ClientExperienceDependency,
): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dependency.version)) {
    throw new Error(
      `Client experience dependency "${dependency.name}" must use an exact registry version.`,
    );
  }
}

function compareDependency(
  left: ClientExperienceDependency,
  right: ClientExperienceDependency,
): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
