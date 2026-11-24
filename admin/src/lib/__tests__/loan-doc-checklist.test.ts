import { describe, expect, it } from "vitest";
import { DOC_CATEGORY, LOAN_PATH_COLUMNS, loanDocChecklist, type LoanDocCols } from "../loan-doc-checklist";
import { APPLICANT_PHOTO_AADHAAR_CUTOVER_MS, aadhaarFaceCountsAsPhoto } from "../applicant-photo";

// THE document rule (Doc Sent gate, "x/y docs" badge, Message-to-EPC table).

const keys = (l: LoanDocCols, cats: Iterable<string> = []) => loanDocChecklist(l, cats).map((d) => d.key);
const okOf = (l: LoanDocCols, cats: Iterable<string>, key: string) =>
  loanDocChecklist(l, cats).find((d) => d.key === key)?.ok;

const BEFORE_CUTOVER = "2026-08-01T10:00:00Z";
const AFTER_CUTOVER = "2026-09-01T10:00:00Z";

const BASE = ["pan", "photo", "aadhaar_front", "aadhaar_back", "quotation", "ebill", "rooftop", "bank"];
const COAPP = ["coapp_pan", "coapp_aadhaar_front", "coapp_aadhaar_back"];

describe("loanDocChecklist — which documents are needed", () => {
  it("needs the 8 borrower documents, in order, for an on-grid loan", () => {
    expect(keys({ system_type: "on_grid" })).toEqual(BASE);
  });

  it("needs the same 8 when the system type isn't set yet, and for hybrid", () => {
    expect(keys({})).toEqual(BASE);
    expect(keys({ system_type: null })).toEqual(BASE);
    expect(keys({ system_type: "hybrid" })).toEqual(BASE);
  });

  it("does not need the electricity bill for an off-grid system", () => {
    expect(keys({ system_type: "off_grid" })).toEqual(BASE.filter((k) => k !== "ebill"));
  });

  it("adds the co-applicant's PAN and Aadhaar when the bill is not on the applicant's name", () => {
    expect(keys({ bill_on_applicant_name: false })).toEqual([...BASE, ...COAPP]);
  });

  it("has no co-applicant documents when the bill is on the applicant's name, or that's not answered yet", () => {
    expect(keys({ bill_on_applicant_name: true })).toEqual(BASE);
    expect(keys({ bill_on_applicant_name: null })).toEqual(BASE);
    expect(keys({})).toEqual(BASE);
  });

  it("off-grid with a co-applicant: no bill, plus the co-applicant documents", () => {
    expect(keys({ system_type: "off_grid", bill_on_applicant_name: false }))
      .toEqual([...BASE.filter((k) => k !== "ebill"), ...COAPP]);
  });

  it("starts with every document missing", () => {
    expect(loanDocChecklist({ bill_on_applicant_name: false }, []).every((d) => !d.ok)).toBe(true);
  });
});

