// Shared pieces of the loan forms — the team's 6-step form (admin/app/[id]/step-1..6)
// and the partner's classic registration page (dashboard/apply). See each file:
//   StepChrome — header, loading / not-found, tracker, title, Previous/Next bar
//   Fields     — section card, error box, pill, icons, checkbox row, address box
//   Choices    — the dot-in-the-corner choice cards (system type, plant use …)
//   Docs       — the "file on record" box + the hidden file picker
//   requests   — save a step, send files to OCR, pincode lookup, where Next goes

export * from "./StepChrome";
export * from "./Fields";
export * from "./Choices";
export * from "./Docs";
export * from "./requests";
