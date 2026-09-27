"use client";

// Admin — full-page "Message to EPC" window for a loan profile. Opened from the
// profile rail (Message to EPC). Two panels: the message thread on the left, and
// on the right the SAME edit table the EPC sees. The team writes a message AND
// ticks the rows to open for editing — a message can't be sent until at least
// one row is ticked. Those ticked rows become the EPC's edit grant (0085): the
// EPC's edit chatbot then shows exactly those rows and nothing else.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import MessageThread from "@/components/MessageThread";
import EditTable, { editGroups } from "@/components/EditTable";
import { hydrateLoanForm, type LoanForm, type LoanDocRow } from "@/lib/loan-form";
import { invalidate } from "@/lib/list-cache";
import { epcUpdatesKey } from "@/lib/use-epc-updates";

export default function AdminLoanMessagesPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [ctx, setCtx] = useState<{ name: string; ref: string } | null>(null);
  const [form, setForm] = useState<LoanForm | null>(null);
  const [docRows, setDocRows] = useState<LoanDocRow[]>([]);
  const [sel, setSel] = useState<string[]>([]);

  useEffect(() => {
    // Opening the thread marks it seen for this admin → refresh the console's
    // per-admin unseen counts when they return.
    invalidate(epcUpdatesKey());
    void (async () => {
      const { form: f, docRows: rows, row } = await hydrateLoanForm(id);
      setForm(f); setDocRows(rows);
      setCtx({ name: row.borrower_name || row.aadhaar_name || "(unnamed)", ref: row.loan_display_id || id.slice(0, 8).toUpperCase() });
    })();
  }, [id]);

  const allKeys = form ? editGroups(form, docRows).flatMap((g) => g.items.map((i) => i.key)) : [];

  return (
    <main className="min-h-screen bg-bg-soft">
      <div className="max-w-[1180px] mx-auto px-5 sm:px-7 py-8">
        <button onClick={() => router.push(`/admin/app/${id}/view` as any)} className="text-[13px] text-text-muted hover:text-[#0f3d2e] mb-3">← Back to profile</button>
        <div className="mb-5">
          <h1 className="font-display text-[24px] font-bold text-[#0f3d2e]">Message to EPC</h1>
          <p className="text-[13.5px] text-text-mid mt-0.5">
            {ctx ? <>{ctx.name} · <span className="font-mono text-[#185fa5]">{ctx.ref}</span></> : "…"} — write the message and tick the rows to open for editing.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_400px] items-start">
          {/* Thread + composer */}
          <MessageThread
            kind="loan" id={id} role="admin"
            sendKeys={sel} requireKeys onSent={() => setSel([])}
          />

          {/* The edit table — what the EPC is allowed to change */}
          <aside className="rounded-2xl border border-line bg-white overflow-hidden flex flex-col" style={{ maxHeight: "78vh" }}>
            <div className="shrink-0 px-4 py-3 border-b border-line bg-[#f7f9fe]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-[14px] font-bold text-[#14235c]">Open for editing</h2>
                  <p className="text-[11.5px] text-text-muted mt-0.5">The EPC’s edit will show only the ticked rows.</p>
                </div>
                <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[#e8effc] text-[#1e3a8a] shrink-0">{sel.length}</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => setSel(allKeys)} className="text-[11.5px] font-semibold text-[#1e3a8a] hover:underline">Select all</button>
                <button onClick={() => setSel([])} className="text-[11.5px] font-semibold text-text-muted hover:text-[#1e3a8a]">Clear</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {form ? (
                <EditTable appId={id} form={form} docRows={docRows} value={sel} onChange={setSel} />
              ) : (
                <p className="text-[13px] text-text-muted text-center py-10">Loading application…</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
