"use client";

// Admin-area chrome: the ⌘K command palette. It also bridges every legacy
// window.alert() to a toast, so the whole console gets clean, non-blocking
// notifications without touching each call site: red when the text reads like
// a failure (the regex below), green otherwise. The toasts are drawn by the
// <Toaster/> in the root layout (app/layout.tsx).
// New code: lib/notify (notify.error / .success / .info) instead of alert(),
// lib/confirm (await askConfirm(…)) instead of confirm().

import { useEffect } from "react";
import { toast } from "sonner";
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
    </>
  );
}
