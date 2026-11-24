import { describe, expect, it } from "vitest";
import { err, numOrNull, strOrNull } from "../api";

describe("strOrNull", () => {
  it("gives the trimmed text", () => {
    expect(strOrNull("  Jaipur ")).toBe("Jaipur");
    expect(strOrNull("x")).toBe("x");
  });

  it("is null when missing or blank", () => {
    expect(strOrNull(null)).toBeNull();
    expect(strOrNull(undefined)).toBeNull();
    expect(strOrNull("")).toBeNull();
    expect(strOrNull("   ")).toBeNull();
  });

  it("turns other values into text", () => {
    expect(strOrNull(0)).toBe("0");
    expect(strOrNull(42.5)).toBe("42.5");
    expect(strOrNull(false)).toBe("false");
  });
});

describe("numOrNull", () => {
  it("gives the number, from a number or numeric text", () => {
    expect(numOrNull(12.5)).toBe(12.5);
    expect(numOrNull("12.5")).toBe(12.5);
    expect(numOrNull(" 7 ")).toBe(7);
    expect(numOrNull("-500")).toBe(-500);
  });

  it("keeps zero", () => {
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull("0")).toBe(0);
  });

  it("is null when missing, empty or not a finite number", () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull("")).toBeNull();
    expect(numOrNull("abc")).toBeNull();
    expect(numOrNull("12abc")).toBeNull();
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
    expect(numOrNull("Infinity")).toBeNull();
  });

  // Number("   ") is 0: a whitespace-only field used to be saved as 0.
  it("is null for whitespace-only text", () => {
    expect(numOrNull("   ")).toBeNull();
  });
});

describe("err", () => {
  it("answers { ok: false, error } with the status", async () => {
    const res = err("Loan application not found.", 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Loan application not found." });
  });

  it("defaults to 400", async () => {
    const res = err("Bad input");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Bad input" });
  });
});
