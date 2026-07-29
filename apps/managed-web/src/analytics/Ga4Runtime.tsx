"use client";

import Script from "next/script";

export interface Ga4RuntimeProps {
  readonly measurementId: string;
}

export function Ga4Runtime({ measurementId }: Ga4RuntimeProps) {
  const initialization = ga4Initialization(measurementId);

  return (
    <>
      <Script
        id={`ga4-library-${measurementId}`}
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
      />
      <Script
        id={`ga4-initialization-${measurementId}`}
        strategy="afterInteractive"
      >
        {initialization}
      </Script>
    </>
  );
}

export function ga4Initialization(measurementId: string): string {
  return `
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
window.gtag('js', new Date());
window.gtag('config', ${JSON.stringify(measurementId)}, {send_page_view: false});
window.gtag('event', 'page_view', {
  page_location: window.location.origin + window.location.pathname
});
`;
}
