// Canonical date formatting for the WHOLE portal. One display format: DD/MM/YYYY.
//
// Every date shown to a user should go through here so the portal never mixes
// "12 Jul 2026" and "12/07/2026". Date-only values ("YYYY-MM-DD") are parsed as
// LOCAL calendar dates (so IST never rolls them back a day); full timestamps are
// parsed normally and shown in the viewer's local time.

type DateInput = string | Date | null | undefined;

function parseLocal(v: DateInput): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** "05/07/2026" — the one portal-wide date format. "—" when empty/invalid. */
export function fmtDate(v: DateInput): string {
  const d = parseLocal(v);
  if (!d) return "—";
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "05/07/2026, 5:52 am" — date (DD/MM/YYYY) + local time. */
export function fmtDateTime(v: DateInput): string {
  const d = parseLocal(v);
  if (!d) return "—";
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${fmtDate(d)}, ${time}`;
}
