import { describe, expect, it } from "vitest";
import {
  AADHAAR_RE, ACCOUNT_RE, EMAIL_RE, GSTIN_RE, IFSC_RE, MOBILE_RE, PAN_RE, PINCODE_RE, UUID_RE,
  isAcceptedFileType,
} from "../validators";

// Each check: the values it accepts, then the values it turns away.
function check(re: RegExp, good: string[], bad: string[]) {
  for (const v of good) expect(re.test(v), `should accept "${v}"`).toBe(true);
  for (const v of bad) expect(re.test(v), `should reject "${v}"`).toBe(false);
}

describe("PAN_RE", () => {
  it("is 5 letters, 4 digits, 1 letter — upper case only", () => {
    check(PAN_RE,
      ["ABCDE1234F", "AAAPZ9999Z"],
      ["abcde1234f", "ABCD1234F", "ABCDE12345", "ABCDE1234FG", "ABCDE 1234F", " ABCDE1234F", ""]);
  });
});

describe("IFSC_RE", () => {
  it("is 4 letters, a zero, then 6 letters or digits", () => {
    check(IFSC_RE,
      ["SBIN0001234", "HDFC0ABC123", "ICIC0000001"],
      ["SBIN1001234", "sbin0001234", "SBIN000123", "SBIN00012345", "SBI00001234", ""]);
  });
});

describe("GSTIN_RE", () => {
  it("is a 2-digit state code + PAN + entity digit + Z + check character", () => {
    check(GSTIN_RE,
      ["08ABCDE1234F1Z5", "27AAAPZ9999Z1ZA", "29ABCDE1234FAZ9"],
      ["08abcde1234f1z5", "08ABCDE1234F1A5", "AAABCDE1234F1Z5", "08ABCDE1234F1Z", "08ABCDE1234F1Z55", ""]);
  });
});

describe("AADHAAR_RE", () => {
  it("is exactly 12 digits, with any spaces already stripped", () => {
    check(AADHAAR_RE,
      ["123456789012", "000000000000"],
      ["1234 5678 9012", "12345678901", "1234567890123", "12345678901a", ""]);
  });
});

describe("MOBILE_RE", () => {
  it("is 10 digits starting 6–9, no country code", () => {
    check(MOBILE_RE,
      ["9876543210", "6000000000", "7300085864", "8769145691"],
      ["5876543210", "0987654321", "987654321", "98765432101", "+919876543210", "98765 43210", ""]);
  });
});

describe("EMAIL_RE", () => {
  it("needs something@something.something with no spaces", () => {
    check(EMAIL_RE,
      ["a@b.co", "ops.team+loans@lender.co.in"],
      ["a@b", "a b@c.de", "a@@b.co", "@b.co", "a@.co", "a@b.", ""]);
  });
});

describe("PINCODE_RE", () => {
  it("is 6 digits that never start with 0", () => {
    check(PINCODE_RE,
      ["302001", "110001", "999999"],
      ["012345", "30200", "3020011", "30200a", ""]);
  });
});

describe("ACCOUNT_RE", () => {
  it("is 9 to 18 digits", () => {
    check(ACCOUNT_RE,
      ["123456789", "123456789012345678"],
      ["12345678", "1234567890123456789", "12345 6789", "ABC123456789", ""]);
  });
});

describe("UUID_RE", () => {
  it("is a dashed uuid, upper or lower case", () => {
    check(UUID_RE,
      ["123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000"],
      ["123e4567e89b12d3a456426614174000", "{123e4567-e89b-12d3-a456-426614174000}",
        "123e4567-e89b-12d3-a456-42661417400", "g23e4567-e89b-12d3-a456-426614174000", "1; drop table x", ""]);
  });
});

describe("isAcceptedFileType", () => {
  it("accepts JPEG, PNG, WebP and PDF uploads", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) expect(isAcceptedFileType(t)).toBe(true);
  });

  it("turns away every other type (the check is exact and case-sensitive)", () => {
    for (const t of ["image/gif", "application/msword", "text/plain", "IMAGE/JPEG", ""]) expect(isAcceptedFileType(t)).toBe(false);
  });
});
