"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  Truck,
  X,
  XCircle,
} from "lucide-react";

export type DeliveryResult = {
  city: string;
  checkedDate: string;
  available: boolean;
  fee: number | null;
  currency: string;
  reason: string | null;
  earliestDate: string | null;
  warning: string | null;
};

type DeliveryCitySuggestion = {
  name: string;
  aliases?: string[];
};

type Props = {
  open: boolean;
  productId?: string;
  onClose: () => void;
  onContinueToCheckout?: (result: DeliveryResult) => void;
};

function getSriLankaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(`${date}T12:00:00+05:30`));
}

function parseDateValue(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(year, month - 1, day, 12);
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCalendarDays(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1, 12);
  const gridStart = new Date(firstDay);

  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function DeliveryPanel({
  open,
  productId,
  onClose,
  onContinueToCheckout,
}: Props) {
  const [city, setCity] = useState("");
  const [selectedDeliveryCity, setSelectedDeliveryCity] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = parseDateValue(getSriLankaDate());
    return new Date(today.getFullYear(), today.getMonth(), 1, 12);
  });
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [error, setError] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<
    DeliveryCitySuggestion[]
  >([]);
  const [cityLookupLoading, setCityLookupLoading] = useState(false);
  const [cityInputFocused, setCityInputFocused] = useState(false);
  const [dateCheckLoading, setDateCheckLoading] = useState(false);
  const minimumDate = getSriLankaDate();
  const minimumMonth = parseDateValue(minimumDate);
  const calendarDays = getCalendarDays(calendarMonth);
  const monthLabel = new Intl.DateTimeFormat("en-LK", {
    month: "long",
    year: "numeric",
  }).format(calendarMonth);
  const canGoToPreviousMonth =
    calendarMonth.getFullYear() > minimumMonth.getFullYear() ||
    calendarMonth.getMonth() > minimumMonth.getMonth();
  const showCitySuggestions =
    cityInputFocused && (cityLookupLoading || citySuggestions.length > 0);
  const deliveryCity = selectedDeliveryCity.trim() || city.trim();
  const canCheckDate = deliveryCity.length >= 2;

  useEffect(() => {
    const query = city.trim();

    if (query.length < 1) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCityLookupLoading(true);

      try {
        const response = await fetch(
          `/api/delivery?${new URLSearchParams({ query }).toString()}`,
          { signal: controller.signal }
        );
        const data = (await response.json()) as {
          cities?: DeliveryCitySuggestion[];
        };

        if (!controller.signal.aborted) {
          setCitySuggestions(response.ok ? data.cities || [] : []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCitySuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setCityLookupLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [city]);

  async function selectDeliveryDate(date: Date) {
    const value = toDateValue(date);

    if (value < minimumDate || dateCheckLoading) return;

    if (date.getMonth() !== calendarMonth.getMonth()) {
      setCalendarMonth(
        new Date(date.getFullYear(), date.getMonth(), 1, 12)
      );
    }

    setDeliveryDate(value);
    setError("");
    setResult(null);

    if (!canCheckDate) {
      setError("Choose a delivery city before checking a date.");
      return;
    }

    setDateCheckLoading(true);

    try {
      const response = await fetch("/api/delivery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          city: deliveryCity,
          deliveryDate: value,
          productId,
        }),
      });
      const data = (await response.json()) as {
        result?: DeliveryResult;
        error?: string;
      };

      if (!response.ok || !data.result) {
        throw new Error(data.error || "Could not check delivery.");
      }

      setResult(data.result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not check delivery."
      );
    } finally {
      setDateCheckLoading(false);
    }
  }

  function changeMonth(offset: number) {
    setResult(null);
    setError("");
    setCalendarMonth(
      (current) =>
        new Date(
          current.getFullYear(),
          current.getMonth() + offset,
          1,
          12
        )
    );
  }

  function selectToday() {
    const today = parseDateValue(minimumDate);
    setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12));
    selectDeliveryDate(today);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close delivery panel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-panel-title"
        className="relative flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-white/10 px-6 py-6">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-purple-300">
              <Truck size={18} />
              Delivery check
            </div>
            <h2 id="delivery-panel-title" className="text-2xl font-bold">
              Where should we send it?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Check availability and fees for Sri Lanka or overseas delivery
              before entering checkout details.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="panel-close-button rounded-xl p-2 transition"
            aria-label="Close delivery panel"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-5">
            <label className="relative block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <MapPin size={16} className="text-purple-300" />
                Delivery City
              </span>
              <input
                value={city}
                onChange={(event) => {
                  const nextCity = event.target.value;

                  setCity(nextCity);
                  setSelectedDeliveryCity("");
                  if (!nextCity.trim()) {
                    setCitySuggestions([]);
                    setCityLookupLoading(false);
                  }
                  setDeliveryDate("");
                  setResult(null);
                  setError("");
                }}
                onFocus={() => setCityInputFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setCityInputFocused(false), 120);
                }}
                autoComplete="address-level2"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-purple-400/70 focus:ring-4 focus:ring-purple-500/10"
              />
              {showCitySuggestions && (
                <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
                  {cityLookupLoading ? (
                    <div className="px-4 py-3 text-sm text-slate-400">
                      Loading cities...
                    </div>
                  ) : (
                    <div role="listbox" className="max-h-56 overflow-y-auto py-1">
                      {citySuggestions.map((suggestion) => (
                        <button
                          key={suggestion.name}
                          type="button"
                          role="option"
                          aria-selected={suggestion.name === city}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setCity(suggestion.name);
                            setSelectedDeliveryCity(suggestion.name);
                            setCitySuggestions([]);
                            setCityInputFocused(false);
                            setDeliveryDate("");
                            setResult(null);
                            setError("");
                          }}
                          className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"
                        >
                          {suggestion.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <CalendarDays size={16} className="text-purple-300" />
                  Delivery date
                </span>

                {dateCheckLoading ? (
                  <span className="text-xs font-medium text-slate-400">
                    Checking date...
                  </span>
                ) : deliveryDate ? (
                  <span className="text-xs font-medium text-purple-300">
                    {formatDate(deliveryDate)}
                  </span>
                ) : null}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => changeMonth(-1)}
                    disabled={!canGoToPreviousMonth}
                    className="rounded-xl p-2 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                    aria-label="Previous month"
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <p className="text-sm font-bold text-white">{monthLabel}</p>

                  <button
                    type="button"
                    onClick={() => changeMonth(1)}
                    className="rounded-xl p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                    aria-label="Next month"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day) => (
                      <span key={day} className="py-1">
                        {day}
                      </span>
                    )
                  )}
                </div>

                <div
                  role="grid"
                  aria-label={`Choose a delivery date in ${monthLabel}`}
                  className="mt-1 grid grid-cols-7 gap-1"
                >
                  {calendarDays.map((date) => {
                    const value = toDateValue(date);
                    const isCurrentMonth =
                      date.getMonth() === calendarMonth.getMonth();
                    const isPast = value < minimumDate;
                    const isSelected = value === deliveryDate;
                    const isToday = value === minimumDate;
                    const canSelectDate =
                      isCurrentMonth && !isPast && !dateCheckLoading;

                    return (
                      <button
                        key={value}
                        type="button"
                        role="gridcell"
                        aria-selected={isSelected}
                        aria-label={formatDate(value)}
                        disabled={!canSelectDate}
                        onClick={() => selectDeliveryDate(date)}
                        className={`relative flex aspect-square items-center justify-center rounded-xl text-sm font-medium transition ${
                          isSelected
                            ? "bg-purple-100 text-slate-950 shadow-lg shadow-purple-300/30"
                            : isPast || !isCurrentMonth
                              ? "cursor-not-allowed text-slate-600"
                              : "bg-white/[0.055] text-slate-100 hover:bg-purple-300/20 hover:text-white"
                        }`}
                      >
                        {isSelected && dateCheckLoading ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          date.getDate()
                        )}
                        {isToday && !isSelected && (
                          <span className="absolute top-1 h-1 w-1 rounded-full bg-slate-300" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                  <p className="text-xs text-slate-500">
                    Click any future date to check availability
                  </p>
                  <button
                    type="button"
                    onClick={selectToday}
                    disabled={dateCheckLoading}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-400/10 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
                  >
                    Today
                  </button>
                </div>
              </div>
            </div>

            {!result && canCheckDate && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-400">
                Pick the date you want. If Kapruka cannot deliver on that day,
                we will show it as not available.
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm leading-6 text-rose-200"
              >
                {error}
              </div>
            )}

            {result && (
              <div
                className={`rounded-3xl border p-5 ${
                  result.available
                    ? "border-purple-400/30 bg-purple-500/10"
                    : "border-amber-400/30 bg-amber-500/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  {result.available ? (
                    <CheckCircle2
                      size={24}
                      className="mt-0.5 shrink-0 text-purple-300"
                    />
                  ) : (
                    <XCircle
                      size={24}
                      className="mt-0.5 shrink-0 text-amber-300"
                    />
                  )}

                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {result.available
                        ? "Delivery is available"
                        : "Not available on this date"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">
                      {result.city} on {formatDate(result.checkedDate)}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-950/35 p-4">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">
                      Delivery fee
                    </dt>
                    <dd className="mt-1 text-lg font-bold text-white">
                      {result.fee === null
                        ? "Unavailable"
                        : `Rs. ${result.fee.toLocaleString()}`}
                    </dd>
                  </div>

                  <div className="rounded-2xl bg-slate-950/35 p-4">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">
                      Earliest date
                    </dt>
                    <dd className="mt-1 text-sm font-bold text-white">
                      {result.available
                        ? formatDate(result.checkedDate)
                        : result.earliestDate
                          ? formatDate(result.earliestDate)
                          : "Not provided"}
                    </dd>
                  </div>
                </dl>

                {result.reason && (
                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    {result.reason}
                  </p>
                )}

                {result.warning && (
                  <p className="mt-4 rounded-2xl bg-amber-400/10 p-4 text-xs leading-5 text-amber-100">
                    {result.warning}
                  </p>
                )}

                {result.available && (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-xs text-slate-400">
                      Delivery confirmed. Address and checkout details come next.
                    </p>

                    {onContinueToCheckout && (
                      <button
                        type="button"
                        onClick={() => onContinueToCheckout(result)}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-400"
                      >
                        Continue to checkout details
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
