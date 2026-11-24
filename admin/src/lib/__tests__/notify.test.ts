import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => calls.push(["success", ...a]),
    error: (...a: unknown[]) => calls.push(["error", ...a]),
    info: (...a: unknown[]) => calls.push(["info", ...a]),
  },
}));

import { notify, splitMessage } from "../notify";

beforeEach(() => { calls.length = 0; });

describe("splitMessage", () => {
  it("keeps a one-line message whole", () => {
    expect(splitMessage("Saved.")).toEqual({ title: "Saved.", body: "" });
  });
  it("splits at the first line break", () => {
    expect(splitMessage("Couldn't upload.\nToo big.\nTry a smaller file."))
      .toEqual({ title: "Couldn't upload.", body: "Too big.\nTry a smaller file." });
  });
  it("drops the \\r of a Windows line break from the title", () => {
    expect(splitMessage("A\r\nB")).toEqual({ title: "A", body: "B" });
  });
  it("drops blank lines between the title and the body", () => {
    expect(splitMessage("A\n\nB")).toEqual({ title: "A", body: "B" });
    expect(splitMessage("A\r\n\r\nB\n\nC")).toEqual({ title: "A", body: "B\n\nC" });
  });
});

describe("notify", () => {
  it("shows a one-line message exactly as written", () => {
    notify.error("Couldn't save.");
    notify.success("Saved.");
    notify.info("Nothing yet.");
    const short = { duration: undefined }; // sonner's own 4 seconds
    expect(calls).toEqual([["error", "Couldn't save.", short], ["success", "Saved.", short], ["info", "Nothing yet.", short]]);
  });
  it("shows the first line as the title and the rest as the description, for longer", () => {
    notify.error("Couldn't upload.\nToo big.");
    expect(calls).toEqual([["error", "Couldn't upload.", { description: "Too big.", descriptionClassName: "whitespace-pre-line", duration: 12000 }]]);
  });
  it("keeps a long one-line message up for longer", () => {
    notify.info("x".repeat(81));
    notify.info("x".repeat(80));
    expect(calls).toEqual([["info", "x".repeat(81), { duration: 12000 }], ["info", "x".repeat(80), { duration: undefined }]]);
  });
});
