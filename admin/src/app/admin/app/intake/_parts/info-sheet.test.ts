import { describe, expect, it } from "vitest";
import { cleanSheetEdit, parseInfoSheet } from "./info-sheet";
import { SCRIPT, isTurnFilled } from "./script";

// The RM's info sheet, in the team's usual format (made-up person).
const SHEET = `Applicant Name: Ravi Kumar
App Mob No.: 9876543210
App email ID: ravi.test@example.com

Co-app Name : Sita devi
Co-app Mob No: 9123456780
Co-app email ID : sita.test@example.com

Employer /Business Name : ravi motor shop

Project Cost : 175000
Loan Amount :175000
Loan Tenure : 5 year

Merchant Name : Test Energy
Capacity : 3 kw

Place of Installation: house
Subsidy : yes
On-Grid/ Off-grid :on grid`;

describe("parseInfoSheet", () => {
  it("reads every line of the team's sheet", () => {
    expect(parseInfoSheet(SHEET)).toEqual({
      borrower_name: "Ravi Kumar", borrower_mobile: "9876543210", borrower_email: "ravi.test@example.com",
      coapp_name: "Sita devi", _has_coapp: "1", coapp_mobile: "9123456780", coapp_email: "sita.test@example.com",
      organization_name: "ravi motor shop",
      total_project_cost: "175000", loan_amount_required: "175000", selected_tenure_years: "5",
      _merchant_name: "Test Energy", project_size: "3", project_size_unit: "kw",
      plant_use_type: "residential", _subsidy_case: "subsidy", system_type: "on_grid",
    });
  });

  it("place of installation: a house / shop is the property use, an address stays the place", () => {
    expect(parseInfoSheet("Place of Installation: Shop").plant_use_type).toBe("commercial");
    expect(parseInfoSheet("Place of Installation: Jaipur")).toEqual({ install_city: "Jaipur" });
    expect(parseInfoSheet("Place of Installation: Shop no 3, near Power House")).toEqual({ install_city: "Shop no 3, near Power House" });
    expect(parseInfoSheet("Location: Guest House")).toEqual({ install_city: "Guest House" });
  });

  it("subsidy: yes / no is the subsidy case, an amount is the central subsidy", () => {
    expect(parseInfoSheet("Subsidy : no")).toEqual({ _subsidy_case: "non_subsidy" });
    expect(parseInfoSheet("Subsidy : 78,000/-")).toEqual({ central_subsidy: "78000" });
    expect(parseInfoSheet("Subsidy : Yes 60,000/-")).toEqual({ _subsidy_case: "subsidy", central_subsidy: "60000" });
    expect(parseInfoSheet("Subsidy : Yes.")).toEqual({ _subsidy_case: "subsidy" });
  });

  it("tenure: years 1–5 only; months become years", () => {
    expect(parseInfoSheet("Loan Tenure : 60 months").selected_tenure_years).toBe("5");
    expect(parseInfoSheet("Tenure: 3 yrs").selected_tenure_years).toBe("3");
    expect(parseInfoSheet("Loan Tenure : 10 year")).toEqual({});
  });
});

describe("cleanSheetEdit (a hand edit on the confirm card)", () => {
  it("stores only a value the profile can hold", () => {
    expect(cleanSheetEdit("_subsidy_case", "No")).toEqual({ value: "non_subsidy" });
    expect(cleanSheetEdit("_subsidy_case", "subsidy")).toEqual({ value: "subsidy" });
    expect(cleanSheetEdit("plant_use_type", "Commercial")).toEqual({ value: "commercial" });
    expect(cleanSheetEdit("system_type", "off grid")).toEqual({ value: "off_grid" });
    expect(cleanSheetEdit("selected_tenure_years", "4")).toEqual({ value: "4" });
    expect(cleanSheetEdit("total_project_cost", "1,80,000")).toEqual({ value: "180000" });
    expect(cleanSheetEdit("coapp_name", "Sita Devi")).toEqual({ value: "Sita Devi" });
  });

  it("refuses a value it can't store", () => {
    expect(cleanSheetEdit("_subsidy_case", "maybe")).toHaveProperty("error");
    expect(cleanSheetEdit("plant_use_type", "big building")).toHaveProperty("error");
    expect(cleanSheetEdit("selected_tenure_years", "7")).toHaveProperty("error");
  });
});

describe("after the sheet, the chat skips what it answered", () => {
  const f = parseInfoSheet(SHEET) as Record<string, string>;
  const turn = (id: string) => SCRIPT.find((t) => t.id === id)!;

  it("skips use type, system, mobile, email, co-applicant contact, employer, loan amount", () => {
    for (const id of ["plant_use_type", "system_type", "borrower_mobile", "borrower_email", "coapp_mobile", "coapp_email", "organization_name", "loan_amount"]) {
      const t = turn(id);
      expect(isTurnFilled(t, f) || (t.when ? !t.when(f) : false), id).toBe(true);
    }
    expect(turn("coapp_needed").when!(f)).toBe(false);
  });

  it("still asks the pincode, the documents and the loan configuration (tenure pre-picked, not saved)", () => {
    expect(isTurnFilled(turn("install_pincode"), f)).toBe(false);
    expect(isTurnFilled(turn("doc_table"), f)).toBe(false);
    expect(isTurnFilled(turn("loanconfig"), f)).toBe(false);
    expect(isTurnFilled(turn("loanconfig"), { ...f, selected_monthly_emi: "3940" })).toBe(true);
  });
});
