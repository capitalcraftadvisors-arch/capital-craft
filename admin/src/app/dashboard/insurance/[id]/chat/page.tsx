"use client";

// Insurance — the chat. "Apply for insurance" opens this instead of the
// 3-step form: the SAME documents, read by the SAME routes, asked one at a time
//   PAN → Aadhaar (front + back) → GST (optional) → geo-tagged plant photo →
//   electricity bill → plant address → final invoice → confirm the amount →
//   review → submit.
// Every answer is saved as it's given (extract / upload / save-fields / save /
// submit routes), so a closed chat resumes: answered steps are shown again from
// the saved application and only what's left is asked. Past documents can be
// replaced (↺) and typed answers edited (✎) in place.

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import GeoOfficeUpload from "@/components/GeoOfficeUpload";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import { fmtRupeesExact } from "@/lib/money";

export default function InsuranceChatPage() {
  return (
    <AuthGuard allow={["approved", "admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type App = Record<string, any>;
type Gps = { lat: number; lng: number; captured_at: string };
type Stage = "pan" | "aadhaar" | "gst" | "plant" | "ebill" | "address" | "invoice" | "amount" | "mismatch" | "review" | "done";
type CardRow = { label: string; value: string | null; field?: "gst_legal_name" | "gst_trade_name" | "gstin" };
type Msg = { id: string; from: "bot" | "user"; stage?: Stage; text?: string; files?: { name: string; thumb: string | null }[]; card?: CardRow[]; redo?: boolean };

const ORDER: Stage[] = ["pan", "aadhaar", "gst", "plant", "ebill", "address", "invoice", "amount", "review"];
const QUESTION: Record<Stage, string> = {
  pan: "Upload the insured person's PAN card.",
  aadhaar: "Now their Aadhaar — front and back.",
  gst: "GST certificate, if they have one.",
  plant: "A geo-tagged photo of the installed plant — taken with location on, or with a GPS-camera stamp.",
  ebill: "Upload the site's electricity bill — I'll read the plant address from it.",
  address: "Plant address — check it and correct it if needed.",
  invoice: "Upload the final invoice — I'll read the amount.",
  amount: "Re-enter the invoice amount to confirm. It becomes the sum insured.",
  mismatch: "",
  review: "Here's everything. Check it, then submit.",
  done: "",
};

const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });
const thumbOf = (f: File) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
const num = (s: string) => { const n = Number(s.replace(/[^\d.]/g, "")); return s.trim() && Number.isFinite(n) ? n : null; };

function panCard(f: Record<string, any>): CardRow[] {
  return [{ label: "PAN", value: f.pan ?? f.pan_number ?? null }, ...(f.name ? [{ label: "Name", value: f.name }] : [])];
}
function aadhaarCard(f: Record<string, any>): CardRow[] {
  return [
    { label: "Name", value: f.name ?? f.aadhaar_name ?? null },
    { label: "Date of birth", value: f.dob ?? f.aadhaar_dob ?? null },
    { label: "Gender", value: f.gender ?? f.aadhaar_gender ?? null },
    { label: "Aadhaar", value: f.aadhaar_masked ?? f.aadhaar_number_masked ?? null },
    { label: "Address", value: f.address ?? f.aadhaar_address ?? null },
  ];
}
function gstCard(f: Record<string, any>): CardRow[] {
  return [
    { label: "Legal name", value: f.legal_name ?? f.gst_legal_name ?? null, field: "gst_legal_name" },
    { label: "Trade name", value: f.trade_name ?? f.gst_trade_name ?? null, field: "gst_trade_name" },
    { label: "GSTIN", value: f.gstin ?? null, field: "gstin" },
  ];
}

function Inner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [editing, setEditing] = useState<Stage | null>(null);
  const [app, setApp] = useState<App>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [ocrAmount, setOcrAmount] = useState<number | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const seq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const uid = () => "m" + ++seq.current;

  const active: Stage | null = editing ?? stage;
  const merge = (p: App) => setApp((a) => ({ ...a, ...p }));

  // ── messages ──
  const bot = (stg: Stage | undefined, text: string, extra: Partial<Msg> = {}): Msg => ({ id: uid(), from: "bot", stage: stg, text, ...extra });
  const user = (stg: Stage, extra: Partial<Msg>): Msg => ({ id: uid(), from: "user", stage: stg, ...extra });
  // A stage's answer (+ read card) — appended, or swapped in place when the
  // stage is being redone (↺ / ✎), right after that stage's question.
  function answer(stg: Stage, list: Msg[]) {
    setMsgs((m) => {
      const q = m.findIndex((x) => x.from === "bot" && x.stage === stg && !x.card);
      if (q < 0) return [...m, ...list];
      const kept = m.filter((x, i) => i <= q || x.stage !== stg);
      return [...kept.slice(0, q + 1), ...list, ...kept.slice(q + 1)];
    });
  }

  // ── load + resume ──
  useEffect(() => {
    void (async () => {
      const [{ data }, epc] = await Promise.all([
        supabase().from("insurance_applications").select("*").eq("id", id).maybeSingle(),
        fetchEpcName().catch(() => ""),
      ]);
      const row = (data ?? {}) as App;
      setApp(row);
      const hello = epc && epc !== "there" ? ` ${epc}` : "";
      const out: Msg[] = [
        bot(undefined, `नमस्ते${hello}! 🙏`),
        bot(undefined, "Let's apply for the solar plant insurance. I'll ask for a few documents and read them for you."),
      ];
      if (row.status && row.status !== "draft") {
        out.push(bot(undefined, `This application${row.insurance_display_id ? ` (${row.insurance_display_id})` : ""} is already submitted — our team is on it.`));
        setMsgs(out); setStage("done"); return;
      }
      // Answered steps, shown again from what's saved.
      const filled: Partial<Record<Stage, boolean>> = {
        pan: !!row.pan_number, aadhaar: !!row.aadhaar_front_path, gst: !!row.gst_path, plant: !!row.plant_photo_path,
        ebill: !!row.ebill_path, address: !!row.plant_address, invoice: !!row.invoice_path, amount: row.invoice_confirmed_amount != null,
      };
      let next: Stage = "review";
      for (const s of ORDER) {
        if (s === "review") break;
        if (!filled[s]) { next = s; break; }
        out.push(bot(s, QUESTION[s]), ...replayOf(s, row));
      }
      if (row.invoice_amount != null) setOcrAmount(Number(row.invoice_amount));
      setMsgs(out);
      ask(next, row.plant_address ?? "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function replayOf(s: Stage, r: App): Msg[] {
    switch (s) {
      case "pan": return [user(s, { files: [{ name: "PAN card", thumb: null }], redo: true }), bot(s, "", { card: panCard(r) })];
      case "aadhaar": return [user(s, { files: [{ name: "Aadhaar front", thumb: null }, { name: "Aadhaar back", thumb: null }], redo: true }), bot(s, "", { card: aadhaarCard(r) })];
      case "gst": return [user(s, { files: [{ name: "GST certificate", thumb: null }], redo: true }), bot(s, "", { card: gstCard(r) })];
      case "plant": return [user(s, { text: "Plant photo · geo-tagged ✓", redo: true })];
      case "ebill": return [user(s, { files: [{ name: "Electricity bill", thumb: null }], redo: true })];
      case "address": return [user(s, { text: r.plant_address, redo: true })];
      case "invoice": return [user(s, { files: [{ name: "Final invoice", thumb: null }], redo: true }), bot(s, `Invoice amount read: ${fmtRupeesExact(r.invoice_amount)}`)];
      case "amount": return [user(s, { text: fmtRupeesExact(r.invoice_confirmed_amount), redo: true })];
      default: return [];
    }
  }

  // Move on to `s` and ask it (the address step opens with the address on file).
  function ask(s: Stage, address = app.plant_address ?? "") {
    setStage(s); setEditing(null); setFiles({}); setError(null);
    setInput(s === "address" ? address : "");
    if (s === "done" || s === "mismatch") return;
    setMsgs((m) => (m.some((x) => x.from === "bot" && x.stage === s && !x.card) ? m : [...m, bot(s, QUESTION[s])]));
  }
  const nextOf = (s: Stage) => ORDER[ORDER.indexOf(s) + 1] ?? "review";
  // A stage finished: back to where we were when redoing it, else onward.
  function finished(s: Stage) {
    if (editing) { setEditing(null); setFiles({}); setError(null); setInput(""); return; }
    // Step boundaries the review queue relies on (same as the form's Save & continue).
    if (s === "gst") void post("save", { step: 1 });
    ask(nextOf(s));
  }

  async function post(route: string, body: Record<string, unknown> | FormData): Promise<Record<string, any> | null> {
    const isForm = body instanceof FormData;
    const res = await fetch(`/api/epc/insurance/${id}/${route}`, {
      method: "POST",
      headers: isForm ? auth() : { ...auth(), "Content-Type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d?.ok) { setError(d?.error || `Something went wrong (HTTP ${res.status}). Try again.`); return null; }
    return d;
  }

  // ── document stages ──
  async function sendDoc(s: "pan" | "aadhaar" | "gst" | "ebill" | "invoice") {
    if (busy) return;
    const need = s === "aadhaar" ? ["front", "back"] : ["file"];
    if (need.some((k) => !files[k])) { setError(s === "aadhaar" ? "Add both the front and the back." : "Add the file first."); return; }
    const fd = new FormData();
    for (const k of need) fd.append(k, files[k]);
    setBusy(true); setError(null);
    const route = { pan: "extract-pan", aadhaar: "extract-aadhaar", gst: "extract-gst", ebill: "extract-ebill", invoice: "extract-invoice" }[s];
    const d = await post(route, fd);
    setBusy(false);
    if (!d) return;
    const sent = user(s, { files: need.map((k) => ({ name: files[k].name, thumb: thumbOf(files[k]) })), redo: true });
    const f = (d.fields ?? {}) as Record<string, any>;
    if (s === "pan") { merge({ pan_number: f.pan ?? null }); answer(s, [sent, bot(s, "", { card: panCard(f) })]); }
    if (s === "aadhaar") {
      merge({ aadhaar_front_path: "x", aadhaar_name: f.name ?? null, aadhaar_dob: f.dob ?? null, aadhaar_number_masked: f.aadhaar_masked ?? null });
      answer(s, [sent, bot(s, "", { card: aadhaarCard(f) })]);
    }
    if (s === "gst") { merge({ gst_path: "x", gst_legal_name: f.legal_name ?? null, gst_trade_name: f.trade_name ?? null, gstin: f.gstin ?? null }); answer(s, [sent, bot(s, "", { card: gstCard(f) })]); }
    if (s === "ebill") {
      const addr = (d.address as string | null) ?? null;
      merge({ ebill_path: "x", ...(addr && !app.plant_address ? { plant_address: addr } : {}) });
      answer(s, [sent]);
      if (!editing && addr && !app.plant_address) { setStage("address"); setMsgs((m) => [...m, bot("address", QUESTION.address)]); setInput(addr); setFiles({}); return; }
    }
    if (s === "invoice") {
      const amt = d.amount == null ? null : Number(d.amount);
      setOcrAmount(amt);
      merge({ invoice_path: "x", invoice_amount: amt });
      answer(s, [sent, bot(s, amt != null ? `Invoice amount read: ${fmtRupeesExact(amt)}` : "I couldn't read the amount — you'll type it next.")]);
    }
    finished(s);
  }

  function skipGst() {
    answer("gst", [user("gst", { text: "Don't have it", redo: true })]);
    finished("gst");
  }

  async function uploadPlant(file: File, gps: Gps): Promise<{ ok: boolean; error?: string }> {
    const fd = new FormData();
    fd.append("file", file); fd.append("kind", "plant"); fd.append("gps", JSON.stringify(gps));
    const res = await fetch(`/api/epc/insurance/${id}/upload`, { method: "POST", headers: auth(), body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d?.ok) return { ok: false, error: d?.error || `Upload failed (HTTP ${res.status}).` };
    merge({ plant_photo_path: "x", plant_photo_gps: gps });
    answer("plant", [user("plant", { text: `Plant photo · 📍 ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`, files: [{ name: file.name, thumb: thumbOf(file) }], redo: true })]);
    finished("plant");
    return { ok: true };
  }

  // ── typed stages ──
  async function sendAddress() {
    const v = input.trim();
    if (!v) { setError("Type the plant address."); return; }
    setBusy(true);
    const d = await post("save-fields", { plant_address: v });
    setBusy(false);
    if (!d) return;
    merge({ plant_address: v });
    answer("address", [user("address", { text: v, redo: true })]);
    finished("address");
  }

  async function confirmAmount(amt: number) {
    setBusy(true);
    const d = await post("save", { step: 2, plant_address: app.plant_address ?? "", invoice_confirmed_amount: amt });
    setBusy(false);
    if (!d) return;
    merge({ invoice_confirmed_amount: amt, sum_insured: amt });
    answer("amount", [user("amount", { text: fmtRupeesExact(amt), redo: true })]);
    setPendingAmount(null);
    if (editing) { setEditing(null); setInput(""); return; } // changed from the review → back to it
    ask("review");
  }
  function reenterAmount() {
    setPendingAmount(null); setInput("");
    if (editing) setEditing("amount"); else setStage("amount");
  }
  function sendAmount() {
    const amt = num(input);
    if (amt == null || amt <= 0) { setError("Type the invoice amount."); return; }
    setError(null);
    // Doesn't match what was read off the invoice → ask once before using it.
    if (ocrAmount != null && Math.round(amt) !== Math.round(ocrAmount)) {
      setPendingAmount(amt);
      answer("amount", [user("amount", { text: fmtRupeesExact(amt) }), bot("amount", `The invoice shows ${fmtRupeesExact(ocrAmount)}. Use ${fmtRupeesExact(amt)} anyway?`)]);
      if (editing) setEditing("mismatch"); else setStage("mismatch");
      return;
    }
    void confirmAmount(amt);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    const d = await post("submit", {});
    setBusy(false);
    if (!d) return;
    setMsgs((m) => [...m, user("review", { text: "Submit application" }),
      bot(undefined, `Submitted ✓ Your insurance application${app.insurance_display_id ? ` (${app.insurance_display_id})` : ""} is with our team. We'll reach out soon.`)]);
    setStage("done");
  }

  // ↺ / ✎ on a past answer: reopen that step in place.
  function redo(s: Stage) {
    if (busy || stage === "done") return;
    setEditing(s); setFiles({}); setError(null);
    setInput(s === "address" ? (app.plant_address ?? "") : s === "amount" ? String(app.invoice_confirmed_amount ?? "") : "");
  }

  async function saveCardField(field: string, value: string) {
    const d = await post("save-fields", { [field]: value });
    if (d) merge({ [field]: value || null });
    return !!d;
  }

  useEffect(() => {
    const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, active]);

  const doneCount = ORDER.filter((s) => s !== "review" && ORDER.indexOf(s) < ORDER.indexOf((stage === "mismatch" ? "amount" : stage) ?? "pan")).length;
  const progress = stage === "done" ? 100 : Math.round((doneCount / (ORDER.length - 1)) * 100);
  const pick = (k: string, f: File | undefined) => { if (f) setFiles((x) => ({ ...x, [k]: f })); };

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg,#f5f8fe 0%,#e9f0fc 100%)" }}>
      <header className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#14235c] text-white flex items-center gap-3 shadow-sm">
        <button onClick={() => router.push("/dashboard")} className="p-1 -ml-1 text-white/80 hover:text-white text-[20px] leading-none" aria-label="Back">←</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/capital-craft-mark.png" alt="" className="w-9 h-9 rounded-full bg-white object-contain p-1 shadow-sm" />
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Capital Craft · Insurance application</div>
          <div className="text-[11.5px] text-white/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#93b4ff]" /> {stage === "done" ? "submitted" : "building the application"}</div>
        </div>
        <span className="text-[11px] text-white/60 tabular-nums">{progress}%</span>
      </header>
      <div className="h-1.5 bg-black/15 shrink-0"><div className="h-1.5 bg-[#5b8def] rounded-r-full transition-all duration-500" style={{ width: progress + "%" }} /></div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4">
        <div className="max-w-xl mx-auto py-4 flex flex-col gap-1.5">
          {msgs.map((m) => m.card
            ? <ReadCard key={m.id} rows={m.card} onSave={saveCardField} />
            : (
              <div key={m.id} className={m.from === "bot" ? "self-start max-w-[88%]" : "self-end max-w-[88%]"}>
                <div className={[
                  "rounded-2xl px-3.5 py-2 text-[14px] shadow-sm whitespace-pre-wrap break-words",
                  m.from === "bot" ? "bg-white rounded-tl-md border border-[#c7d5f0] text-text" : "bg-[#1e3a8a] rounded-tr-md text-white",
                  editing && m.from === "user" && m.stage === editing ? "ring-2 ring-[#93b4ff]" : "",
                ].join(" ")}>
                  {m.text}
                  {m.files && m.files.length > 0 && (
                    <div className={["flex flex-wrap gap-1.5", m.text ? "mt-1.5" : ""].join(" ")}>
                      {m.files.map((f, i) => f.thumb
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img key={i} src={f.thumb} alt="" className="w-11 h-11 rounded-lg object-cover border border-white/30" />
                        : <span key={i} className="text-[12px] px-2 py-1 rounded-md bg-white/15">📎 {f.name}</span>)}
                    </div>
                  )}
                </div>
                {m.from === "user" && m.redo && m.stage && stage !== "done" && (
                  <div className="text-right mt-0.5 pr-1">
                    <button onClick={() => redo(m.stage!)} disabled={busy} className="text-[11px] text-text-muted hover:text-[#1e3a8a] disabled:opacity-40">
                      {m.files ? "↺ Replace" : "✎ Edit"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          {busy && (
            <div className="self-start">
              <div className="rounded-2xl rounded-tl-md bg-white border border-[#c7d5f0] px-4 py-3 shadow-sm flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1e3a8a]/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {error && <div className="self-center text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 my-1">{error}</div>}
          {stage === "review" && !editing && <Summary app={app} />}
          <div className="h-2" />
        </div>
      </div>

      {/* Dock — the controls for the active step */}
      {active && !busy && (
        <div className="shrink-0 max-h-[60vh] overflow-y-auto bg-white/85 backdrop-blur border-t border-line">
          <div className="max-w-xl mx-auto px-3 sm:px-4 py-3">
            {editing && (
              <div className="flex items-center justify-between mb-2 text-[12px]">
                <span className="text-[#1e3a8a] font-semibold">Changing your answer</span>
                <button onClick={() => {
                  // A half-done amount change goes back to the saved amount.
                  if (editing === "mismatch" || editing === "amount") answer("amount", [user("amount", { text: fmtRupeesExact(app.invoice_confirmed_amount), redo: true })]);
                  setEditing(null); setError(null); setFiles({}); setPendingAmount(null);
                }} className="text-text-muted hover:text-text">Cancel</button>
              </div>
            )}

            {(active === "pan" || active === "gst" || active === "ebill" || active === "invoice") && (
              <div className="flex flex-col gap-2">
                <FileSlot label={{ pan: "PAN card", gst: "GST certificate", ebill: "Electricity bill", invoice: "Final invoice" }[active]} file={files.file} onPick={(f) => pick("file", f)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => void sendDoc(active)} disabled={!files.file} className="px-4 py-2 rounded-xl bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-40">Upload &amp; read →</button>
                  {active === "gst" && !editing && <button onClick={skipGst} className="px-3 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-bg-soft">Don&apos;t have it</button>}
                </div>
              </div>
            )}

            {active === "aadhaar" && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <FileSlot label="Aadhaar — front" file={files.front} onPick={(f) => pick("front", f)} />
                  <FileSlot label="Aadhaar — back" file={files.back} onPick={(f) => pick("back", f)} />
                </div>
                <div>
                  <button onClick={() => void sendDoc("aadhaar")} disabled={!files.front || !files.back} className="px-4 py-2 rounded-xl bg-[#1e3a8a] text-white text-[13px] font-semibold hover:bg-[#17307a] disabled:opacity-40">Upload &amp; read →</button>
                </div>
              </div>
            )}

            {active === "plant" && (
              <GeoOfficeUpload
                key={editing ? "plant-redo" : "plant"}
                category="insurance_plant_photo"
                label=""
                uploadOnly
                compact
                uploadFn={uploadPlant}
              />
            )}

            {(active === "address" || active === "amount") && (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center border border-line rounded-full bg-white overflow-hidden focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15">
                  <input
                    autoFocus value={input}
                    inputMode={active === "amount" ? "decimal" : "text"}
                    onChange={(e) => setInput(active === "amount" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (active === "address" ? void sendAddress() : sendAmount()); }}
                    placeholder={active === "address" ? "Where the plant is installed" : "Amount in ₹"}
                    className="flex-1 min-w-0 px-4 py-2.5 text-[14px] bg-transparent focus:outline-none" />
                </div>
                <button onClick={() => (active === "address" ? void sendAddress() : sendAmount())} className="w-11 h-11 shrink-0 rounded-full bg-[#1e3a8a] text-white grid place-items-center hover:bg-[#17307a] shadow-sm" aria-label="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                </button>
              </div>
            )}

            {active === "mismatch" && pendingAmount != null && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void confirmAmount(pendingAmount)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a]">Use {fmtRupeesExact(pendingAmount)}</button>
                <button onClick={reenterAmount} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">Re-enter</button>
              </div>
            )}

            {active === "review" && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void submit()} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a]">Submit application</button>
                <button onClick={() => router.push("/dashboard")} className="px-4 py-2.5 rounded-xl border border-line text-[14px] text-text-mid hover:bg-bg-soft">Later</button>
              </div>
            )}

            {active === "done" && (
              <button onClick={() => router.push("/dashboard")} className="w-full px-4 py-2.5 rounded-xl bg-[#1e3a8a] text-white text-[14px] font-semibold hover:bg-[#17307a]">Back to dashboard</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// One file slot in the dock — tap to pick (photo or PDF); shows the picked file.
function FileSlot({ label, file, onPick }: { label: string; file?: File; onPick: (f: File | undefined) => void }) {
  return (
    <label className={["flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 cursor-pointer transition",
      file ? "border-[#bfe3cf] bg-[#f3fbf6]" : "border-dashed border-[#9db4e6] bg-white hover:bg-[#f4f7fd]"].join(" ")}>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-text">{label}</span>
        <span className="block text-[11.5px] text-text-muted truncate">{file ? file.name : "Photo, scan or PDF"}</span>
      </span>
      <span className={["shrink-0 text-[12px] font-semibold", file ? "text-[#178a5c]" : "text-[#1e3a8a]"].join(" ")}>{file ? "✓ Change" : "+ Add"}</span>
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

// "Read from the document" card; GST fields can be corrected (✎) and are saved.
function ReadCard({ rows, onSave }: { rows: CardRow[]; onSave: (field: string, value: string) => Promise<boolean> }) {
  const [vals, setVals] = useState<Record<string, string | null>>(() => Object.fromEntries(rows.map((r) => [r.label, r.value])));
  const [edit, setEdit] = useState<CardRow | null>(null);
  const [draft, setDraft] = useState("");
  async function save() {
    if (!edit?.field) return;
    if (await onSave(edit.field, draft.trim())) { setVals((v) => ({ ...v, [edit.label]: draft.trim() || null })); setEdit(null); }
  }
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#c7d5f0] bg-white shadow-sm overflow-hidden">
      <div className="px-3.5 py-2 bg-[#edf2fb] border-b border-[#dbe4f5] text-[12.5px] font-semibold text-[#14235c]">📄 Read from the document</div>
      <div className="p-3.5 flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-[13px] min-h-[24px]">
            <span className="text-text-muted shrink-0">{r.label}</span>
            {edit?.label === r.label ? (
              <span className="flex items-center gap-1.5">
                <input autoFocus value={draft} onChange={(e) => setDraft(r.field === "gstin" ? e.target.value.toUpperCase() : e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEdit(null); }}
                  className="border border-[#1e3a8a] rounded-lg px-2.5 py-1 text-[13px] w-44 text-right outline-none" />
                <button onClick={() => void save()} className="text-[#1e3a8a] text-[12px] font-semibold">Save</button>
              </span>
            ) : (
              <span className="flex items-center gap-2 min-w-0">
                {vals[r.label] ? <span className="text-text font-medium text-right break-words">{vals[r.label]}</span> : <span className="text-amber-600 text-[12px] italic">not found</span>}
                {r.field && <button onClick={() => { setEdit(r); setDraft(vals[r.label] ?? ""); }} className="opacity-60 hover:opacity-100 text-[#1e3a8a] text-[11px] shrink-0" aria-label="Edit">✎</button>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Review card before submitting — what goes to Capital Craft.
function Summary({ app }: { app: App }) {
  const Row = ({ k, v }: { k: string; v: unknown }) => (
    <div className="flex justify-between gap-3 text-[13px] py-1">
      <span className="text-text-muted shrink-0">{k}</span>
      <span className="text-right font-medium text-text min-w-0 break-words">{v ? String(v) : "—"}</span>
    </div>
  );
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl rounded-tl-md border border-[#c7d5f0] bg-white shadow-sm overflow-hidden">
      <div className="px-3.5 py-2 bg-[#edf2fb] border-b border-[#dbe4f5] text-[12.5px] font-semibold text-[#14235c]">Summary</div>
      <div className="p-3.5">
        <Row k="PAN" v={app.pan_number} />
        <Row k="Aadhaar name" v={app.aadhaar_name} />
        <Row k="Aadhaar" v={app.aadhaar_number_masked} />
        <Row k="Date of birth" v={app.aadhaar_dob} />
        <Row k="GST" v={app.gst_path ? (app.gstin || "Uploaded") : null} />
        <div className="h-px bg-line my-1.5" />
        <Row k="Plant address" v={app.plant_address} />
        <Row k="Plant photo" v={app.plant_photo_path ? "Geo-tagged ✓" : null} />
        <Row k="Final invoice" v={app.invoice_confirmed_amount != null ? fmtRupeesExact(app.invoice_confirmed_amount) : null} />
        <Row k="Sum insured" v={app.invoice_confirmed_amount != null ? fmtRupeesExact(app.sum_insured ?? app.invoice_confirmed_amount) : null} />
      </div>
    </div>
  );
}
