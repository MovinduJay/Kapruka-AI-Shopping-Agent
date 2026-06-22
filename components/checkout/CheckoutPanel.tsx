"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  X,
} from "lucide-react";
import type { DeliveryResult } from "@/components/delivery/DeliveryPanel";
import type { ProductCard as ProductCardType } from "@/types/product";

type CheckoutForm = {
  recipientName: string;
  recipientPhone: string;
  address: string;
  locationType: "house" | "apartment" | "office" | "other";
  instructions: string;
  senderName: string;
  anonymous: boolean;
  giftMessage: string;
};

type CheckoutResult = {
  checkout_url: string;
  order_ref: string;
  summary: {
    items_total: number;
    delivery_fee: number;
    addons_total: number;
    grand_total: number;
    currency: string;
  };
  expires_at: string;
};

type Props = {
  open: boolean;
  cart: ProductCardType[];
  delivery: DeliveryResult | null;
  onClose: () => void;
};

const initialForm: CheckoutForm = {
  recipientName: "",
  recipientPhone: "",
  address: "",
  locationType: "house",
  instructions: "",
  senderName: "",
  anonymous: false,
  giftMessage: "",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-LK", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(`${date}T12:00:00+05:30`));
}

function formatMoney(amount: number, currency = "LKR") {
  return `${currency === "LKR" ? "Rs. " : `${currency} `}${amount.toLocaleString()}`;
}

