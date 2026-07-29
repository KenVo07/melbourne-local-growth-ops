import type {
  RuntimeLeadFormModule,
  RuntimeModuleReference,
  RuntimeWebsiteModule,
} from "../runtime-types";
import { LeadForm } from "./LeadForm";
import {
  ManagedWebsiteRenderError,
  type ManagedModuleRenderer,
} from "./module-renderer-registry";

const reference: RuntimeModuleReference = Object.freeze({
  type: "LEAD_FORM",
  moduleVersion: "1.0.0",
});

function renderLeadForm(module: RuntimeWebsiteModule) {
  if (
    module.type !== "LEAD_FORM" ||
    module.configuration.type !== "LEAD_FORM" ||
    module.connector.type !== "EMAIL_DELIVERY"
  ) {
    throw new ManagedWebsiteRenderError({
      code: "INCOMPATIBLE_MODULE_RENDERER",
      reference,
      moduleId: module.moduleId,
    });
  }

  const leadModule = module as RuntimeLeadFormModule;
  return (
    <LeadForm
      analyticsEventName="generate_lead"
      fields={leadModule.configuration.fields}
      moduleId={module.moduleId}
    />
  );
}

export const leadFormRenderer: ManagedModuleRenderer = Object.freeze({
  reference,
  render: renderLeadForm,
});
