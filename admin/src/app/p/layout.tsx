// The customer's proposal pages (/p/<token>, Partner Portal v2) — the WhatsApp
// link preview's title, and kept out of search engines.

import type { ReactNode } from "react";

export const metadata = { title: "Solar proposal", description: "", robots: { index: false, follow: false } };

export default function ProposalLayout({ children }: { children: ReactNode }) {
  return children;
}
