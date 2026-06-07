import { ScanSearch, Store } from "lucide-react";

export function SearchProgress() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full max-w-2xl space-y-2"
    >
      <div className="w-fit rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-5 py-3 text-sm text-slate-200 shadow-sm">
        Finding the best options on Kapruka...
      </div>

      <div className="rounded-[28px] border border-white/[0.08] bg-slate-800 px-5 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-emerald-500/15 p-2 text-emerald-300">
            <Store size={18} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">
              Searching Kapruka marketplace
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Checking matching products, prices, availability, and seller
              listings.
            </p>
          </div>

          <ScanSearch
            size={20}
            className="shrink-0 animate-pulse text-emerald-300"
          />
        </div>
      </div>
    </div>
  );
}
