export type RuntimeModuleType = "LEAD_FORM" | "BOOKING_CTA" | "ANALYTICS";
export type RuntimeLeadField = "NAME" | "EMAIL" | "PHONE" | "MESSAGE";
export type RuntimeWebsiteProfile = "CONTRACTOR" | "RESTAURANT" | "RETAILER";
export type RuntimeWebsiteArchetype =
  | "SERVICE_LED"
  | "HOSPITALITY_EDITORIAL"
  | "CATALOGUE_LED";

export interface RuntimeWebsiteExperience {
  readonly schemaVersion: 1;
  readonly experienceId: string;
  readonly experienceVersion: string;
  readonly source: "EXPLICIT" | "LEGACY_PROFILE_DEFAULT";
  readonly designDna: {
    readonly palette: {
      readonly accentColor: string;
      readonly accentContrastColor: string;
      readonly surfaceColor: string;
      readonly textColor: string;
    };
    readonly typography: {
      readonly displayFamily: "SANS" | "SERIF";
      readonly bodyFamily: "SANS" | "SERIF";
      readonly displayScale: "COMPACT" | "BALANCED" | "EXPANSIVE";
      readonly tracking: "TIGHT" | "NORMAL" | "OPEN";
    };
    readonly composition: {
      readonly heroLayout: "SPLIT" | "STACKED" | "MEDIA_FIRST";
      readonly navigation: "INLINE" | "COMPACT";
      readonly contentWidth: "STANDARD" | "WIDE";
      readonly sectionRhythm: "COMPACT" | "BALANCED" | "EXPANSIVE";
      readonly surfaceTreatment: "FLAT" | "BANDED" | "CARDS";
      readonly sectionOrder?: readonly string[] | undefined;
      readonly featuredSectionId?: string | undefined;
    };
    readonly media: {
      readonly heroFrame: "EDGE_TO_EDGE" | "CONTAINED" | "INSET";
      readonly heroFit: "COVER" | "CONTAIN";
      readonly galleryFrame: "NATURAL" | "UNIFORM" | "EDITORIAL";
    };
    readonly interaction: {
      readonly actionStyle: "TEXT" | "SOLID" | "OUTLINE";
      readonly motion: "NONE" | "SUBTLE";
    };
  };
  readonly signature?: {
    readonly signatureId: "service-area-proof";
    readonly signatureVersion: "1.0.0";
    readonly placement: "AFTER_HERO" | "BEFORE_SECTIONS" | "BEFORE_FOOTER";
  } | undefined;
}

export interface RuntimeFoundationSearch {
  readonly schemaVersion: 1;
  readonly mode: "OFF" | "AUTO" | "ON";
  readonly enabled: boolean;
  readonly reason:
    | "DEFAULT_OFF"
    | "EXPLICIT_OFF"
    | "EXPLICIT_ON"
    | "AUTO_ENABLED"
    | "AUTO_BELOW_THRESHOLD";
  readonly records: readonly {
    readonly url: string;
    readonly content: string;
    readonly language: "en";
    readonly meta: {
      readonly title: string;
      readonly businessName: string;
      readonly sectionId: string;
      readonly profile: string;
    };
    readonly filters: {
      readonly profile: readonly string[];
      readonly sectionType: readonly string[];
    };
  }[];
}

export interface RuntimeWebsiteBrand {
  readonly eyebrow: string;
  readonly accentColor: string;
  readonly accentContrastColor: string;
  readonly surfaceColor: string;
  readonly textColor: string;
}

export interface RuntimeExternalAction {
  readonly actionId: string;
  readonly kind:
    | "PHONE"
    | "RESERVATION"
    | "ORDERING"
    | "PURCHASE"
    | "DIRECTIONS";
  readonly label: string;
  readonly state: "CONFIGURED" | "NOT_CONFIGURED";
  readonly href?: string | undefined;
  readonly message?: string | undefined;
}

interface RuntimeProfileSectionBase {
  readonly sectionId: string;
  readonly heading: string;
  readonly eyebrow?: string | undefined;
}

