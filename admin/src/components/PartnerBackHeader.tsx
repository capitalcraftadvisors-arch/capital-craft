"use client";

// The partner portal's sub-page bar: "← Back to dashboard".

import { useRouter } from "next/navigation";

export default function PartnerBackHeader() {
  const router = useRouter();
  return (
    <header className="border-b border-line bg-white">
      <div className="max-w-[900px] mx-auto px-5 sm:px-7 h-14 flex items-center">
        <button onClick={() => router.push("/dashboard" as any)} className="text-[13px] text-text-muted hover:text-text inline-flex items-center gap-1">← Back to dashboard</button>
      </div>
    </header>
  );
}
