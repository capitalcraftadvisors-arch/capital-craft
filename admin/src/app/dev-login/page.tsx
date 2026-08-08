"use client";

// LOCAL DEV ONLY — visit /dev-login to sign in as admin against the local stack
// (calls /api/dev-login, which is itself guarded to localhost). Clears any stale
// session first so a leftover production token can't shadow it.

import { useEffect, useState } from "react";

export default function DevLogin() {
  const [msg, setMsg] = useState("Signing in to the local stack…");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/dev-login", { cache: "no-store" });
        const d = await r.json();
        if (!d.ok) {
          setMsg("dev-login failed: " + (d.error || `HTTP ${r.status}`));
          return;
        }
        localStorage.clear();
        localStorage.setItem("cc_token", d.token);
        localStorage.setItem("cc_business", JSON.stringify(d.business));
        setMsg("Signed in as " + (d.business?.contact_name || "admin") + " — redirecting…");
        window.location.href = "/admin";
      } catch (e) {
        setMsg("dev-login error: " + (e as Error).message);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", color: "#0f3d2e" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Local dev login</h1>
      <p style={{ marginTop: 8 }}>{msg}</p>
    </div>
  );
}
