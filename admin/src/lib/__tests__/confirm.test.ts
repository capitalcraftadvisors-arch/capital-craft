import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerConfirm, askConfirm, cancelAllConfirms, isConfirmOpen, subscribeConfirm, type ConfirmRequest } from "../confirm";

// askConfirm only asks in a browser; a bare `window` is enough for the queue.
const g = globalThis as { window?: unknown };
beforeAll(() => { g.window = g.window ?? {}; });
afterAll(() => { delete g.window; });

describe("askConfirm", () => {
  it("shows one question at a time, in order, and resolves each with its answer", async () => {
    const shown: (string | null)[] = [];
    let current: ConfirmRequest | null = null;
    const stop = subscribeConfirm((r: ConfirmRequest | null) => { current = r; shown.push(r ? r.message : null); });
    const answer = (ok: boolean) => answerConfirm(current!.id, ok);

    const a = askConfirm("First?");
    const b = askConfirm("Second?", { danger: true });
    expect(shown).toEqual([null, "First?"]);         // the second waits

    const first = current!.id;
    answer(true);
    expect(shown).toEqual([null, "First?", "Second?"]);
    answerConfirm(first, false);                      // a late second answer to the first: ignored
    expect(shown).toEqual([null, "First?", "Second?"]);
    answer(false);
    expect(shown).toEqual([null, "First?", "Second?", null]);

    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(false);
    stop();
  });

  it("shows a question asked before the host was mounted once it mounts", async () => {
    const p = askConfirm("Early?");
    let seen: ConfirmRequest | null = null;
    const stop = subscribeConfirm((r) => { seen = r; });
    expect(seen).toMatchObject({ message: "Early?", danger: false });
    answerConfirm(seen!.id, true);
    await expect(p).resolves.toBe(true);
    stop();
  });

  it("answers every waiting question with Cancel when the page changes", async () => {
    let current: ConfirmRequest | null = null;
    const stop = subscribeConfirm((r) => { current = r; });
    const a = askConfirm("Delete A?");
    const b = askConfirm("Delete B?");
    expect(isConfirmOpen()).toBe(true);

    const id = current!.id;
    cancelAllConfirms();
    expect(current).toBeNull();
    expect(isConfirmOpen()).toBe(false);
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);

    answerConfirm(id, true);                          // an OK after the page changed: ignored
    expect(current).toBeNull();
    stop();
  });
});
