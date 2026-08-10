// Applicant-photo grandfather rule (shared by the loan view + Step 1).
//
// Applications created BEFORE the cutover accept the Aadhaar face
// (aadhaar_face_path) as the applicant photo — they were onboarded before a
// dedicated passport-size photo was required, so forcing a re-upload would
// block them. Applications created ON/AFTER the cutover MUST have a real
// uploaded customer_photo; the Aadhaar face does NOT count for them.
//
// Keeping this in one place ensures the Doc-Sent gate, the profile's document
// tile, and the Step-1 "photo required" check all agree.

export const APPLICANT_PHOTO_AADHAAR_CUTOVER_MS = Date.parse("2026-08-10T08:40:08Z");

export function aadhaarFaceCountsAsPhoto(
  loan: { created_at?: string | null; aadhaar_face_path?: string | null },
): boolean {
  return !!loan.aadhaar_face_path
    && !!loan.created_at
    && Date.parse(loan.created_at) < APPLICANT_PHOTO_AADHAAR_CUTOVER_MS;
}
