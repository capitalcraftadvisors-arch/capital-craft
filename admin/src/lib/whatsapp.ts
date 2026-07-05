// WhatsApp confirmation sender for the Loan Application Step 1 flow.
//
// STATUS: STUB. The exported sendWhatsAppConfirmation() function
// currently returns success immediately without contacting any
// provider. All surrounding code (API route, DB schema, client
// UX) is production-shape — swapping the stub for the real
// AiSensy call is a ONE-LINE change inside sendWhatsAppConfirmation
// (see the TODO(aisensy) comment).
//
// When you activate AiSensy:
//   1. Set AISENSY_API_KEY in Cloud Run env.
//   2. Fill in the campaign name + template params in _sendViaAiSensy.
//   3. Replace `return _stubSend(p)` with `return _sendViaAiSensy(p)`.
// The public shape (ConfirmationPayload / ConfirmationResult) does
// not change — no rewiring needed anywhere else.

export type ConfirmationPayload = {
  applicationId: string;
  borrowerName:  string | null;
  borrowerMobile: string;   // 10 digits, no country code
  epcName:       string | null;
};

export type ConfirmationResult = {
  ok: boolean;
  // `stub: true` is present only while the stub is active — a
  // convenient signal for callers/tests. Remove once AiSensy is live.
  stub: boolean;
  provider_message_id: string | null;
  error: string | null;
};

export async function sendWhatsAppConfirmation(
  p: ConfirmationPayload,
): Promise<ConfirmationResult> {
  // TODO(aisensy): replace with `return _sendViaAiSensy(p);`
  // once AISENSY_API_KEY is configured on Cloud Run.
  return _stubSend(p);
}

async function _stubSend(_p: ConfirmationPayload): Promise<ConfirmationResult> {
  return {
    ok: true,
    stub: true,
    provider_message_id: `stub-${Date.now()}`,
    error: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _sendViaAiSensy(p: ConfirmationPayload): Promise<ConfirmationResult> {
  // Placeholder for the real integration. The exact request shape
  // depends on which AiSensy endpoint you use (Campaign API vs the
  // newer Message API); this outline uses the Campaign API pattern.
  //
  // const apiKey = process.env.AISENSY_API_KEY;
  // if (!apiKey) {
  //   return { ok: false, stub: false, provider_message_id: null, error: "AISENSY_API_KEY not set" };
  // }
  //
  // const res = await fetch("https://backend.aisensy.com/campaign/t1/api", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     apiKey,
  //     campaignName: "loan_app_confirmation",
  //     destination: `91${p.borrowerMobile}`,
  //     userName: p.borrowerName ?? "Customer",
  //     templateParams: [p.applicationId, p.epcName ?? ""],
  //   }),
  // });
  // const json: unknown = await res.json().catch(() => ({}));
  // const messageId = (json as { messageId?: string })?.messageId ?? null;
  // const errorMsg  = (json as { error?: string })?.error ?? null;
  //
  // return {
  //   ok: res.ok,
  //   stub: false,
  //   provider_message_id: messageId,
  //   error: res.ok ? null : (errorMsg ?? `HTTP ${res.status}`),
  // };
  throw new Error("_sendViaAiSensy not implemented");
}
