// Chat kit · the small types the step-by-step chats share.
//
//   Choice, Form   all three chats with choice buttons: admin/app/intake,
//                  admin/epc/intake, dashboard/apply/chat
//   Fetched        admin/app/intake, admin/epc/intake (+ FieldRows in DocSlotTable.tsx)
//   ReadConfirm    the two team chats' "Read from the document" card state
//   FileReceipt    a document shown in a bubble — ChatMsg here, and the
//                  Partner Portal chats' own message types
//   ChatMsg        the two team chats: admin/app/intake, admin/epc/intake
//
// Each chat's `Turn` (its script) and the Partner Portal chats' message shapes
// are different per chat and stay in the page.

/** One button in a choice turn. */
export type Choice = { value: string; label: string; sub?: string };

/** The chat's answers so far — every value kept as a string. */
export type Form = Record<string, string>;

/** One value read off a document. `field` = the form key it fills (then it is editable). */
export type Fetched = { label: string; value: string; ok: boolean; field?: string };

/** The card shown right after a read (ConfirmCard): the values, a note, the thumbnails; `edit` = replacing an earlier document. */
export type ReadConfirm = { fields: Fetched[]; note: string; thumbs: (string | null)[]; edit?: boolean };

/** A document shown in a user bubble — `thumb` is a blob: URL (null after a reload). */
export type FileReceipt = { name: string; thumb: string | null };

/** A message in the team chats (admin/app/intake, admin/epc/intake). */
export type ChatMsg = {
  id: string;
  from: "bot" | "user";
  text?: string;
  time: string;        // "4:05 pm" — "" on an answer replayed from the saved profile
  turnId?: string;
  field?: string;
  editable?: boolean;
  edited?: boolean;
  files?: FileReceipt[];  // user document receipt
  fetched?: Fetched[];    // permanent, editable "Read from the document" card
};
