// What the Capital Craft team asks Claude through the connector (mcp_calls,
// migration 0144): every tool call made through a team member's link, with the
// question that led to it. Grouped into one row per question for the Pri page's
// "Questions asked" list and its Excel download (/api/admin/claude-questions).

export type McpCall = {
  created_at: string; business_id: string; question: string | null;
  tool: string; args: Record<string, unknown> | null; ok: boolean; error: string | null;
};
export type AskedQuestion = {
  at: string;              // the question's first call
  person_id: string;       // whose link
  question: string;
  looked_up: string[];     // what Claude looked up, in plain words
  missing: string | null;  // what Claude couldn't answer (report_gap)
  failed: number;          // calls that errored
  details: string[];       // each call: tool + its inputs (Excel only)
};

export const MCP_CALL_COLS = "created_at, business_id, question, tool, args, ok, error";
/** The connector tool Claude calls when the portal can't answer (lib/mcp-tools). */
export const GAP_TOOL = "report_gap";

const LOOKED_UP: Record<string, string> = {
  loan_summary: "Loan numbers", search_loans: "Loans", get_loan: "Loan detail", list_pendings: "Pendings",
  search_epcs: "EPCs", get_epc: "EPC detail", search_insurance: "Insurance", search_leads: "Leads",
  list_code: "Website code", search_code: "Website code", read_code: "Website code",
};
// Calls with the same question from the same person within this gap are one question.
const SAME_QUESTION_MS = 30 * 60_000;

/** One row per question (a person's calls with the same question, each within 30 minutes of the last), newest first. */
export function groupCalls(calls: McpCall[]): AskedQuestion[] {
  const time = (c: McpCall) => new Date(c.created_at).getTime();
  const out: AskedQuestion[] = [];
  const open = new Map<string, { q: AskedQuestion; last: number }>();
  for (const c of [...calls].sort((a, b) => time(a) - time(b))) {
    const question = (c.question ?? "").trim() || "—";
    const key = `${c.business_id}\n${question.toLowerCase()}`;
    let g = open.get(key);
    if (!g || time(c) - g.last > SAME_QUESTION_MS) {
      g = { q: { at: c.created_at, person_id: c.business_id, question, looked_up: [], missing: null, failed: 0, details: [] }, last: 0 };
      open.set(key, g);
      out.push(g.q);
    }
    g.last = time(c);
    if (c.tool === GAP_TOOL) {
      g.q.missing = String(c.args?.missing ?? "").trim() || g.q.missing;
    } else {
      const label = LOOKED_UP[c.tool] ?? c.tool;
      if (!g.q.looked_up.includes(label)) g.q.looked_up.push(label);
      g.q.details.push(c.tool + (c.args && Object.keys(c.args).length ? " " + JSON.stringify(c.args) : ""));
    }
    if (!c.ok) g.q.failed++;
  }
  return out.reverse();
}
