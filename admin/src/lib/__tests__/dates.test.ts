import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageRange, fmtAgo, fmtDate, fmtDateIST, fmtDateTime, fmtDateTimeIST, fmtDob, fmtTime, fmtWhen,
  localIsoDate, parseDob, toIsoDate, todayIST, withLocalDate,
} from "../dates";

// Local dates are built with new Date(y, m, d, ...) so these tests pass in any
// time zone; IST tests use UTC timestamps ("...Z"), which are the same everywhere.

afterEach(() => { vi.useRealTimers(); });

describe("fmtDate", () => {
  it("shows a date-only value as DD/MM/YYYY", () => {
    expect(fmtDate("2026-07-05")).toBe("05/07/2026");
    expect(fmtDate("2026-12-31")).toBe("31/12/2026");
  });

  it("shows a Date as its local calendar day", () => {
    expect(fmtDate(new Date(2026, 6, 5, 23, 59))).toBe("05/07/2026");
    expect(fmtDate(new Date(2026, 0, 1, 0, 0))).toBe("01/01/2026");
  });

  it("shows — for an empty or unreadable value", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
    expect(fmtDate(new Date(NaN))).toBe("—");
  });
});

describe("fmtDateIST", () => {
  it("shows the India date of a timestamp", () => {
    expect(fmtDateIST("2026-07-05T06:30:00Z")).toBe("05/07/2026");
  });

  it("is already the next day between 00:00 and 05:30 IST (still the day before in UTC)", () => {
    expect(fmtDateIST("2026-07-04T18:29:59Z")).toBe("04/07/2026"); // 23:59:59 IST
    expect(fmtDateIST("2026-07-04T18:30:00Z")).toBe("05/07/2026"); // 00:00 IST
    expect(fmtDateIST("2026-07-04T20:00:00Z")).toBe("05/07/2026"); // 01:30 IST
    expect(fmtDateIST("2026-07-04T23:59:59Z")).toBe("05/07/2026"); // 05:29:59 IST
    expect(fmtDateIST(new Date("2026-07-05T00:00:00Z"))).toBe("05/07/2026"); // 05:30 IST
  });

  it("leaves a date-only value as that calendar day (no zone shift)", () => {
    expect(fmtDateIST("2026-07-05")).toBe("05/07/2026");
  });

  it("shows — for an empty or unreadable value", () => {
    expect(fmtDateIST(null)).toBe("—");
    expect(fmtDateIST("")).toBe("—");
    expect(fmtDateIST("garbage")).toBe("—");
  });
});

describe("fmtDateTimeIST", () => {
  it("shows the India date and time", () => {
    expect(fmtDateTimeIST("2026-07-05T00:22:00Z")).toBe("05/07/2026, 5:52 am");
    expect(fmtDateTimeIST("2026-07-05T12:00:00Z")).toBe("05/07/2026, 5:30 pm");
    expect(fmtDateTimeIST("2026-07-04T18:45:00Z")).toBe("05/07/2026, 12:15 am");
  });

  it("shows — for an empty or unreadable value", () => {
    expect(fmtDateTimeIST(null)).toBe("—");
    expect(fmtDateTimeIST("garbage")).toBe("—");
  });
});

describe("todayIST", () => {
  it("is today's India date as YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T06:30:00Z"));
    expect(todayIST()).toBe("2026-07-05");
  });

  it("turns over at 00:00 IST, not at 00:00 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T18:29:59Z")); // 23:59:59 IST
    expect(todayIST()).toBe("2026-07-04");
    vi.setSystemTime(new Date("2026-07-04T18:30:00Z")); // 00:00 IST
    expect(todayIST()).toBe("2026-07-05");
    vi.setSystemTime(new Date("2026-07-04T23:59:59Z")); // 05:29:59 IST, UTC still the 4th
    expect(todayIST()).toBe("2026-07-05");
  });
});

