import type { CSSProperties } from "react";

// Chat kit · colours.
//
// Each chat keeps its OWN palette. The kit components take one of these objects
// as their `theme` prop and drop the classes into the same places the chats had
// them, so the rendered class lists are exactly what each page had before.
//
// Every class value is written out WHOLE, copied verbatim from the chat it
// belongs to (a few hold two classes, e.g. `spinner`) — Tailwind only generates
// a class it can read as literal text in the source, so never build one from
// pieces (no `bg-[${hex}]`). `canvas` is the page background as a style object.
//
//   LOAN_INTAKE_THEME  admin/app/intake              team loan chat (green)
//   EPC_INTAKE_THEME   admin/epc/intake              team EPC onboarding chat (blue)
//   PARTNER_THEME      dashboard/apply/chat          Partner Portal loan chat (navy)
//                      dashboard/insurance/[id]/chat Partner Portal insurance chat (navy)
//
// Classes that appear only in one page's own markup stay in that page, as written.

/** Colours the kit pieces shared by the team chats AND the Partner Portal chats use. */
export type ChatTheme = {
  accentBg: string;          // primary button / user bubble fill     e.g. bg-[#178a5c]
  accentBgHover: string;     // its hover                              hover:bg-[#12734c]
  accentText: string;        // ✎ / Save / Add / Replace / ✓✓         text-[#178a5c]
  accentBorder: string;      // inline field editor, attached slot     border-[#178a5c]
  accentBorderHover: string; // choice / "+ Add" hover                 hover:border-[#178a5c]
  checkbox: string;          // "Don't have it" tick                   accent-[#178a5c]
  spinner: string;           // spinner ring (two classes)             border-[#178a5c]/30 border-t-[#178a5c]
  ink: string;               // dark headings / card titles            text-[#0f3d2e]
  headBg: string;            // card + table header band               bg-[#f0faf5]
  headBorder: string;        // its bottom border                      border-[#e0f0e8]
  cardBorder: string;        // read card / file chip outline          border-[#cdeadd]
  tintBg: string;            // attached slot / file chip fill         bg-[#f7fcf9]
  canvas: CSSProperties;     // page background (style={THEME.canvas})
};

/** The extra colours of the two team (admin) chats: header, bubbles, text input. */
export type AdminChatTheme = ChatTheme & {
  headerBg: string;          // chat header bar                        bg-[#0f3d2e]
  avatar: string;            // "CC" avatar gradient (two classes)     from-[#2fbd82] to-[#0f3d2e]
  liveDot: string;           // dot before the header subtitle         bg-[#5df2ad]
  bar: string;               // progress bar fill                      bg-[#34e39b]
  editRing: string;          // ring on the bubble being edited        ring-[#5df2ad]
  botText: string;           // bot bubble text                        text-[#12271f]
  inkSoft: string;           // date chip text                         text-[#0f3d2e]/70
  inkFaint: string;          // name · time line under a user bubble   text-[#0f3d2e]/60
  accentBorderHalf: string;  // empty document slot hover              hover:border-[#178a5c]/50
  tintBgHover: string;       // choice button hover fill               hover:bg-[#f7fcf9]
  focusBorder: string;       // text input focus border                focus:border-[#178a5c]
  focusRing: string;         // text input focus ring                  focus:ring-[#178a5c]/15
};

