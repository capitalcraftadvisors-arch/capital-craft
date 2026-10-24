"use client";

// A table row's name as a real link: Ctrl / ⌘ / Shift / middle-click opens the
// file in a new tab and keyboard users can Tab + Enter to it; a plain click runs
// the row's own open (which saves scroll + filters for the way back).

import Link from "next/link";
import type { ReactNode } from "react";

export default function RowLink({ href, onOpen, className = "", children }: {
  href: string; onOpen: () => void; className?: string; children: ReactNode;
}) {
  return (
    <Link
      href={href as never}
      prefetch={false}
      className={"hover:underline " + className}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // browser opens a new tab
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </Link>
  );
}