describe("fmtTime / fmtDateTime", () => {
  it("shows the local time of day as h:mm am/pm", () => {
    expect(fmtTime(new Date(2026, 6, 5, 5, 52))).toBe("5:52 am");
    expect(fmtTime(new Date(2026, 6, 5, 17, 30))).toBe("5:30 pm");
    expect(fmtTime(new Date(2026, 6, 5, 0, 5))).toBe("12:05 am");
  });

  it("joins the date and the time", () => {
    expect(fmtDateTime(new Date(2026, 6, 5, 5, 52))).toBe("05/07/2026, 5:52 am");
  });

  it("shows — for an empty or unreadable value", () => {
    expect(fmtTime(null)).toBe("—");
    expect(fmtTime("garbage")).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("garbage")).toBe("—");
  });
});

describe("fmtWhen / fmtAgo", () => {
  const now = new Date(2026, 6, 5, 12, 0, 0);
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("says just now / Nm ago / Nh ago within the last day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(fmtWhen(before(30_000))).toBe("just now");
    expect(fmtWhen(before(12 * 60_000))).toBe("12m ago");
    expect(fmtWhen(before(3 * 3_600_000 + 59 * 60_000))).toBe("3h ago");
    expect(fmtAgo(before(59_999))).toBe("just now");
    expect(fmtAgo(before(23 * 3_600_000))).toBe("23h ago");
  });

  it("says just now for a time a little in the future (clock skew)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(fmtWhen(before(-5_000))).toBe("just now");
  });

  it("shows the date and time (fmtWhen) or the date only (fmtAgo) after a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const older = new Date(2026, 6, 3, 9, 15).toISOString();
    expect(fmtWhen(older)).toBe("03/07/2026, 9:15 am");
    expect(fmtAgo(older)).toBe("03/07/2026");
  });

  it("shows — for an unreadable timestamp", () => {
    expect(fmtWhen("garbage")).toBe("—");
    expect(fmtAgo("garbage")).toBe("—");
  });
});

describe("localIsoDate / withLocalDate", () => {
  it("localIsoDate gives the local calendar day as YYYY-MM-DD", () => {
    expect(localIsoDate("2026-07-05")).toBe("2026-07-05");
    expect(localIsoDate(new Date(2026, 6, 5, 23, 59))).toBe("2026-07-05");
    expect(localIsoDate(null)).toBe("");
    expect(localIsoDate("garbage")).toBe("");
  });

  it("withLocalDate moves a timestamp to another day and keeps its time of day", () => {
    const moved = new Date(withLocalDate(new Date(2026, 0, 15, 9, 41, 7, 250), "2026-07-05"));
    expect([moved.getFullYear(), moved.getMonth(), moved.getDate()]).toEqual([2026, 6, 5]);
    expect([moved.getHours(), moved.getMinutes(), moved.getSeconds(), moved.getMilliseconds()]).toEqual([9, 41, 7, 250]);
  });

  it("withLocalDate uses local midnight when there is no timestamp", () => {
    const moved = new Date(withLocalDate(null, "2026-07-05"));
    expect(localIsoDate(moved)).toBe("2026-07-05");
    expect([moved.getHours(), moved.getMinutes()]).toEqual([0, 0]);
  });
});

