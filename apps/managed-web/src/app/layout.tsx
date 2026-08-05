import type { Metadata } from "next";
import type { ReactNode } from "react";

import { composeCurrentManagedWebsite } from "../managed-website";
import { buildManagedWebsiteMetadata } from "../structured-data";
import "./globals.css";

export function generateMetadata(): Metadata {
  return buildManagedWebsiteMetadata(composeCurrentManagedWebsite());
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
