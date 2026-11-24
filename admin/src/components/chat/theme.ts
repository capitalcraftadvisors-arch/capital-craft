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
  accentBg: string;          // primary button / user bubble fill     e.g. bg-cc-green
  accentBgHover: string;     // its hover                              hover:bg-cc-green-hover
  accentText: string;        // ✎ / Save / Add / Replace / ✓✓         text-cc-green
  accentBorder: string;      // inline field editor, attached slot     border-cc-green
  accentBorderHover: string; // choice / "+ Add" hover                 hover:border-cc-green
  checkbox: string;          // "Don't have it" tick                   accent-cc-green
  spinner: string;           // spinner ring (two classes)             border-cc-green/30 border-t-cc-green
  ink: string;               // dark headings / card titles            text-cc-ink
  headBg: string;            // card + table header band               bg-cc-wash
  headBorder: string;        // its bottom border                      border-cc-line-soft
  cardBorder: string;        // read card / file chip outline          border-cc-line
  tintBg: string;            // attached slot / file chip fill         bg-cc-mist
  canvas: CSSProperties;     // page background (style={THEME.canvas})
};

/** The extra colours of the two team (admin) chats: header, bubbles, text input. */
export type AdminChatTheme = ChatTheme & {
  headerBg: string;          // chat header bar                        bg-cc-ink
  avatar: string;            // "CC" avatar gradient (two classes)     from-[#2fbd82] to-cc-ink
  liveDot: string;           // dot before the header subtitle         bg-[#5df2ad]
  bar: string;               // progress bar fill                      bg-[#34e39b]
  editRing: string;          // ring on the bubble being edited        ring-[#5df2ad]
  botText: string;           // bot bubble text                        text-[#12271f]
  inkSoft: string;           // date chip text                         text-cc-ink/70
  inkFaint: string;          // name · time line under a user bubble   text-cc-ink/60
  accentBorderHalf: string;  // empty document slot hover              hover:border-cc-green/50
  tintBgHover: string;       // choice button hover fill               hover:bg-cc-mist
  focusBorder: string;       // text input focus border                focus:border-cc-green
  focusRing: string;         // text input focus ring                  focus:ring-cc-green/15
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
  accentBg: "bg-cc-green",
  accentBgHover: "hover:bg-cc-green-hover",
  accentText: "text-cc-green",
  accentBorder: "border-cc-green",
  accentBorderHover: "hover:border-cc-green",
  checkbox: "accent-cc-green",
  spinner: "border-cc-green/30 border-t-cc-green",
  ink: "text-cc-ink",
  headBg: "bg-cc-wash",
  headBorder: "border-cc-line-soft",
  cardBorder: "border-cc-line",
  tintBg: "bg-cc-mist",
  canvas: doodleCanvas("#0f3d2e", "#e7f0ea"),
  headerBg: "bg-cc-ink",
  avatar: "from-[#2fbd82] to-cc-ink",
  liveDot: "bg-[#5df2ad]",
  bar: "bg-[#34e39b]",
  editRing: "ring-[#5df2ad]",
  botText: "text-[#12271f]",
  inkSoft: "text-cc-ink/70",
  inkFaint: "text-cc-ink/60",
  accentBorderHalf: "hover:border-cc-green/50",
  tintBgHover: "hover:bg-cc-mist",
  focusBorder: "focus:border-cc-green",
  focusRing: "focus:ring-cc-green/15",
};

/** admin/epc/intake — the team's EPC onboarding chat (blue). */
export const EPC_INTAKE_THEME: AdminChatTheme = {
  accentBg: "bg-cc-blue",
  accentBgHover: "hover:bg-cc-blue-dark",
  accentText: "text-cc-blue",
  accentBorder: "border-cc-blue",
  accentBorderHover: "hover:border-cc-blue",
  checkbox: "accent-cc-blue", // not rendered — this chat has no document table
  spinner: "border-cc-blue/30 border-t-cc-blue",
  ink: "text-cc-blue-ink",
  headBg: "bg-[#eaf2fb]",
  headBorder: "border-[#dbe8f7]",
  cardBorder: "border-[#c6ddf3]",
  tintBg: "bg-[#f5f9fe]",
  canvas: doodleCanvas("#0f3a66", "#e9f1fb"),
  headerBg: "bg-cc-blue-ink",
  avatar: "from-[#2f86cf] to-cc-blue-ink",
  liveDot: "bg-[#7cc5f5]",
  bar: "bg-[#3f9be8]",
  editRing: "ring-[#7cc5f5]",
  botText: "text-[#0d2744]",
  inkSoft: "text-cc-blue-ink/70",
  inkFaint: "text-cc-blue-ink/60",
  accentBorderHalf: "hover:border-cc-blue/50",
  tintBgHover: "hover:bg-[#f5f9fe]",
  focusBorder: "focus:border-cc-blue",
  focusRing: "focus:ring-cc-blue/15",
};

/** dashboard/apply/chat + dashboard/insurance/[id]/chat — the Partner Portal chats (navy). */
export const PARTNER_THEME: ChatTheme = {
  accentBg: "bg-navy",
  accentBgHover: "hover:bg-navy-hover",
  accentText: "text-navy",
  accentBorder: "border-navy",
  accentBorderHover: "hover:border-navy",
  checkbox: "accent-navy",
  spinner: "border-navy/30 border-t-navy",
  ink: "text-navy-ink",
  headBg: "bg-navy-wash",
  headBorder: "border-[#dbe4f6]",
  cardBorder: "border-navy-line",
  tintBg: "bg-navy-soft",
  canvas: { background: "linear-gradient(160deg,#f5f8fe 0%,#e9f0fc 100%)" }, // both pages had this exact gradient
};
