"use client";

// Overall EPC-partner health for the analytics EPC tab. Self-contained: one lean
// read of epc_business (+ last_login_at) and epc_applications, then everything is
// derived. Rolling 30-day snapshot (independent of the section period). Brand
// green palette, visualization-first. Read-only.

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import Card from "@/components/ui/Card";
import { supabase } from "@/lib/supabase";

const C = { green: "#178a5c", greenDark: "#0f7a52", blue: "#185fa5", teal: "#0f766e", amber: "#d97706", slate: "#64748b", red: "#dc2626", ink: "#0f3d2e" };
const APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);
const DAY = 86400000;
const num = (v: unknown) => Number(v) || 0;
const money = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);

type Epc = { id: string; name: string; created_at: string | null; last_login_at: string | null };
type App = Record<string, any>;

export default function EpcHealthPanel() {
  const [epcs, setEpcs] = useState<Epc[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [logins, setLogins] = useState<{ epc_business_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = supabase();
      const since = new Date(Date.now() - 30 * DAY).toISOString();
      const [e, a, l] = await Promise.all([
        db.from("epc_business").select("id, trade_name, legal_name, contact_name, created_at, last_login_at").neq("business_type", "admin"),
        db.from("epc_applications").select("epc_business_id, status, created_at, first_disbursement_amount, second_disbursement_amount"),
        // Login events (migration 0080). Resilient if the table isn't there yet.
        db.from("epc_login_events").select("epc_business_id").gte("created_at", since),
      ]);
      if (cancelled) return;
      setEpcs(((e.data ?? []) as any[]).map((r) => ({ id: r.id, name: r.trade_name || r.legal_name || r.contact_name || "—", created_at: r.created_at, last_login_at: r.last_login_at })));
      setApps((a.data ?? []) as App[]);
      setLogins((l.data ?? []) as { epc_business_id: string | null }[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const d = useMemo(() => {
    const now = Date.now(); const D30 = now - 30 * DAY;
    const parse = (s: string | null) => (s ? Date.parse(s) : NaN);

    // Per-EPC transaction aggregates (non-draft apps only).
    type Agg = { submitted: number; disbursedCount: number; approved: number; disbursed: number; firstTs: number; lastTs: number };
    const byEpc = new Map<string, Agg>();
    for (const r of apps) {
      if (r.status === "draft" || !r.epc_business_id) continue;
      const t = parse(r.created_at);
      const g = byEpc.get(r.epc_business_id) || { submitted: 0, disbursedCount: 0, approved: 0, disbursed: 0, firstTs: Infinity, lastTs: 0 };
      g.submitted += 1;
      if (!isNaN(t)) { g.firstTs = Math.min(g.firstTs, t); g.lastTs = Math.max(g.lastTs, t); }
      const disb = num(r.first_disbursement_amount) + num(r.second_disbursement_amount);
      g.disbursed += disb;
      if (r.first_disbursement_amount != null) g.disbursedCount += 1;
      if (r.first_disbursement_amount != null || (r.status && APPROVED.has(r.status))) g.approved += 1;
      byEpc.set(r.epc_business_id, g);
    }

    const totalEpcs = epcs.length;
    const activeLogin = epcs.filter((e) => parse(e.last_login_at) >= D30).length;
    const dormant = epcs.filter((e) => { const t = parse(e.last_login_at); return isNaN(t) ? false : t < D30; }).length;
    // Newly activated: EPC's first application within the last 30 days.
    let newlyActivated = 0;
    for (const g of byEpc.values()) if (g.firstTs !== Infinity && g.firstTs >= D30) newlyActivated++;
    const loginRate = totalEpcs ? Math.round((activeLogin / totalEpcs) * 100) : 0;

    // Logins / active EPC — real login COUNT (epc_login_events, migration 0080),
    // scoped to EPC accounts, over the last 30 days.
    const epcIds = new Set(epcs.map((e) => e.id));
    const loginEvents = logins.filter((x) => x.epc_business_id && epcIds.has(x.epc_business_id));
    const totalLogins = loginEvents.length;
    const distinctLoginEpcs = new Set(loginEvents.map((x) => x.epc_business_id)).size;
    const loginsPerActive = distinctLoginEpcs ? totalLogins / distinctLoginEpcs : 0;

    const totalDisbursed = [...byEpc.values()].reduce((s, g) => s + g.disbursed, 0);
    const totalSubmitted = [...byEpc.values()].reduce((s, g) => s + g.submitted, 0);
    const totalDisbCount = [...byEpc.values()].reduce((s, g) => s + g.disbursedCount, 0);
    const disbPerActive = activeLogin ? totalDisbursed / activeLogin : 0;
    const conversion = totalSubmitted ? Math.round((totalDisbCount / totalSubmitted) * 100) : 0;

    // Top 10 by disbursed ₹ (fallback to submitted volume when nothing disbursed).
    const nameOf = new Map(epcs.map((e) => [e.id, e.name]));
    const ranked = [...byEpc.entries()].map(([id, g]) => ({ name: nameOf.get(id) || "—", disbursed: g.disbursed, submitted: g.submitted }));
    const byDisb = ranked.filter((r) => r.disbursed > 0).sort((a, b) => b.disbursed - a.disbursed);
    const top10 = (byDisb.length ? byDisb : ranked.sort((a, b) => b.submitted - a.submitted).map((r) => ({ ...r, disbursed: r.submitted }))).slice(0, 10);

    // Wallet share — top 5 EPCs vs the rest (share of total disbursed).
    const shareBase = byDisb.length ? byDisb : ranked.map((r) => ({ ...r, disbursed: r.submitted }));
    const total = shareBase.reduce((s, r) => s + r.disbursed, 0);
    const PALETTE = [C.green, C.blue, C.teal, C.amber, C.greenDark];
    const top5 = shareBase.slice(0, 5).map((r, i) => ({ name: r.name, value: r.disbursed, color: PALETTE[i] }));
    const othersVal = Math.max(0, total - top5.reduce((s, r) => s + r.value, 0));
    const wallet = othersVal > 0 ? [...top5, { name: "Others", value: othersVal, color: C.slate }] : top5;

    return {
      totalEpcs, activeLogin, newlyActivated, dormant, loginRate, totalLogins, loginsPerActive,
      disbPerActive, conversion, top10, wallet, walletUnit: byDisb.length ? "money" : "count" as "money" | "count",
      top10Unit: byDisb.length ? "money" : "count" as "money" | "count",
    };
  }, [epcs, apps, logins]);

  if (loading) return <p className="text-[13px] text-text-muted">Loading EPC health…</p>;

  const fmt = (v: number, unit: "money" | "count") => (unit === "money" ? money(v) : String(v));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-bold text-text">EPC Health <span className="text-[11px] font-normal text-text-muted">· rolling 30-day snapshot</span></p>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Active EPCs · 30d" value={String(d.activeLogin)} sub={`of ${d.totalEpcs}`} accent={C.green} />
        <Tile label="Newly activated · 30d" value={String(d.newlyActivated)} sub="first application" accent={C.blue} />
        <Tile label="Dormant > 30d" value={String(d.dormant)} sub="no recent login" accent={d.dormant > 0 ? C.amber : C.slate} />
        <Tile label="Logins / active EPC" value={d.totalLogins ? d.loginsPerActive.toFixed(1) : "—"} sub={d.totalLogins ? `${d.loginRate}% logged in · 30d` : "recording just started"} accent={C.teal} />
        <Tile label="Disbursed / active EPC" value={money(d.disbPerActive)} accent={C.greenDark} />
        <Tile label="Conversion rate" value={`${d.conversion}%`} sub="app → disbursed" accent={C.green} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-text mb-3">Top 10 EPC contribution</p>
          {d.top10.length === 0 ? <Empty /> : (
            <div className="space-y-1.5">
              {(() => { const max = Math.max(1, ...d.top10.map((r) => r.disbursed)); return d.top10.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 text-[12px] font-semibold text-text-muted text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[12.5px] mb-0.5">
                      <span className="truncate text-text font-medium">{r.name}</span>
                      <span className="font-semibold text-text shrink-0 ml-2">{fmt(r.disbursed, d.top10Unit)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#eef1f4] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.disbursed / max) * 100}%`, backgroundColor: C.green }} /></div>
                  </div>
                </div>
              )); })()}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-[13px] font-semibold text-text mb-3">EPC wallet share {d.walletUnit === "count" ? "(by volume)" : "(disbursed ₹)"}</p>
          {d.wallet.length === 0 ? <Empty /> : (
            <div className="flex items-center gap-4">
              <div style={{ width: 170, height: 180 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={d.wallet} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                      {d.wallet.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v, d.walletUnit)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {(() => { const tot = d.wallet.reduce((s, e) => s + e.value, 0); return d.wallet.map((e) => (
                  <div key={e.name} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13px] text-text min-w-0"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: e.color }} /><span className="truncate">{e.name}</span></span>
                    <span className="text-[13px] font-semibold text-text shrink-0">{tot ? Math.round((e.value / tot) * 100) : 0}%</span>
                  </div>
                )); })()}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-1 h-3 rounded-full shrink-0" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="text-[18px] font-display font-bold text-text mt-1 leading-none">{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5 truncate">{sub}</div>}
    </Card>
  );
}
function Empty() { return <div className="h-[160px] grid place-items-center text-[12px] text-text-muted border border-dashed border-line rounded-lg">No EPC data yet.</div>; }
