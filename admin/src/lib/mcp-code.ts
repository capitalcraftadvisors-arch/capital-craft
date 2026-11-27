// Server-only. The website's own code for the Claude connector (list_code /
// search_code / read_code in lib/mcp-tools), so Claude can answer "how does the
// portal work" questions, not only questions about the data.
//
// Source: the public GitHub repo's main branch — pushed at every deploy, so it
// is the live version. Fetched as ONE tarball (codeload, no API rate limit) and
// kept in memory per server instance for 15 minutes; only text files are kept.

import { gunzipSync } from "zlib";

const REPO = "capitalcraftadvisors-arch/capital-craft";
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`;
const TTL = 15 * 60_000;
const TEXT = /\.(tsx?|sql|md|m?js|json|css|toml|ya?ml)$/;
const SKIP = /(^|\/)package-lock\.json$/;

type Code = { files: Map<string, string>; commit: string | null };
let cache: { at: number; code: Code } | null = null;
let loading: Promise<Code> | null = null;

// A GitHub tarball: 512-byte headers; long paths come in a pax "x" header, the
// commit in the global "g" header's comment.
function untar(buf: Buffer): Code {
  const files = new Map<string, string>();
  let commit: string | null = null;
  let paxPath: string | null = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h[0] === 0) break;
    const field = (a: number, b: number) => h.toString("utf8", a, b).replace(/\0[\s\S]*$/, "");
    const size = parseInt(field(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "g") { commit = /comment=([0-9a-f]{7,40})/.exec(body.toString("utf8"))?.[1] ?? commit; continue; }
    if (type === "x") { paxPath = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1] ?? null; continue; }
    const prefix = field(345, 500);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = null;
    if (type !== "0") continue;
    const path = name.slice(name.indexOf("/") + 1); // drop the "capital-craft-<sha>/" folder
    if (TEXT.test(path) && !SKIP.test(path)) files.set(path, body.toString("utf8"));
  }
  return { files, commit };
}

async function code(): Promise<Code> {
  if (cache && Date.now() - cache.at < TTL) return cache.code;
  loading ??= (async () => {
    try {
      const res = await fetch(TARBALL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Couldn't read the code from GitHub (HTTP ${res.status}).`);
      const c = untar(gunzipSync(Buffer.from(await res.arrayBuffer())));
      cache = { at: Date.now(), code: c };
      return c;
    } finally { loading = null; }
  })();
  return loading;
}

const norm = (p: unknown) => (typeof p === "string" ? p.trim().replace(/^\.?\/+/, "") : "");

/** Files under a folder (or all), with their line counts. */
export async function listCode(folder: unknown, limit = 400) {
  const { files, commit } = await code();
  const f = norm(folder);
  const all = [...files.keys()].filter((p) => !f || p.startsWith(f)).sort();
  return {
    commit, folder: f || "(all)", count: all.length,
    files: all.slice(0, limit).map((p) => ({ path: p, lines: files.get(p)!.split("\n").length })),
    ...(all.length > limit ? { note: `First ${limit} of ${all.length} — give a narrower folder.` } : {}),
  };
}

/** Lines matching any of the "|"-separated terms (case-insensitive), plus files whose path matches. */
export async function searchCode(query: unknown, folder: unknown, limit: number) {
  const terms = (typeof query === "string" ? query : "").split("|").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) throw new Error("Give some text to search for.");
  const { files, commit } = await code();
  const f = norm(folder);
  const hits: { path: string; line: number; text: string }[] = [];
  const perFile = new Map<string, number>();
  const paths: string[] = [];
  for (const [path, text] of files) {
    if (f && !path.startsWith(f)) continue;
    if (terms.some((t) => path.toLowerCase().includes(t))) paths.push(path);
    text.split("\n").forEach((l, i) => {
      if (!terms.some((t) => l.toLowerCase().includes(t))) return;
      perFile.set(path, (perFile.get(path) ?? 0) + 1);
      if (hits.length < limit) hits.push({ path, line: i + 1, text: l.trim().slice(0, 240) });
    });
  }
  const total = [...perFile.values()].reduce((s, n) => s + n, 0);
  return {
    commit, matches: total,
    files: [...perFile].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([path, n]) => ({ path, matches: n })),
    ...(paths.length ? { path_matches: paths.slice(0, 40) } : {}),
    lines: hits,
    ...(total > hits.length ? { note: `First ${hits.length} of ${total} lines — narrow the search or the folder.` } : {}),
  };
}

/** A file's lines (numbered), at most 400 per call. */
export async function readCode(path: unknown, from: unknown, to: unknown) {
  const { files, commit } = await code();
  const p = norm(path);
  const text = files.get(p);
  if (text == null) {
    const near = [...files.keys()].filter((k) => k.endsWith("/" + p.split("/").pop())).slice(0, 10);
    throw new Error(`No file "${p}".${near.length ? " Did you mean: " + near.join(", ") : " Use search_code or list_code to find it."}`);
  }
  const lines = text.split("\n");
  const a = Math.max(1, Math.floor(Number(from) || 1));
  const b = Math.min(lines.length, Math.floor(Number(to) || a + 399), a + 399);
  return {
    commit, path: p, total_lines: lines.length, from: a, to: b,
    text: lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n"),
    ...(b < lines.length ? { note: `More lines follow — read from ${b + 1}.` } : {}),
  };
}