describe("loanDocChecklist — when a document counts", () => {
  it("borrower PAN counts only as a document row", () => {
    expect(okOf({}, [DOC_CATEGORY.pan], "pan")).toBe(true);
    expect(okOf({}, ["borrower_pan"], "pan")).toBe(true);
    expect(okOf({}, [], "pan")).toBe(false);
  });

  it("Aadhaar front and back count only as their columns", () => {
    expect(okOf({ aadhaar_front_path: "a/front.jpg" }, [], "aadhaar_front")).toBe(true);
    expect(okOf({ aadhaar_back_path: "a/back.jpg" }, [], "aadhaar_back")).toBe(true);
    expect(okOf({ aadhaar_front_path: "a/front.jpg" }, [], "aadhaar_back")).toBe(false);
  });

  it("quotation, bill, rooftop photo and bank statement count as a row OR their column", () => {
    const cases: [string, keyof LoanDocCols, string][] = [
      ["quotation", "proforma_invoice_path", "quotation"],
      ["ebill", "ebill_path", "electricity_bill"],
      ["rooftop", "rooftop_photo_path", "borrower_photo"],
      ["bank", "bank_statement_path", "bank_statement"],
    ];
    for (const [key, column, category] of cases) {
      expect(okOf({}, [category], key), `${key} by row`).toBe(true);
      expect(okOf({ [column]: "docs/file.pdf" } as LoanDocCols, [], key), `${key} by column`).toBe(true);
      expect(okOf({}, [], key), `${key} missing`).toBe(false);
    }
  });

  it("the applicant photo counts as a row or the customer_photo_path column", () => {
    expect(okOf({}, ["customer_photo"], "photo")).toBe(true);
    expect(okOf({ customer_photo_path: "p/photo.jpg" }, [], "photo")).toBe(true);
    expect(okOf({}, [], "photo")).toBe(false);
  });

  it("the Aadhaar face counts as the photo only for loans created before the cutover", () => {
    expect(okOf({ aadhaar_face_path: "a/face.jpg", created_at: BEFORE_CUTOVER }, [], "photo")).toBe(true);
    expect(okOf({ aadhaar_face_path: "a/face.jpg", created_at: AFTER_CUTOVER }, [], "photo")).toBe(false);
    expect(okOf({ aadhaar_face_path: "a/face.jpg", created_at: null }, [], "photo")).toBe(false);
  });

  it("co-applicant documents count only as their columns", () => {
    const l: LoanDocCols = {
      bill_on_applicant_name: false,
      coapp_pan_path: "c/pan.jpg",
      coapp_aadhaar_front_path: "c/front.jpg",
    };
    expect(okOf(l, [], "coapp_pan")).toBe(true);
    expect(okOf(l, [], "coapp_aadhaar_front")).toBe(true);
    expect(okOf(l, [], "coapp_aadhaar_back")).toBe(false);
  });

  it("an empty path does not count", () => {
    expect(okOf({ ebill_path: "" }, [], "ebill")).toBe(false);
    expect(okOf({ ebill_path: null }, [], "ebill")).toBe(false);
  });

  it("ignores categories it doesn't know, and takes any iterable of categories", () => {
    expect(loanDocChecklist({}, ["other", "insurance"]).every((d) => !d.ok)).toBe(true);
    expect(okOf({}, new Set(["bank_statement"]), "bank")).toBe(true);
  });

  it("is all done for a complete on-grid loan with a co-applicant", () => {
    const l: LoanDocCols = {
      created_at: AFTER_CUTOVER,
      system_type: "on_grid",
      bill_on_applicant_name: false,
      aadhaar_front_path: "a/f.jpg",
      aadhaar_back_path: "a/b.jpg",
      customer_photo_path: "p.jpg",
      proforma_invoice_path: "q.pdf",
      ebill_path: "e.pdf",
      rooftop_photo_path: "r.jpg",
      bank_statement_path: "bs.pdf",
      coapp_pan_path: "c/p.jpg",
      coapp_aadhaar_front_path: "c/f.jpg",
      coapp_aadhaar_back_path: "c/b.jpg",
    };
    const list = loanDocChecklist(l, ["borrower_pan"]);
    expect(list).toHaveLength(11);
    expect(list.every((d) => d.ok)).toBe(true);
  });
});

describe("aadhaarFaceCountsAsPhoto", () => {
  it("is true only with a face image AND a creation time before the cutover", () => {
    const justBefore = new Date(APPLICANT_PHOTO_AADHAAR_CUTOVER_MS - 1000).toISOString();
    const atCutover = new Date(APPLICANT_PHOTO_AADHAAR_CUTOVER_MS).toISOString();
    expect(aadhaarFaceCountsAsPhoto({ aadhaar_face_path: "f.jpg", created_at: justBefore })).toBe(true);
    expect(aadhaarFaceCountsAsPhoto({ aadhaar_face_path: "f.jpg", created_at: atCutover })).toBe(false);
    expect(aadhaarFaceCountsAsPhoto({ aadhaar_face_path: null, created_at: justBefore })).toBe(false);
    expect(aadhaarFaceCountsAsPhoto({ aadhaar_face_path: "f.jpg" })).toBe(false);
  });
});

describe("LOAN_PATH_COLUMNS", () => {
  it("lists each *_path document column once", () => {
    expect(new Set(LOAN_PATH_COLUMNS).size).toBe(LOAN_PATH_COLUMNS.length);
    for (const c of LOAN_PATH_COLUMNS) expect(c.endsWith("_path")).toBe(true);
  });

  it("covers every column the checklist reads", () => {
    const read = [
      "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path", "customer_photo_path",
      "proforma_invoice_path", "ebill_path", "rooftop_photo_path", "bank_statement_path",
      "coapp_pan_path", "coapp_aadhaar_front_path", "coapp_aadhaar_back_path",
    ];
    for (const c of read) expect(LOAN_PATH_COLUMNS as readonly string[]).toContain(c);
  });
});
