import { describe, expect, it } from "vitest";
import { maskAadhaar } from "../aadhaar-mask";

describe("maskAadhaar", () => {
  it("hides all but the last 4 digits", () => {
    expect(maskAadhaar("123456789012")).toBe("xxxxxxxx9012");
  });

  it("ignores spaces and dashes in the number", () => {
    expect(maskAadhaar("1234 5678 9012")).toBe("xxxxxxxx9012");
    expect(maskAadhaar("1234-5678-9012")).toBe("xxxxxxxx9012");
  });

  it("is null unless there are exactly 12 digits", () => {
    expect(maskAadhaar("12345678901")).toBeNull();
    expect(maskAadhaar("1234567890123")).toBeNull();
    expect(maskAadhaar("xxxx xxxx 9012")).toBeNull(); // already masked
    expect(maskAadhaar("")).toBeNull();
    expect(maskAadhaar(null)).toBeNull();
    expect(maskAadhaar(undefined)).toBeNull();
  });
});
