// POST /api/cron/followups   (secret key in the x-cron-key header; GET isn't allowed)
//
// The daily follow-up reminder (Partner Portal v2): Cloud Scheduler calls this
// at 09:00 India time. The key is checked in the database (epc_followup_digest,
// migration 0131 — only its hash is stored), which answers one row per person to
// remind: each active staff member with an email gets the open leads they own
// whose follow-up is today or earlier; the company owner gets the leads with no
// owner. One email per person from the Capital Craft Gmail. Only EPCs with the
// new partner portal (epc_portal_v2, 0133). One database request per run.
// Answers: 200 {ok, sent, failed} · 401 bad key · 500
//
// Deploy steps (once, after migration 0131 is applied):
//   1. A random key — keep it only in D:\capital craft\keys\cron-followups-key.txt (never in the repo):
//        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   2. Its SHA-256 (computed locally, so the key itself never goes to the database):
//        node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <KEY>
//      then in the Supabase SQL editor:
//        insert into cron_keys (name, key_hash) values ('followups', '<HASH>')
//        on conflict (name) do update set key_hash = excluded.key_hash, created_at = now();
//   3. The daily job (PowerShell; no retries, so nobody gets the email twice):
//        gcloud scheduler jobs create http cc-followups-daily --location=asia-southeast1 `
//          --schedule="0 9 * * *" --time-zone="Asia/Kolkata" `
//          --uri="https://<app>/api/cron/followups" --http-method=POST `
//          --headers="x-cron-key=<KEY>" --max-retry-attempts=0 --attempt-deadline=180s
//      (<app> = the portal's public host — the email links use the host it is called on.)
//      Run once by hand: gcloud scheduler jobs run cc-followups-daily --location=asia-southeast1

import { NextRequest, NextResponse } from "next/server";
import { err, publicDb } from "@/lib/api";
import { sendMail, mailConfigured } from "@/lib/mailer";
import { publicOrigin } from "@/lib/login-password-server";
import { fmtDateIST } from "@/lib/dates";
import { waTel } from "@/lib/wa-link";
import { EMAIL_RE } from "@/lib/validators";
import { esc } from "@/lib/html";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type DueLead = { name: string; mobile: string | null; follow_up_at: string; overdue: boolean };
type Person = { recipient_name: string | null; email: string; company_name: string | null; leads: DueLead[] | null };


function mail(p: Person, leads: DueLead[], link: string): { subject: string; html: string; text: string } {
  const greet = (p.recipient_name || "").trim() || "there";
  const company = (p.company_name || "").trim();
  const td = "padding:6px 16px 6px 0;border-bottom:1px solid #e6efe9;vertical-align:top";
  const th = "padding:6px 16px 6px 0;border-bottom:1px solid #cdeadd;text-align:left;font-weight:600;color:#5a8a76;white-space:nowrap";
  const rows = leads.map((l) => {
    const ten = waTel(l.mobile);
    const mobile = ten ? `<a href="tel:+91${ten}" style="color:#12271f;text-decoration:none">${ten}</a>` : esc(l.mobile || "—");
    const date = `<span style="${l.overdue ? "color:#dc2626;font-weight:600" : ""}">${fmtDateIST(l.follow_up_at)}</span>`;
    return `<tr><td style="${td};font-weight:600">${esc(l.name || "—")}</td><td style="${td};white-space:nowrap">${mobile}</td><td style="${td};white-space:nowrap">${date}</td></tr>`;
  }).join("");
  const html = `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#12271f;line-height:1.55">
        <p>Namaste ${esc(greet)},</p>
        <p>Your follow-ups for today${company ? ` at <b>${esc(company)}</b>` : ""}:</p>
        <table style="border-collapse:collapse;margin:8px 0 18px;font-size:13px">
          <tr><th style="${th}">Customer</th><th style="${th}">Mobile</th><th style="${th}">Follow-up</th></tr>
          ${rows}
        </table>
        <p><a href="${esc(link)}" style="color:#178a5c;font-weight:600">Open follow-ups</a></p>
        <p style="margin-top:18px">Regards,<br/>Capital Craft Advisors</p>
      </div>`;
  const text = [
    `Namaste ${greet},`, "",
    `Your follow-ups for today${company ? ` at ${company}` : ""}:`,
    ...leads.map((l) => `- ${l.name || "—"} · ${waTel(l.mobile) || l.mobile || "—"} · ${fmtDateIST(l.follow_up_at)}${l.overdue ? " (overdue)" : ""}`),
    "", `Open follow-ups: ${link}`, "", "Regards,", "Capital Craft Advisors",
  ].join("\n");
  return { subject: `Today's follow-ups (${leads.length})`, html, text };
}

export async function POST(req: NextRequest) {
  try {
    const key = (req.headers.get("x-cron-key") ?? "").trim();
    // Keys are 32 random bytes in hex — anything else is refused here, without a
    // database request (each request counts on the Free plan).
    if (!/^[0-9a-f]{64}$/i.test(key)) return err("unauthorized", 401);
    if (!mailConfigured()) return err("Email isn't configured yet (app password missing).", 500);

    const { data, error } = await publicDb().rpc("epc_followup_digest", { p_key: key });
    if (error) {
      if (/invalid_key/.test(error.message)) return err("unauthorized", 401);
      return err("Couldn't read today's follow-ups — " + error.message, 500);
    }

    const link = `${publicOrigin(req)}/dashboard/leads?f=due`;
    let sent = 0, failed = 0;
    for (const p of (data ?? []) as Person[]) {
      const to = String(p.email || "").trim();
      const leads = Array.isArray(p.leads) ? p.leads : [];
      if (!EMAIL_RE.test(to) || !leads.length) continue;
      try {
        await sendMail({ to, ...mail(p, leads, link) });
        sent++;
      } catch (e) {
        failed++;
        console.error("[cron/followups] send failed:", to, errText(e));
      }
    }
    return NextResponse.json({ ok: true, sent, failed });
  } catch (e) {
    const msg = errText(e);
    console.error("[cron/followups] error:", msg);
    return err(msg, 500);
  }
}
