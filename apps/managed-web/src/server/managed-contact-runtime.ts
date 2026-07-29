import type {
  ContactFormOutcome,
  LeadFormModule,
} from "@melbourne-local-growth-ops/contact-form";
import {
  createResendTransport,
  type EmailDeliveryConnector,
  type ResendTransport,
} from "@melbourne-local-growth-ops/resend";

import { composeCurrentManagedWebsite } from "../managed-website";
import type {
  RuntimeLeadFormModule,
  RuntimeWebsiteModule,
} from "../runtime-types";
import {
  createContactSubmissionService,
  type ManagedContactRuntime,
} from "./contact-form-runtime";

export interface ManagedContactRuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly createTransport?: (apiKey: string) => ResendTransport;
  readonly now?: () => number;
}

export function createManagedContactRuntime(
  options: ManagedContactRuntimeOptions = {},
): ManagedContactRuntime {
  const composition = composeCurrentManagedWebsite();
  const leadModules = composition.regions
    .flatMap(({ modules }) => modules)
    .filter(isLeadFormModule)
    .sort((left, right) => compareText(left.moduleId, right.moduleId));
  const bindings = new Map(
    (composition.runtimeSecretBindings ?? []).map((binding) => [
      binding.connectorId,
      binding.environmentVariable,
    ]),
  );
  const environment = options.environment ?? process.env;
  const services = new Map<
    string,
    (input: unknown) => Promise<ContactFormOutcome>
  >();

  return Object.freeze({
    async submit(moduleId: string, input: unknown) {
      const module = leadModules.find((candidate) => candidate.moduleId === moduleId);
      if (module === undefined) return undefined;

      let service = services.get(module.moduleId);
      if (service === undefined) {
        const variable = bindings.get(module.connector.connectorId);
        const credential =
          variable === undefined ? undefined : environment[variable];
        if (credential === undefined || credential.trim() === "") {
          throw new Error("Contact delivery is not configured.");
        }
        const transport =
          options.createTransport?.(credential) ??
          createResendTransport({ ["apiKey"]: credential });
        service = createContactSubmissionService({
          module: module.configuration as unknown as LeadFormModule,
          connector: module.connector as unknown as EmailDeliveryConnector,
          deploymentId: composition.configuration.deploymentId,
          businessName: composition.configuration.display.businessName,
          transport,
          ...(options.now === undefined ? {} : { now: options.now }),
        });
        services.set(module.moduleId, service);
      }

      return service(input);
    },
  });
}

function isLeadFormModule(
  module: RuntimeWebsiteModule,
): module is RuntimeLeadFormModule {
  return (
    module.type === "LEAD_FORM" &&
    module.configuration.type === "LEAD_FORM" &&
    module.connector.type === "EMAIL_DELIVERY"
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
