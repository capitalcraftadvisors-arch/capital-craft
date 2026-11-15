// A chatbot's in-progress state, kept in this browser so a refresh (e.g. while
// a slow OCR runs) or a closed tab continues exactly where it stopped — the
// chat up to the last answer, every document read so far. localStorage only:
// no request, nothing on the server. Each chat clears its draft when it's done.

export function loadChatDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

/** Saves `value`; when the browser is out of room, saves `fallback` (a smaller copy) instead. */
export function saveChatDraft(key: string, value: unknown, fallback?: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch {
    try { if (fallback !== undefined) localStorage.setItem(key, JSON.stringify(fallback)); } catch { /* full or blocked */ }
  }
}

export function clearChatDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* blocked */ }
}

/** Chat bubbles with their document thumbnails dropped (a thumbnail's blob: URL
 *  doesn't survive a reload) — the file names stay. */
export function withoutThumbs<M extends { files?: { name: string; thumb: string | null }[] }>(msgs: M[]): M[] {
  return msgs.map((m) => (m.files ? { ...m, files: m.files.map((f) => ({ name: f.name, thumb: null })) } : m));
}
