// Shown to the team where lender actions would be, while an EPC profile they
// approved waits for the main admin's check (lib/review epcLocked).
export default function AdminPendingPill() {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap bg-[#fef0d6] text-[#854f0b]">
      Pending admin
    </span>
  );
}
