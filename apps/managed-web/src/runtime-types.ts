export type RuntimeModuleType = "LEAD_FORM" | "BOOKING_CTA" | "ANALYTICS";
export type RuntimeLeadField = "NAME" | "EMAIL" | "PHONE" | "MESSAGE";

export interface RuntimeWebsiteConfiguration {
  readonly configurationId: string;
  readonly configurationVersion: number;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly display: {
    readonly businessName: string;
    readonly tagline?: string | undefined;
  };
}

export interface RuntimeModuleContract {
  readonly analyticsEvents: readonly string[];
  readonly fallback: {
    readonly strategy: "HIDE" | "STATIC" | "ERROR";
    readonly description: string;
  };
}

export interface RuntimeWebsiteModule {
  readonly moduleId: string;
  readonly type: RuntimeModuleType;
  readonly moduleVersion: string;
  readonly configuration: {
    readonly type: RuntimeModuleType;
  };
  readonly connector: {
    readonly type: string;
  };
  readonly contract: RuntimeModuleContract;
}

export interface RuntimeBookingModule extends RuntimeWebsiteModule {
  readonly type: "BOOKING_CTA";
  readonly configuration: {
    readonly schemaVersion: 1;
    readonly moduleId: string;
    readonly connectorId: string;
    readonly type: "BOOKING_CTA";
    readonly label: string;
  };
  readonly connector: {
    readonly type: "BOOKING_LINK";
    readonly bookingUrl: string;
  };
}

export interface RuntimeLeadFormModule extends RuntimeWebsiteModule {
  readonly type: "LEAD_FORM";
  readonly configuration: {
    readonly schemaVersion: 1;
    readonly moduleId: string;
    readonly connectorId: string;
    readonly type: "LEAD_FORM";
    readonly fields: readonly RuntimeLeadField[];
  };
  readonly connector: {
    readonly connectorId: string;
    readonly type: "EMAIL_DELIVERY";
    readonly provider: "RESEND";
    readonly fromAddress: string;
    readonly recipientAddresses: readonly string[];
    readonly secretReferenceId: string;
  };
}

export interface RuntimeAnalyticsModule extends RuntimeWebsiteModule {
  readonly type: "ANALYTICS";
  readonly configuration: {
    readonly schemaVersion: 1;
    readonly moduleId: string;
    readonly connectorId: string;
    readonly type: "ANALYTICS";
  };
  readonly connector: {
    readonly type: "GOOGLE_ANALYTICS_4";
    readonly accountOwner: "CLIENT";
    readonly portability: "CLIENT_OWNED";
    readonly measurementId: string;
  };
}

export interface RuntimeWebsiteImage {
  readonly slotId: string;
  readonly alt: string;
  readonly sizes: string;
  readonly priority: boolean;
  readonly asset: {
    readonly assetId: string;
    readonly mediaType: string;
    readonly publicPath: string;
    readonly width: number;
    readonly height: number;
  };
}

export interface ManagedWebsiteRuntime {
  readonly configuration: RuntimeWebsiteConfiguration;
  readonly provenance: {
    readonly configurationId: string;
    readonly configurationVersion: number;
    readonly template: {
      readonly templateId: string;
      readonly templateVersion: string;
    };
  };
  readonly assets: readonly RuntimeWebsiteImage[];
  readonly regions: readonly {
    readonly regionId: string;
    readonly modules: readonly RuntimeWebsiteModule[];
  }[];
  readonly runtimeSecretBindings?: readonly {
    readonly connectorId: string;
    readonly secretReferenceId: string;
    readonly environmentVariable: string;
  }[];
}

export interface RuntimeModuleReference {
  readonly type: RuntimeModuleType;
  readonly moduleVersion: string;
}
