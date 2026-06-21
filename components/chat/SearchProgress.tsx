const shoppingProgressSteps = [
  "Understanding the shopping goal",
  "Calling Kapruka commerce tools",
  "Ranking price, stock, and fit",
  "Preparing the next best action",
];

type Props = {
  query?: string;
  steps?: string[];
};

function looksLikeShoppingQuery(query: string) {
  const normalized = query.toLowerCase();

  return (
    /\b(?:buy|shop|shopping|product|item|price|budget|under|below|rs|lkr|delivery|cart|checkout|order|gift|cake|flower|flowers|electronics|grocery|groceries|fashion|home|supplement|vitamin|headphone|earbud|phone|laptop|toy|hamper)\b/.test(
      normalized
    ) || /\b\d{3,}\b/.test(normalized)
  );
}

export function SearchProgress({ query = "", steps }: Props) {
  const isShoppingQuery = looksLikeShoppingQuery(query);
  const visibleSteps = steps && steps.length > 0 ? steps : shoppingProgressSteps;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-fit max-w-full"
    >
      <div className="inline-flex max-w-full items-center gap-3 rounded-[28px] rounded-bl-md border border-white/[0.06] bg-slate-800 px-5 py-4 shadow-sm">
        <div className="search-wave-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {isShoppingQuery && (
          <div className="grid min-w-0 overflow-hidden text-base text-slate-300">
            {visibleSteps.map((step, index) => (
              <p
                key={step}
                className="search-progress-step col-start-1 row-start-1 truncate"
                style={{
                  animationDelay: `${index * 1400}ms`,
                }}
              >
                {step}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
