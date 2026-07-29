"use client";

import type { ReactNode } from "react";

import { emitManagedAnalyticsEvent } from "../analytics/managed-analytics";

export interface TrackedBookingLinkProps {
  readonly children: ReactNode;
  readonly eventName: string;
  readonly href: string;
}

export function TrackedBookingLink({
  children,
  eventName,
  href,
}: TrackedBookingLinkProps) {
  return (
    <a
      className="booking-cta"
      href={href}
      onClick={() => {
        emitManagedAnalyticsEvent(eventName);
      }}
    >
      {children}
    </a>
  );
}