interface RuntimeTitledItem {
  readonly title: string;
  readonly description: string;
}

interface RuntimeGalleryItem {
  readonly assetId: string;
  readonly alt: string;
  readonly caption?: string | undefined;
}

interface RuntimeTestimonial {
  readonly quote: string;
  readonly attribution: string;
  readonly disclosure?: string | undefined;
}

interface RuntimeFaqItem {
  readonly question: string;
  readonly answer: string;
}

interface RuntimeMenuItem {
  readonly name: string;
  readonly description?: string | undefined;
  readonly price: string;
  readonly dietary: readonly string[];
}

interface RuntimeMenuCategory {
  readonly name: string;
  readonly description?: string | undefined;
  readonly items: readonly RuntimeMenuItem[];
}

interface RuntimeCatalogueItem {
  readonly name: string;
  readonly description: string;
  readonly price?: string | undefined;
  readonly assetId?: string | undefined;
  readonly purchaseActionId?: string | undefined;
}

interface RuntimePolicy {
  readonly title: string;
  readonly body: string;
}

interface RuntimeLocation {
  readonly name: string;
  readonly addressLines: readonly string[];
  readonly locality: string;
  readonly region: string;
  readonly postalCode: string;
  readonly directionsUrl?: string | undefined;
}

type RuntimeTitledListSection = RuntimeProfileSectionBase & {
  readonly type: "SERVICES" | "PROCESS" | "EVENTS" | "COLLECTIONS";
  readonly items: readonly RuntimeTitledItem[];
};

export type RuntimeProfileSection =
  | RuntimeTitledListSection
  | (RuntimeProfileSectionBase & {
      readonly type: "TRUST_SIGNALS";
      readonly items: readonly string[];
      readonly disclaimer?: string | undefined;
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "GALLERY";
      readonly items: readonly RuntimeGalleryItem[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "TESTIMONIALS";
      readonly items: readonly RuntimeTestimonial[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "FAQ";
      readonly items: readonly RuntimeFaqItem[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "MENU";
      readonly categories: readonly RuntimeMenuCategory[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "HOURS";
      readonly periods: readonly {
        readonly days: string;
        readonly hours: string;
      }[];
      readonly exceptions: readonly string[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "LOCATION";
      readonly location: RuntimeLocation;
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "STORY" | "CONTACT";
      readonly body: string;
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "PRODUCTS";
      readonly items: readonly RuntimeCatalogueItem[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "POLICIES";
      readonly items: readonly RuntimePolicy[];
    })
  | (RuntimeProfileSectionBase & {
      readonly type: "ACTIONS";
      readonly actions: readonly RuntimeExternalAction[];
    });

export interface RuntimeWebsiteProfileContent {
  readonly schemaVersion: 1;
  readonly profile: RuntimeWebsiteProfile;
  readonly archetype: RuntimeWebsiteArchetype;
  readonly brand: RuntimeWebsiteBrand;
  readonly sections: readonly RuntimeProfileSection[];
}

export interface RuntimeWebsiteDomain {
  readonly hostname: string;
  readonly canonical: boolean;
}

export interface RuntimeWebsiteConfiguration {
  readonly configurationId: string;
  readonly configurationVersion: number;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly display: {
    readonly businessName: string;
    readonly tagline?: string | undefined;
  };
  readonly domains: readonly RuntimeWebsiteDomain[];
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
  readonly profile?: RuntimeWebsiteProfileContent | undefined;
  readonly experience?: RuntimeWebsiteExperience | undefined;
  readonly foundationSearch: RuntimeFoundationSearch;
  readonly provenance: {
    readonly configurationId: string;
    readonly configurationVersion: number;
    readonly template: {
      readonly templateId: string;
      readonly templateVersion: string;
    };
    readonly experience?: Readonly<{
      readonly experienceId: string;
      readonly experienceVersion: string;
      readonly source: "EXPLICIT" | "LEGACY_PROFILE_DEFAULT";
    }>;
    readonly foundationSearch: Readonly<{
      readonly mode: "OFF" | "AUTO" | "ON";
      readonly enabled: boolean;
    }>;
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
