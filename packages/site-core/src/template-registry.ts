import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
  WebsiteTemplateAssetContext,
} from "./index.js";

/**
 * An exact, deployment-safe reference to one registered template version.
 * IDs and versions are opaque and case-sensitive; no implicit latest version
 * is selected.
 */
export interface WebsiteTemplateReference {
  readonly templateId: string;
  readonly templateVersion: string;
}

export type WebsiteTemplatePipelineErrorCode =
  | "DUPLICATE_TEMPLATE_REGISTRATION"
  | "UNKNOWN_TEMPLATE"
  | "UNSUPPORTED_TEMPLATE_VERSION"
  | "TEMPLATE_PROVENANCE_MISMATCH";

/**
 * Stable operational failures raised by template registration, resolution, or
 * provenance verification. Configuration validation failures continue to use
 * the shared ValidationResult contract.
 */
export class WebsiteTemplatePipelineError extends Error {
  override readonly name = "WebsiteTemplatePipelineError";
  readonly code: WebsiteTemplatePipelineErrorCode;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly availableVersions: readonly string[];
  readonly actualTemplateId: string | undefined;
  readonly actualTemplateVersion: string | undefined;

  constructor(
    code: WebsiteTemplatePipelineErrorCode,
    templateId: string,
    templateVersion: string,
    availableVersions: readonly string[] = [],
    actualTemplateId: string | undefined = undefined,
    actualTemplateVersion: string | undefined = undefined,
  ) {
    super(
      pipelineErrorMessage(
        code,
        templateId,
        templateVersion,
        availableVersions,
        actualTemplateId,
        actualTemplateVersion,
      ),
    );
    this.code = code;
    this.templateId = templateId;
    this.templateVersion = templateVersion;
    this.availableVersions = Object.freeze([...availableVersions]);
    this.actualTemplateId = actualTemplateId;
    this.actualTemplateVersion = actualTemplateVersion;
  }
}

/**
 * An immutable registry whose resolution behavior is independent of template
 * registration order.
 */
export interface WebsiteTemplateRegistry {
  readonly registrations: readonly WebsiteTemplateReference[];
  resolve(reference: WebsiteTemplateReference): WebsiteTemplate;
}

interface RegisteredTemplate extends WebsiteTemplateReference {
  readonly template: WebsiteTemplate;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareRegisteredTemplates(
  left: RegisteredTemplate,
  right: RegisteredTemplate,
): number {
  return (
    compareText(left.templateId, right.templateId) ||
    compareText(left.templateVersion, right.templateVersion)
  );
}

function registeredTemplate(template: WebsiteTemplate): RegisteredTemplate {
  const templateId = template.templateId;
  const templateVersion = template.version;

  return {
    templateId,
    templateVersion,
    template: Object.freeze({
      templateId,
      version: templateVersion,
      compose(
        configuration: ValidatedWebsiteConfiguration,
        assets?: WebsiteTemplateAssetContext,
      ): WebsiteComposition {
        return template.compose(configuration, assets);
      },
    }),
  };
}

/**
 * Creates a deterministic registry from template definitions. Duplicate exact
 * ID/version pairs fail immediately rather than depending on input order.
 */
export function createWebsiteTemplateRegistry(
  templates: readonly WebsiteTemplate[],
): WebsiteTemplateRegistry {
  const sortedTemplates = templates
    .map(registeredTemplate)
    .sort(compareRegisteredTemplates);
  const templatesById = new Map<string, Map<string, WebsiteTemplate>>();

  for (const registration of sortedTemplates) {
    const versions =
      templatesById.get(registration.templateId) ??
      new Map<string, WebsiteTemplate>();

    if (versions.has(registration.templateVersion)) {
      throw new WebsiteTemplatePipelineError(
        "DUPLICATE_TEMPLATE_REGISTRATION",
        registration.templateId,
        registration.templateVersion,
      );
    }

    versions.set(registration.templateVersion, registration.template);
    templatesById.set(registration.templateId, versions);
  }

  const registrations = Object.freeze(
    sortedTemplates.map(({ templateId, templateVersion }) =>
      Object.freeze({ templateId, templateVersion }),
    ),
  );

  return Object.freeze({
    registrations,
    resolve(reference: WebsiteTemplateReference): WebsiteTemplate {
      const templateId = reference.templateId;
      const templateVersion = reference.templateVersion;
      const versions = templatesById.get(templateId);

      if (versions === undefined) {
        throw new WebsiteTemplatePipelineError(
          "UNKNOWN_TEMPLATE",
          templateId,
          templateVersion,
        );
      }

      const template = versions.get(templateVersion);
      if (template === undefined) {
        throw new WebsiteTemplatePipelineError(
          "UNSUPPORTED_TEMPLATE_VERSION",
          templateId,
          templateVersion,
          [...versions.keys()].sort(compareText),
        );
      }

      return template;
    },
  });
}

export function createTemplateProvenanceMismatchError(
  template: WebsiteTemplate,
  composition: WebsiteComposition,
): WebsiteTemplatePipelineError {
  return new WebsiteTemplatePipelineError(
    "TEMPLATE_PROVENANCE_MISMATCH",
    template.templateId,
    template.version,
    [],
    composition.templateId,
    composition.templateVersion,
  );
}

function pipelineErrorMessage(
  code: WebsiteTemplatePipelineErrorCode,
  templateId: string,
  templateVersion: string,
  availableVersions: readonly string[],
  actualTemplateId: string | undefined,
  actualTemplateVersion: string | undefined,
): string {
  switch (code) {
    case "DUPLICATE_TEMPLATE_REGISTRATION":
      return `Template "${templateId}" version "${templateVersion}" is registered more than once.`;
    case "UNKNOWN_TEMPLATE":
      return `Unknown template "${templateId}".`;
    case "UNSUPPORTED_TEMPLATE_VERSION":
      return `Template "${templateId}" does not support version "${templateVersion}". Available versions: ${availableVersions.join(", ")}.`;
    case "TEMPLATE_PROVENANCE_MISMATCH":
      return `Template "${templateId}" version "${templateVersion}" produced composition provenance "${String(actualTemplateId)}" version "${String(actualTemplateVersion)}".`;
  }
}
