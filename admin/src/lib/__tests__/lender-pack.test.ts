import { beforeEach, describe, expect, it, vi } from "vitest";

// The mailer is replaced so the tests decide whether email is "configured" and
// nothing can ever be sent.
const mail = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/mailer", () => ({
  mailConfigured: () => mail.configured,
  sendMail: vi.fn(),
  sendMailAs: vi.fn(),
  MAIL_SENDER: "sender@example.com",
}));

import { readSendFields, titleCaseCategory, type ComposerBody } from "../lender-pack";
import { esc } from "../html";

beforeEach(() => { mail.configured = true; });

const DEFAULT_DETAIL: [string, string][] = [["Borrower", "Test Name"], ["Loan amount", "₹1,80,000"]];

// readSendFields answers the cleaned fields, or a Response to send back on an error.
function fieldsOf(body: ComposerBody) {
  const res = readSendFields(body, "Default subject", DEFAULT_DETAIL);
  if (res instanceof Response) throw new Error(`expected fields, got an error reply (${res.status})`);
  return res;
}

describe("esc", () => {
  it("escapes the HTML special characters", () => {
    expect(esc(`<a href="x">Tom & Jerry</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
  });

  it("leaves plain text alone", () => {
    expect(esc("Bank Statement - Ram Kumar")).toBe("Bank Statement - Ram Kumar");
  });
});

describe("titleCaseCategory", () => {
  it("turns a document category into a label", () => {
    expect(titleCaseCategory("bank_statement")).toBe("Bank Statement");
    expect(titleCaseCategory("electricity_bill")).toBe("Electricity Bill");
    expect(titleCaseCategory("pan")).toBe("Pan");
  });
});

describe("readSendFields", () => {
  it("cleans the TO address (trimmed, lower case)", () => {
    expect(fieldsOf({ to: "  Ops@Lender.COM " }).to).toBe("ops@lender.com");
  });

  it("keeps only valid CC / BCC addresses, lower case, each once", () => {
    const f = fieldsOf({
      to: "ops@lender.com",
      cc: ["A@x.com", "a@x.com ", "not-an-email", ""],
      bcc: ["b@y.in"],
    });
    expect(f.cc).toEqual(["a@x.com"]);
    expect(f.bcc).toEqual(["b@y.in"]);
  });

  it("treats a CC / BCC that isn't a list as none", () => {
    const f = fieldsOf({ to: "ops@lender.com", cc: "a@x.com" as unknown as string[] });
    expect(f.cc).toEqual([]);
    expect(f.bcc).toEqual([]);
  });

  it("uses the default subject and detail rows when left empty", () => {
    const f = fieldsOf({ to: "ops@lender.com", subject: "   ", detail: [] });
    expect(f.subject).toBe("Default subject");
    expect(f.detail).toEqual(DEFAULT_DETAIL);
    expect(f.toName).toBe("");
  });

  it("keeps the edited subject, name and detail rows (as text)", () => {
    const f = fieldsOf({
      to: "ops@lender.com",
      subject: " Loan file ",
      toName: " Credit Team ",
      detail: [["Size", 3 as unknown as string], null as unknown as [string, string]],
    });
    expect(f.subject).toBe("Loan file");
    expect(f.toName).toBe("Credit Team");
    expect(f.detail).toEqual([["Size", "3"], ["", ""]]);
  });

  it("answers 400 for a missing or invalid TO address", async () => {
    for (const to of [undefined, "", "not-an-email"]) {
      const res = readSendFields({ to }, "S", DEFAULT_DETAIL);
      expect(res).toBeInstanceOf(Response);
      const reply = res as Response;
      expect(reply.status).toBe(400);
      expect(await reply.json()).toEqual({ ok: false, error: "Enter a valid recipient (TO) email." });
    }
  });

  it("answers 500 when email isn't configured", async () => {
    mail.configured = false;
    const reply = readSendFields({ to: "ops@lender.com" }, "S", DEFAULT_DETAIL) as Response;
    expect(reply.status).toBe(500);
    expect(await reply.json()).toEqual({ ok: false, error: "Email isn't configured yet (app password missing)." });
  });
});
