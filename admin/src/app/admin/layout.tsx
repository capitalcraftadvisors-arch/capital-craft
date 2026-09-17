"use client";

// Admin-area chrome: the ⌘K command palette + toast host. It also bridges every
// legacy window.alert() to a toast, so the whole console gets clean, non-blocking
// notifications without touching each call site. (window.confirm is left alone —
// it must stay blocking and return a boolean.)

import { useEffect } from "react";
import { Toaster, toast } from "sonner";
import CommandPalette from "@/components/CommandPalette";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const orig = window.alert;
    window.alert = (msg?: unknown) => {
      const s = String(msg ?? "");
      if (/fail|error|couldn|could not|can.?t|invalid|denied|wrong|must|not\b/i.test(s)) toast.error(s);
      else toast.success(s);
    };
    return () => { window.alert = orig; };
  }, []);

  return (
    <>
      {children}
      <CommandPalette />
      <Toaster richColors position="top-right" toastOptions={{ style: { fontSize: "13px" } }} />
    </>
  );
}