export function CheckoutPanel({ open, cart, delivery, onClose }: Props) {
  const [form, setForm] = useState<CheckoutForm>(initialForm);
  const [step, setStep] = useState<"form" | "review" | "pay">("form");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cartTotal = cart.reduce((total, item) => total + (item.price || 0), 0);
  const canReview =
    cart.length > 0 &&
    delivery?.available === true &&
    form.recipientName.trim() &&
    form.recipientPhone.trim() &&
    form.address.trim() &&
    form.senderName.trim();

  function updateField<K extends keyof CheckoutForm>(
    key: K,
    value: CheckoutForm[K]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function createCheckoutLink() {
    if (!delivery || loading || !canReview) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cart: cart.map((item) => ({
            productId: item.id,
            productUrl: item.productUrl,
            name: item.name,
            quantity: 1,
          })),
          recipient: {
            name: form.recipientName,
            phone: form.recipientPhone,
          },
          delivery: {
            address: form.address,
            city: delivery.city,
            date: delivery.checkedDate,
            locationType: form.locationType,
            instructions: form.instructions,
          },
          sender: {
            name: form.senderName,
            anonymous: form.anonymous,
          },
          giftMessage: form.giftMessage,
        }),
      });
      const data = (await response.json()) as {
        result?: CheckoutResult;
        error?: string;
      };

      if (!response.ok || !data.result) {
        throw new Error(data.error || "Could not create checkout link.");
      }

      setResult(data.result);
      setStep("pay");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create checkout link."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close checkout panel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-white/10 px-6 py-6">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-purple-300">
              <ShieldCheck size={18} />
              Explicit checkout
            </div>
            <h2 id="checkout-title" className="text-2xl font-bold">
              {step === "pay"
                ? "Demo checkout complete"
                : "Review checkout details"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              The order is not confirmed unless the checkout link is paid.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close checkout panel"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-6 grid grid-cols-3 gap-2 text-xs font-semibold">
            {["Cart", "Delivery checked", "Checkout"].map((label, index) => (
              <div
                key={label}
                className={`rounded-2xl border p-3 ${
                  index < 2 || step !== "form"
                    ? "border-purple-400/30 bg-purple-500/10 text-purple-300"
                    : "border-white/10 bg-white/[0.04] text-slate-400"
                }`}
              >
                {label}
              </div>
            ))}
          </div>

          {!delivery?.available && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              Check delivery first before checkout.
            </div>
          )}

          {step === "form" && delivery?.available && (
            <div className="space-y-5">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h3 className="font-semibold text-white">
                  Delivery confirmed
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  {delivery.city} on {formatDate(delivery.checkedDate)}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Fee:{" "}
                  {delivery.fee === null
                    ? "Unavailable"
                    : formatMoney(delivery.fee)}
                </p>
              </div>

              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Recipient name
                  </span>
                  <input
                    value={form.recipientName}
                    onChange={(event) =>
                      updateField("recipientName", event.target.value)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Recipient phone
                  </span>
                  <input
                    value={form.recipientPhone}
                    onChange={(event) =>
                      updateField("recipientPhone", event.target.value)
                    }
                    placeholder="0771234567 or +94771234567"
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Delivery address
                  </span>
                  <textarea
                    value={form.address}
                    onChange={(event) =>
                      updateField("address", event.target.value)
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Location type
                  </span>
                  <select
                    value={form.locationType}
                    onChange={(event) =>
                      updateField(
                        "locationType",
                        event.target.value as CheckoutForm["locationType"]
                      )
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  >
                    <option value="house">House</option>
                    <option value="apartment">Apartment</option>
                    <option value="office">Office</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Delivery instructions
                  </span>
                  <textarea
                    value={form.instructions}
                    onChange={(event) =>
                      updateField("instructions", event.target.value)
                    }
                    rows={2}
                    placeholder="Gate code, call before delivery, etc."
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Your name
                  </span>
                  <input
                    value={form.senderName}
                    onChange={(event) =>
                      updateField("senderName", event.target.value)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.anonymous}
                    onChange={(event) =>
                      updateField("anonymous", event.target.checked)
                    }
                  />
                  Show sender as Anonymous
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">
                    Gift message, optional
                  </span>
                  <textarea
                    value={form.giftMessage}
                    onChange={(event) =>
                      updateField("giftMessage", event.target.value)
                    }
                    rows={2}
                    maxLength={300}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm outline-none focus:border-purple-400/70"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => setStep("review")}
                disabled={!canReview}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PackageCheck size={18} />
                Review checkout details
              </button>
            </div>
          )}

          {step === "review" && delivery && (
            <div className="space-y-5">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h3 className="font-semibold text-white">Final check</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Create the Kapruka guest-checkout link only after the user
                  confirms these details.
                </p>
              </div>

              <div className="space-y-3">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                  >
                    <p className="text-sm font-semibold text-white">
                      {item.name}
                    </p>
                    <p className="mt-1 text-sm text-purple-300">
                      {item.price === null
                        ? "Price unavailable"
                        : formatMoney(item.price)}
                    </p>
                  </div>
                ))}
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <dt className="text-xs text-slate-400">Items</dt>
                  <dd className="mt-1 font-bold text-white">
                    {formatMoney(cartTotal)}
                  </dd>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <dt className="text-xs text-slate-400">Delivery</dt>
                  <dd className="mt-1 font-bold text-white">
                    {delivery.fee === null
                      ? "Checked"
                      : formatMoney(delivery.fee)}
                  </dd>
                </div>
              </dl>

              <div className="rounded-3xl border border-purple-400/30 bg-purple-500/10 p-5">
                <p className="text-sm text-slate-300">Estimated total</p>
                <p className="mt-1 text-2xl font-bold text-purple-300">
                  {formatMoney(cartTotal + (delivery.fee || 0))}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Kapruka will return the final locked total with the payment
                  link.
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm text-rose-200">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  disabled={loading}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
                >
                  Edit details
                </button>

                <button
                  type="button"
                  onClick={createCheckoutLink}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <>
                      <LoaderCircle size={18} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <CreditCard size={18} />
                      Create checkout link
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "pay" && result && (
            <div className="space-y-5">
              <div className="rounded-3xl border border-purple-400/30 bg-purple-500/10 p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 text-purple-300" />
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Checkout link created
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">
                      Checkout reference: {result.order_ref}
                    </p>
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <dt className="text-xs text-slate-400">Grand total</dt>
                  <dd className="mt-1 font-bold text-white">
                    {formatMoney(
                      result.summary.grand_total,
                      result.summary.currency
                    )}
                  </dd>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <dt className="text-xs text-slate-400">Expires</dt>
                  <dd className="mt-1 text-sm font-bold text-white">
                    {new Date(result.expires_at).toLocaleString()}
                  </dd>
                </div>
              </dl>

              <a
                href={result.checkout_url}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-purple-400"
              >
                <ExternalLink size={18} />
                Open secure payment link
              </a>

              <p className="text-xs leading-5 text-slate-400">
                This is the end of the demo flow. Do not enter card details.
                This checkout reference is not a confirmed order number and
                cannot be used for order tracking. Kapruka provides the actual
                order number only after a real payment.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
