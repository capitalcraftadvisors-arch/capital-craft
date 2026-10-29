// Display casing for people / business names: first letter of each word
// capital, the rest small — "JAGDISH KUMAR" / "jagdish kumar" → "Jagdish Kumar".
// Display only; the stored name stays exactly as entered.

export function nameCase(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/(^|[\s(\-./])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Avatar initials — first letters of the first two words ("Manoj Kumar" → "MK"). */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? "").split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