describe("parseDob", () => {
  // parseDob reads "now" only to place a 2-digit year: YY above this year's YY is the 1900s.
  const freezeAt2026 = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 24, 12)); };

  it("reads DD/MM/YYYY with / - . separators and spaces", () => {
    expect(parseDob("05/07/1990")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("05-07-1990")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("5.7.1990")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("05 / 07 / 1990")).toEqual({ iso: "1990-07-05", year: 1990 });
  });

  it("reads a DOB behind a label", () => {
    expect(parseDob("DOB: 05/07/1990")).toEqual({ iso: "1990-07-05", year: 1990 });
  });

  it("reads YYYY-MM-DD, with or without a time", () => {
    expect(parseDob("1990-07-05")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("1990-07-05T00:00:00")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("1990/7/5")).toEqual({ iso: "1990-07-05", year: 1990 });
  });

  it("places a 2-digit year in the 1900s when it is above this year's", () => {
    freezeAt2026();
    expect(parseDob("05/07/90")).toEqual({ iso: "1990-07-05", year: 1990 });
    expect(parseDob("05/07/27")).toEqual({ iso: "1927-07-05", year: 1927 });
    expect(parseDob("05/07/26")).toEqual({ iso: "2026-07-05", year: 2026 });
    expect(parseDob("05/07/05")).toEqual({ iso: "2005-07-05", year: 2005 });
  });

  it("keeps only the year when that is all there is (older Aadhaar cards)", () => {
    expect(parseDob("1965")).toEqual({ iso: null, year: 1965 });
    expect(parseDob("Year of Birth: 1965")).toEqual({ iso: null, year: 1965 });
    expect(parseDob("YoB 2001")).toEqual({ iso: null, year: 2001 });
  });

  it("rejects a full date that is not on the calendar (never falls back to the year)", () => {
    expect(parseDob("31/02/1990")).toBeNull();
    expect(parseDob("05/13/1990")).toBeNull();
    expect(parseDob("00/07/1990")).toBeNull();
    expect(parseDob("1990-02-30")).toBeNull();
    expect(parseDob("05/07/1890")).toBeNull();
  });

  it("knows leap years", () => {
    expect(parseDob("29/02/2000")).toEqual({ iso: "2000-02-29", year: 2000 });
    expect(parseDob("29/02/1999")).toBeNull();
  });

  it("is null for empty or unreadable text", () => {
    expect(parseDob(null)).toBeNull();
    expect(parseDob(undefined)).toBeNull();
    expect(parseDob("")).toBeNull();
    expect(parseDob("   ")).toBeNull();
    expect(parseDob("garbage")).toBeNull();
    expect(parseDob("1899")).toBeNull();
    expect(parseDob("12345678")).toBeNull();
  });
});

describe("toIsoDate", () => {
  it("gives YYYY-MM-DD for a full date", () => {
    expect(toIsoDate("05/07/1990")).toBe("1990-07-05");
    expect(toIsoDate("1990-07-05")).toBe("1990-07-05");
  });

  it("is null for a year-only, invalid or empty DOB", () => {
    expect(toIsoDate("1965")).toBeNull();
    expect(toIsoDate("31/02/1990")).toBeNull();
    expect(toIsoDate("garbage")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe("fmtDob", () => {
  it("shows a full DOB as DD/MM/YYYY however it was stored", () => {
    expect(fmtDob("05/07/1990")).toBe("05/07/1990");
    expect(fmtDob("1990-07-05")).toBe("05/07/1990");
    expect(fmtDob("5-7-1990")).toBe("05/07/1990");
  });

  it("shows year-only or unreadable text as printed (trimmed)", () => {
    expect(fmtDob("1965")).toBe("1965");
    expect(fmtDob("  Year of Birth: 1965 ")).toBe("Year of Birth: 1965");
    expect(fmtDob("garbage")).toBe("garbage");
  });

  it("shows — when empty", () => {
    expect(fmtDob(null)).toBe("—");
    expect(fmtDob(undefined)).toBe("—");
    expect(fmtDob("  ")).toBe("—");
  });
});

describe("ageRange", () => {
  it("gives the exact age for a full DOB, counting the birthday itself", () => {
    expect(ageRange("05/07/1990", new Date(2026, 6, 4))).toEqual({ min: 35, max: 35 });
    expect(ageRange("05/07/1990", new Date(2026, 6, 5))).toEqual({ min: 36, max: 36 });
    expect(ageRange("1990-07-05", new Date(2026, 11, 31))).toEqual({ min: 36, max: 36 });
  });

  it("gives a one-year range for a year-only DOB", () => {
    expect(ageRange("1965", new Date(2026, 6, 5))).toEqual({ min: 60, max: 61 });
  });

  it("is null when the DOB can't be read", () => {
    expect(ageRange("garbage", new Date(2026, 6, 5))).toBeNull();
    expect(ageRange(null, new Date(2026, 6, 5))).toBeNull();
  });
});
