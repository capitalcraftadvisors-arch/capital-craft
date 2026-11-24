import { describe, expect, it } from "vitest";
import { errText } from "../errors";

describe("errText", () => {
  it("gives an Error's message, even an empty one", () => {
    expect(errText(new Error("Upload failed"))).toBe("Upload failed");
    expect(errText(new TypeError("bad"))).toBe("bad");
    expect(errText(new Error(""))).toBe("");
  });

  it("gives String(value) for anything else that was thrown", () => {
    expect(errText("plain text")).toBe("plain text");
    expect(errText(42)).toBe("42");
    expect(errText(null)).toBe("null");
    expect(errText(undefined)).toBe("undefined");
  });

  it("gives the fallback (not String(value)) for a non-Error when one is passed", () => {
    expect(errText("x", "Couldn't read that.")).toBe("Couldn't read that.");
    expect(errText(new Error("real"), "Couldn't read that.")).toBe("real");
  });
});
