// Aadhaar masking — pure, no imports, so light routes can use it without
// loading lib/aadhaar (which pulls in sharp, GCS, Vision and Gemini).

// Example: maskAadhaar("123456789012") -> "xxxxxxxx9012". null unless 12 digits.
export function maskAadhaar(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return "xxxxxxxx" + digits.slice(-4);
}
