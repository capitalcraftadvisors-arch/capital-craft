// Postgres SQLSTATE 42703 = undefined_column.
//
// A column introduced by a migration that hasn't been applied to prod yet
// (e.g. epc_applications.lead_owner_name from 0074, blocked by the Supabase
// Free-plan restriction) must never break a read or a write. Pattern:
// query WITH the column; if the DB replies 42703, retry WITHOUT it. This
// self-heals the moment the migration runs — no redeploy needed.

export const UNDEFINED_COLUMN = "42703";

type PgErr = { code?: string | null; message?: string | null } | null | undefined;

// True when `err` is "column does not exist" (optionally for a specific column).
export function isUndefinedColumn(err: PgErr, col?: string): boolean {
  if (!err || err.code !== UNDEFINED_COLUMN) return false;
  return col ? String(err.message ?? "").includes(col) : true;
}

// Shallow copy of `obj` without the given keys.
export function omitKeys<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out as Partial<T>;
}
