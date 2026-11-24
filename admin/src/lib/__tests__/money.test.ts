import { describe, expect, it } from "vitest";
import { amountInput, fmtRupees, fmtRupeesExact, inrPlain, numberInput, pctOf, rupees, rupeesShort } from "../money";

describe("inrPlain", () => {
  it("groups the Indian way (lakh / crore)", () => {
    expect(inrPlain(180000)).toBe("1,80,000");
    expect(inrPlain(12345678)).toBe("1,23,45,678");
    expect(inrPlain(999)).toBe("999");
    expect(inrPlain(0)).toBe("0");
  });

  it("shows paise (always 2 places) only when there are some", () => {
    expect(inrPlain(174139.2)).toBe("1,74,139.20");
    expect(inrPlain(0.5)).toBe("0.50");
    expect(inrPlain(1500.0)).toBe("1,500");
  });

  it("rounds to the paisa", () => {
    expect(inrPlain(100.126)).toBe("100.13");
    expect(inrPlain(100.004)).toBe("100");
  });
});

describe("fmtRupees", () => {
  it("adds the ₹ sign to inrPlain", () => {
    expect(fmtRupees(180000)).toBe("₹1,80,000");
    expect(fmtRupees(174139.2)).toBe("₹1,74,139.20");
  });

  it("shows ₹0 for zero", () => {
    expect(fmtRupees(0)).toBe("₹0");
  });

  it("shows — for a missing or non-number amount", () => {
    expect(fmtRupees(null)).toBe("—");
    expect(fmtRupees(undefined)).toBe("—");
    expect(fmtRupees(NaN)).toBe("—");
    expect(fmtRupees(Infinity)).toBe("—");
  });

  it("puts a minus after the ₹ sign", () => {
    expect(fmtRupees(-500)).toBe("₹-500");
  });
});

describe("fmtRupeesExact", () => {
  it("never rounds to the paisa (up to 6 decimals)", () => {
    expect(fmtRupeesExact(57777.5)).toBe("₹57,777.5");
    expect(fmtRupeesExact(1.123456789)).toBe("₹1.123457");
    expect(fmtRupeesExact(180000)).toBe("₹1,80,000");
    expect(fmtRupeesExact(0)).toBe("₹0");
  });

  it("shows — for a missing or non-number amount", () => {
    expect(fmtRupeesExact(null)).toBe("—");
    expect(fmtRupeesExact(undefined)).toBe("—");
    expect(fmtRupeesExact(NaN)).toBe("—");
  });
});

describe("rupees", () => {
  it("formats like fmtRupees and accepts numeric text", () => {
    expect(rupees(174139.2)).toBe("₹1,74,139.20");
    expect(rupees("1500")).toBe("₹1,500");
  });

  it("shows — for zero, missing and non-number values", () => {
    expect(rupees(0)).toBe("—");
    expect(rupees("0")).toBe("—");
    expect(rupees(null)).toBe("—");
    expect(rupees(undefined)).toBe("—");
    expect(rupees("abc")).toBe("—");
  });
});

describe("rupeesShort", () => {
  it("uses Cr from 1 crore (2 decimals) and L from 1 lakh (1 decimal)", () => {
    expect(rupeesShort(12500000)).toBe("₹1.25 Cr");
    expect(rupeesShort(10000000)).toBe("₹1.00 Cr");
    expect(rupeesShort(450000)).toBe("₹4.5 L");
    expect(rupeesShort(100000)).toBe("₹1.0 L");
  });

  it("shows smaller amounts in full, with paise when present", () => {
    expect(rupeesShort(99999)).toBe("₹99,999");
    expect(rupeesShort(85000.5)).toBe("₹85,000.50");
    expect(rupeesShort(0)).toBe("₹0");
  });
});

describe("pctOf", () => {
  it("gives the share as a percent with at most 1 decimal", () => {
    expect(pctOf(80000, 100000)).toBe("80%");
    expect(pctOf(1, 3)).toBe("33.3%");
    expect(pctOf(2, 3)).toBe("66.7%");
    expect(pctOf(150, 100)).toBe("150%");
  });

  it("accepts numeric text", () => {
    expect(pctOf("90000", "100000")).toBe("90%");
  });

  it("is null when either side is missing, zero, negative or not a number", () => {
    expect(pctOf(0, 100)).toBeNull();
    expect(pctOf(100, 0)).toBeNull();
    expect(pctOf(-5, 100)).toBeNull();
    expect(pctOf(null, 100)).toBeNull();
    expect(pctOf(undefined, 100)).toBeNull();
    expect(pctOf("abc", 100)).toBeNull();
  });
});

describe("numberInput", () => {
  it("keeps digits, one decimal point and a leading minus", () => {
    expect(numberInput("12.5")).toBe("12.5");
    expect(numberInput("-500")).toBe("-500");
    expect(numberInput("  -7")).toBe("-7");
  });

  it("keeps a lone '-' or a trailing '.' while the number is being typed", () => {
    expect(numberInput("-")).toBe("-");
    expect(numberInput("12.")).toBe("12.");
    expect(numberInput(".")).toBe(".");
  });

  it("drops a second decimal point, stray minus signs and other characters", () => {
    expect(numberInput("12.3.4")).toBe("12.34");
    expect(numberInput("5-")).toBe("5");
    expect(numberInput("--5")).toBe("-5");
    expect(numberInput("₹1,74,139")).toBe("174139");
    expect(numberInput("abc")).toBe("");
  });

  it("cuts the decimals to `places`", () => {
    expect(numberInput("3.14159", 3)).toBe("3.141");
    expect(numberInput("3.14159")).toBe("3.14159");
    expect(numberInput("3.9", 0)).toBe("3.");
  });
});

describe("amountInput", () => {
  it("keeps any real amount to the paisa (2 decimals)", () => {
    expect(amountInput("174139.2")).toBe("174139.2");
    expect(amountInput("174139.256")).toBe("174139.25");
    expect(amountInput("1,74,139.20")).toBe("174139.20");
    expect(amountInput("-500")).toBe("-500");
    expect(amountInput("0")).toBe("0");
    expect(amountInput("")).toBe("");
  });
});
