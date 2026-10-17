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

/** Local calendar date "YYYY-MM-DD" of a date / timestamp ("" when empty) — the DateField value. */
export function localIsoDate(v: DateInput): string {
  const d = parseLocal(v);
  return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "";
}

/** Timestamp moved to calendar day `iso` ("YYYY-MM-DD"), keeping its local time of day. */
export function withLocalDate(ts: DateInput, iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = parseLocal(ts) ?? new Date(y, m - 1, d);
  return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).toISOString();
}

/** "05/07/2026, 5:52 am" — date (DD/MM/YYYY) + local time. */
export function fmtDateTime(v: DateInput): string {
  const d = parseLocal(v);
  if (!d) return "—";
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${fmtDate(d)}, ${time}`;
}

// ── Date of birth as read by OCR ────────────────────────────────────────────
// OCR returns a DOB "exactly as printed": DD/MM/YYYY (or - . separators),
// DD/MM/YY, ISO YYYY-MM-DD (sometimes with a time), or — on older Aadhaar
// cards — only a year ("Year of Birth: 1965"), often behind a "DOB:" label.
// One parser so every DATE-column writer and the chatbot's age check agree.

/** iso = "YYYY-MM-DD" when a full valid date is known; year is set whenever any year is. */
export type ParsedDob = { iso: string | null; year: number | null };

// Calendar-checked ISO date, or null (rejects 31/02, month 13, absurd years).
function isoOf(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${p2(m)}-${p2(d)}`;
}

// `now` only sets the 2-digit-year pivot (YY above this year's YY → 1900s).
// A full date that fails the calendar check is rejected outright — a garbled
// day/month means the read can't be trusted, so it never degrades to year-only.
function parseDobAt(raw: string | null | undefined, now: Date): ParsedDob | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = /(?:^|\D)(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)/.exec(s);
  if (m) {
    const iso = isoOf(+m[1], +m[2], +m[3]);
    return iso ? { iso, year: +m[1] } : null;
  }
  m = /(?:^|\D)(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y > now.getFullYear() % 100 ? 1900 : 2000;
    const iso = isoOf(y, +m[2], +m[1]);
    return iso ? { iso, year: y } : null;
  }
  m = /(?:^|\D)(19\d{2}|20\d{2})(?!\d)/.exec(s);
  return m ? { iso: null, year: +m[1] } : null;
}

/** Parse an OCR'd DOB; null when nothing usable is in it. */
export function parseDob(raw: string | null | undefined): ParsedDob | null {
  return parseDobAt(raw, new Date());
}

/** "YYYY-MM-DD" for a DATE column, or null (unparseable or year-only). */
export function toIsoDate(raw: string | null | undefined): string | null {
  return parseDob(raw)?.iso ?? null;
}

/** Age in completed years. Exact DOB → min === max; year-only → { min: Y-y-1, max: Y-y }; null when unparseable. */
export function ageRange(raw: string | null | undefined, today: Date = new Date()): { min: number; max: number } | null {
  const p = parseDobAt(raw, today);
  if (!p?.year) return null;
  const years = today.getFullYear() - p.year;
  if (!p.iso) return { min: years - 1, max: years };
  const [, mo, d] = p.iso.split("-").map(Number);
  const m = today.getMonth() + 1;
  const age = m < mo || (m === mo && today.getDate() < d) ? years - 1 : years;
  return { min: age, max: age };
}
