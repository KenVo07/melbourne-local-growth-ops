"use client";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...arguments_: unknown[]) => void;
  }
}

export function emitManagedAnalyticsEvent(eventName: string): void {
  if (typeof window === "undefined" || window.gtag === undefined) {
    return;
  }
  window.gtag("event", eventName);
}