// The WhatsApp-style doodle texture behind the team chats, drawn in the chat's
// dark ink. (The SVG text — spacing included — is the one both pages had.)
function doodleCanvas(ink: string, background: string): CSSProperties {
  const doodle = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='104' height='104' viewBox='0 0 104 104'>
     <g fill='none' stroke='${ink}' stroke-opacity='0.045' stroke-width='1.4'>
       <circle cx='22' cy='24' r='7'/>
       <circle cx='78' cy='66' r='10'/>
       <path d='M74 18 v9 M69.5 22.5 h9'/>
       <path d='M14 78 q8 -10 16 0'/>
       <rect x='58' y='16' width='10' height='10' rx='2'/>
     </g>
     <g fill='${ink}' fill-opacity='0.045'>
       <circle cx='48' cy='50' r='1.8'/>
       <circle cx='92' cy='30' r='1.8'/>
       <circle cx='30' cy='96' r='1.8'/>
     </g>
   </svg>`,
  );
  return { backgroundColor: background, backgroundImage: `url("data:image/svg+xml,${doodle}")` };
}

/** admin/app/intake — the team's loan intake chat (green). */
export const LOAN_INTAKE_THEME: AdminChatTheme = {
  accentBg: "bg-[#178a5c]",
  accentBgHover: "hover:bg-[#12734c]",
  accentText: "text-[#178a5c]",
  accentBorder: "border-[#178a5c]",
  accentBorderHover: "hover:border-[#178a5c]",
  checkbox: "accent-[#178a5c]",
  spinner: "border-[#178a5c]/30 border-t-[#178a5c]",
  ink: "text-[#0f3d2e]",
  headBg: "bg-[#f0faf5]",
  headBorder: "border-[#e0f0e8]",
  cardBorder: "border-[#cdeadd]",
  tintBg: "bg-[#f7fcf9]",
  canvas: doodleCanvas("#0f3d2e", "#e7f0ea"),
  headerBg: "bg-[#0f3d2e]",
  avatar: "from-[#2fbd82] to-[#0f3d2e]",
  liveDot: "bg-[#5df2ad]",
  bar: "bg-[#34e39b]",
  editRing: "ring-[#5df2ad]",
  botText: "text-[#12271f]",
  inkSoft: "text-[#0f3d2e]/70",
  inkFaint: "text-[#0f3d2e]/60",
  accentBorderHalf: "hover:border-[#178a5c]/50",
  tintBgHover: "hover:bg-[#f7fcf9]",
  focusBorder: "focus:border-[#178a5c]",
  focusRing: "focus:ring-[#178a5c]/15",
};

/** admin/epc/intake — the team's EPC onboarding chat (blue). */
export const EPC_INTAKE_THEME: AdminChatTheme = {
  accentBg: "bg-[#185fa5]",
  accentBgHover: "hover:bg-[#124a82]",
  accentText: "text-[#185fa5]",
  accentBorder: "border-[#185fa5]",
  accentBorderHover: "hover:border-[#185fa5]",
  checkbox: "accent-[#185fa5]", // not rendered — this chat has no document table
  spinner: "border-[#185fa5]/30 border-t-[#185fa5]",
  ink: "text-[#0f3a66]",
  headBg: "bg-[#eaf2fb]",
  headBorder: "border-[#dbe8f7]",
  cardBorder: "border-[#c6ddf3]",
  tintBg: "bg-[#f5f9fe]",
  canvas: doodleCanvas("#0f3a66", "#e9f1fb"),
  headerBg: "bg-[#0f3a66]",
  avatar: "from-[#2f86cf] to-[#0f3a66]",
  liveDot: "bg-[#7cc5f5]",
  bar: "bg-[#3f9be8]",
  editRing: "ring-[#7cc5f5]",
  botText: "text-[#0d2744]",
  inkSoft: "text-[#0f3a66]/70",
  inkFaint: "text-[#0f3a66]/60",
  accentBorderHalf: "hover:border-[#185fa5]/50",
  tintBgHover: "hover:bg-[#f5f9fe]",
  focusBorder: "focus:border-[#185fa5]",
  focusRing: "focus:ring-[#185fa5]/15",
};

/** dashboard/apply/chat + dashboard/insurance/[id]/chat — the Partner Portal chats (navy). */
export const PARTNER_THEME: ChatTheme = {
  accentBg: "bg-[#1e3a8a]",
  accentBgHover: "hover:bg-[#17307a]",
  accentText: "text-[#1e3a8a]",
  accentBorder: "border-[#1e3a8a]",
  accentBorderHover: "hover:border-[#1e3a8a]",
  checkbox: "accent-[#1e3a8a]",
  spinner: "border-[#1e3a8a]/30 border-t-[#1e3a8a]",
  ink: "text-[#14235c]",
  headBg: "bg-[#eef3fc]",
  headBorder: "border-[#dbe4f6]",
  cardBorder: "border-[#c7d5f0]",
  tintBg: "bg-[#f4f7fd]",
  canvas: { background: "linear-gradient(160deg,#f5f8fe 0%,#e9f0fc 100%)" }, // both pages had this exact gradient
};
