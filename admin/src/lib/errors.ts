// The text of a caught error — one home for the
// `e instanceof Error ? e.message : String(e)` that was copied all over the app.
//
//   import { errText } from "@/lib/errors";
//
//   catch (e) { setError(errText(e)); }                      // e instanceof Error ? e.message : String(e)
//   catch (e) { setError(errText(e, "Couldn't read that.")); } // e instanceof Error ? e.message : "Couldn't read that."
//
// It is exactly that expression, nothing more: an Error gives its message (even
// an empty one); anything else that was thrown gives String(it), or `fallback`
// when one is passed.
//
// NOT the same as `(e as Error)?.message || "Network error."` — that one also
// swaps an EMPTY message for the fallback, and gives the fallback (not
// String(e)) for a thrown string or null. Leave those as they are, so the text
// people see does not change.

/** The message of a caught value: `e instanceof Error ? e.message : (fallback ?? String(e))`. */
export function errText(e: unknown, fallback?: string): string {
  if (e instanceof Error) return e.message;
  return fallback ?? String(e);
}
