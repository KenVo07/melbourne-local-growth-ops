import type { Metadata } from "next";
import type { ReactNode } from "react";

import { composeCurrentManagedWebsite } from "../managed-website";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { configuration } = composeCurrentManagedWebsite();
  const businessName = configuration.display.businessName;
  return {
    title: {
      default: businessName,
      template: `%s | ${businessName}`,
    },
    ...(configuration.display.tagline === undefined
      ? {}
      : { description: configuration.display.tagline }),
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
