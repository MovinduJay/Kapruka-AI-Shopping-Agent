export function SearchProgress() {
  return (
    <div role="status" aria-label="Loading" className="w-fit max-w-full">
      <div className="inline-flex items-center rounded-[22px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-4 py-2.5 shadow-sm">
        <div className="search-wave-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
