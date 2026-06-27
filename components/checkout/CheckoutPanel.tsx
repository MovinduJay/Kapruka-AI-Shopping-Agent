"use client";

import { Fragment, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Gift,
  Home,
  ImageIcon,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Phone,
  ShieldCheck,
  ShoppingCart,
  Truck,
  User,
  X,
} from "lucide-react";
import type { DeliveryResult } from "@/components/delivery/DeliveryPanel";
import type { CartItem } from "@/types/product";

export type CheckoutForm = {
  recipientName: string;
  recipientPhone: string;
  address: string;
  locationType: "house" | "apartment" | "office" | "other";
  instructions: string;
  senderName: string;
  anonymous: boolean;
  giftMessage: string;
};

export type CheckoutResult = {
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

export type CheckoutStep = "form" | "review" | "pay";

export type CheckoutState = {
  form: CheckoutForm;
  step: CheckoutStep;
  result: CheckoutResult | null;
};

export type CheckoutProgressTarget = "cart" | "delivery" | "date" | "checkout";

type Props = {
  open: boolean;
  cart: CartItem[];
  delivery: DeliveryResult | null;
  checkoutState: CheckoutState;
  onCheckoutStateChange: (state: CheckoutState) => void;
  onProgressStepClick: (target: CheckoutProgressTarget) => void;
  onClose: () => void;
};

export const initialCheckoutForm: CheckoutForm = {
  recipientName: "",
  recipientPhone: "",
  address: "",
  locationType: "house",
  instructions: "",
  senderName: "",
  anonymous: false,
  giftMessage: "",
};

export const initialCheckoutState: CheckoutState = {
  form: initialCheckoutForm,
  step: "form",
  result: null,
};

export function createInitialCheckoutState(): CheckoutState {
  return {
    form: { ...initialCheckoutForm },
    step: "form",
    result: null,
  };
}

const checkoutFieldClass =
  "checkout-field w-full rounded-2xl border px-4 py-3 text-sm outline-none transition";

const checkoutLabelClass =
  "mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200";

const checkoutSteps = [
  { label: "Cart", icon: ShoppingCart, target: "cart" },
  { label: "Date selection", icon: CalendarDays, target: "date" },
  { label: "Delivery destination", icon: Truck, target: "delivery" },
  { label: "Checkout", icon: CreditCard, target: "checkout" },
] satisfies Array<{
  label: string;
  icon: typeof ShoppingCart;
  target: CheckoutProgressTarget;
}>;

function getProductImageUrl(product: CartItem) {
  if (!product.imageUrl && !product.productUrl) return null;

  return `/api/product-image?${new URLSearchParams({
    ...(product.imageUrl ? { src: product.imageUrl } : {}),
    ...(product.productUrl ? { product: product.productUrl } : {}),
  }).toString()}`;
}

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

function CheckoutReviewItem({ item }: { item: CartItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : getProductImageUrl(item);
  const lineTotal = item.price === null ? null : item.price * item.quantity;

  return (
    <div className="checkout-section-card rounded-3xl border p-4">
      <div className="flex gap-4">
        <div className="checkout-mini-card flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border p-1.5 sm:h-20 sm:w-20">
          {imageUrl ? (
            // Images are normalized through the local product-image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={item.name}
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon size={24} className="text-slate-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {(item.brand || item.category) && (
                <p className="truncate text-xs font-medium text-slate-400">
                  {item.brand || item.category}
                </p>
              )}
              <h3 className="line-clamp-2 text-sm font-bold leading-5 text-white">
                {item.name}
              </h3>
            </div>

            <span className="shrink-0 rounded-full bg-purple-500/15 px-2.5 py-1 text-xs font-bold text-purple-300">
              Qty {item.quantity}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Unit price
              </p>
              <p className="mt-1 text-sm font-bold text-white">
                {item.price === null ? "Unavailable" : formatMoney(item.price)}
              </p>
            </div>

            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Item total
              </p>
              <p className="mt-1 text-base font-black text-purple-300">
                {lineTotal === null ? "Unavailable" : formatMoney(lineTotal)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckoutPanel({
  open,
  cart,
  delivery,
  checkoutState,
  onCheckoutStateChange,
  onProgressStepClick,
  onClose,
}: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { form, step, result } = checkoutState;
  const cartTotal = cart.reduce(
    (total, item) => total + (item.price || 0) * item.quantity,
    0
  );
  const canReview =
    cart.length > 0 &&
    delivery?.available === true &&
    form.recipientName.trim() &&
    form.recipientPhone.trim() &&
    form.address.trim() &&
    form.senderName.trim();

  function updateCheckoutState(nextState: CheckoutState) {
    onCheckoutStateChange(nextState);
  }

  function setCheckoutStep(nextStep: CheckoutStep) {
    updateCheckoutState({
      ...checkoutState,
      step: nextStep,
    });
  }

  function updateField<K extends keyof CheckoutForm>(
    key: K,
    value: CheckoutForm[K]
  ) {
    updateCheckoutState({
      ...checkoutState,
      form: {
        ...form,
        [key]: value,
      },
    });
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
            quantity: item.quantity,
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

      updateCheckoutState({
        ...checkoutState,
        step: "pay",
        result: data.result,
      });
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
            className="panel-close-button rounded-xl p-2 transition"
            aria-label="Close checkout panel"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div
            className="checkout-panel-card mb-6 rounded-3xl border px-5 py-5"
            aria-label="Checkout progress"
          >
            <div className="relative grid grid-cols-4 items-center">
              <div className="absolute left-[12.5%] right-[12.5%] top-1/2 h-0.5 -translate-y-1/2 bg-slate-700" />
              <div
                className="absolute left-[12.5%] right-[12.5%] top-1/2 h-0.5 -translate-y-1/2 bg-purple-400 transition-all"
              />

              {checkoutSteps.map(({ label, icon: Icon, target }, index) => {
                const isComplete = index < 3 || step === "pay";
                const isCurrent = target === "checkout" && step !== "pay";
                return (
                  <div
                    key={label}
                    className="relative z-10 flex justify-center"
                  >
                    <button
                      type="button"
                      onClick={() => onProgressStepClick(target)}
                      className={`flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-lg transition hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-purple-400/25 ${
                        isComplete
                          ? "border-purple-200 bg-purple-500 text-white shadow-purple-950/30"
                          : isCurrent
                            ? "border-purple-300 bg-slate-950 text-purple-200 shadow-purple-950/30 ring-4 ring-purple-500/20"
                          : "border-slate-600 bg-slate-900 text-slate-300 shadow-slate-950/30"
                      }`}
                      title={label}
                      aria-label={`Go to ${label}`}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <Icon size={21} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {!delivery?.available && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              Check delivery first before checkout.
            </div>
          )}

          {step === "form" && delivery?.available && (
            <div className="space-y-5">
              <div className="checkout-confirm-card rounded-3xl border p-5">
                <div className="flex items-start gap-4">
                  <div className="checkout-confirm-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
                    <Truck size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="checkout-confirm-eyebrow text-xs font-bold uppercase tracking-wide">
                      Delivery confirmed
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-white">
                      {delivery.city}
                    </h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="checkout-mini-card rounded-2xl border p-3">
                        <p className="text-xs text-slate-400">Date</p>
                        <p className="mt-1 text-sm font-bold text-white">
                          {formatDate(delivery.checkedDate)}
                        </p>
                      </div>
                      <div className="checkout-mini-card rounded-2xl border p-3">
                        <p className="text-xs text-slate-400">Fee</p>
                        <p className="mt-1 text-sm font-bold text-white">
                          {delivery.fee === null
                            ? "Unavailable"
                            : formatMoney(delivery.fee)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="checkout-section-card rounded-3xl border p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="checkout-section-icon flex h-10 w-10 items-center justify-center rounded-2xl">
                    <User size={19} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Recipient</h3>
                    <p className="text-xs text-slate-400">
                      Who receives this order
                    </p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <User size={15} className="text-purple-300" />
                      Recipient name
                    </span>
                    <input
                      value={form.recipientName}
                      onChange={(event) =>
                        updateField("recipientName", event.target.value)
                      }
                      className={checkoutFieldClass}
                    />
                  </label>

                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <Phone size={15} className="text-purple-300" />
                      Recipient phone
                    </span>
                    <input
                      value={form.recipientPhone}
                      onChange={(event) =>
                        updateField("recipientPhone", event.target.value)
                      }
                      placeholder="0771234567 or +94771234567"
                      className={checkoutFieldClass}
                    />
                  </label>
                </div>
              </div>

              <div className="checkout-section-card rounded-3xl border p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="checkout-section-icon flex h-10 w-10 items-center justify-center rounded-2xl">
                    <MapPin size={19} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Drop-off details</h3>
                    <p className="text-xs text-slate-400">
                      Address and delivery notes
                    </p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <MapPin size={15} className="text-purple-300" />
                      Delivery address
                    </span>
                    <textarea
                      value={form.address}
                      onChange={(event) =>
                        updateField("address", event.target.value)
                      }
                      rows={3}
                      className={checkoutFieldClass}
                    />
                  </label>

                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <Home size={15} className="text-purple-300" />
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
                      className={checkoutFieldClass}
                    >
                      <option value="house">House</option>
                      <option value="apartment">Apartment</option>
                      <option value="office">Office</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <MessageSquareText
                        size={15}
                        className="text-purple-300"
                      />
                      Delivery instructions
                    </span>
                    <textarea
                      value={form.instructions}
                      onChange={(event) =>
                        updateField("instructions", event.target.value)
                      }
                      rows={2}
                      placeholder="Gate code, call before delivery, etc."
                      className={checkoutFieldClass}
                    />
                  </label>
                </div>
              </div>

              <div className="checkout-section-card rounded-3xl border p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="checkout-section-icon flex h-10 w-10 items-center justify-center rounded-2xl">
                    <Gift size={19} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Sender and gift</h3>
                    <p className="text-xs text-slate-400">
                      How the order should appear
                    </p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <User size={15} className="text-purple-300" />
                      Your name
                    </span>
                    <input
                      value={form.senderName}
                      onChange={(event) =>
                        updateField("senderName", event.target.value)
                      }
                      className={checkoutFieldClass}
                    />
                  </label>

                  <label className="checkout-checkbox-row flex items-center gap-3 rounded-2xl border p-4 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.anonymous}
                      onChange={(event) =>
                        updateField("anonymous", event.target.checked)
                      }
                      className="h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-purple-400 outline-none focus:ring-4 focus:ring-purple-500/15"
                    />
                    Show sender as Anonymous
                  </label>

                  <label className="block">
                    <span className={checkoutLabelClass}>
                      <Gift size={15} className="text-purple-300" />
                      Gift message, optional
                    </span>
                    <textarea
                      value={form.giftMessage}
                      onChange={(event) =>
                        updateField("giftMessage", event.target.value)
                      }
                      rows={2}
                      maxLength={300}
                      className={checkoutFieldClass}
                    />
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCheckoutStep("review")}
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
              <div className="checkout-section-card rounded-3xl border p-5">
                <div className="flex items-start gap-3">
                  <div className="checkout-section-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
                    <PackageCheck size={19} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Confirm order</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      Review products, delivery fee, and estimated total before
                      creating the Kapruka checkout link.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3" aria-label="Order items">
                {cart.map((item) => (
                  <Fragment key={item.id}>
                    <CheckoutReviewItem item={item} />
                  <div
                    className="hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                  >
                    <p className="text-sm font-semibold text-white">
                      {item.name}
                    </p>
                    <p className="mt-1 text-sm text-purple-300">
                      {item.price === null
                        ? "Price unavailable"
                        : `${item.quantity} × ${formatMoney(item.price)} = ${formatMoney(item.price * item.quantity)}`}
                    </p>
                  </div>
                  </Fragment>
                ))}
              </div>

              <div className="checkout-confirm-card rounded-3xl border p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="checkout-confirm-eyebrow text-xs font-bold uppercase tracking-wide">
                      Payment estimate
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-white">
                      Order total
                    </h3>
                  </div>
                  <div className="checkout-confirm-icon flex h-11 w-11 items-center justify-center rounded-2xl">
                    <CreditCard size={20} />
                  </div>
                </div>

                <dl className="space-y-3">
                  <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                    <dt className="text-sm text-slate-400">Items subtotal</dt>
                    <dd className="text-sm font-bold text-white">
                      {formatMoney(cartTotal)}
                    </dd>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                    <dt className="text-sm text-slate-400">Delivery fee</dt>
                    <dd className="text-sm font-bold text-white">
                      {delivery.fee === null
                        ? "To be confirmed"
                        : formatMoney(delivery.fee)}
                    </dd>
                  </div>

                  <div className="flex items-end justify-between gap-4 pt-1">
                    <dt>
                      <p className="text-sm font-semibold text-white">
                        Estimated total
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatMoney(cartTotal)}
                        {" + "}
                        {delivery.fee === null
                          ? "delivery"
                          : formatMoney(delivery.fee)}
                      </p>
                    </dt>
                    <dd className="text-2xl font-black text-purple-300">
                      {formatMoney(cartTotal + (delivery.fee || 0))}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 text-xs leading-5 text-slate-400">
                  Kapruka will return the final locked total with the payment
                  link before any payment is made.
                </p>
              </div>

              <dl className="hidden grid-cols-2 gap-3">
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

              <div className="hidden rounded-3xl border border-purple-400/30 bg-purple-500/10 p-5">
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
                  onClick={() => setCheckoutStep("form")}
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
              <div className="checkout-confirm-card rounded-3xl border p-5">
                <div className="flex items-start gap-3">
                  <div className="checkout-confirm-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                    <CheckCircle2 size={22} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Receipt preview
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      Checkout link created. Payment is still required to place
                      the order.
                    </p>
                  </div>
                </div>
              </div>

              <div className="checkout-section-card overflow-hidden rounded-3xl border">
                <div className="border-b border-white/10 p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Demo receipt
                  </p>
                  <div className="mt-2 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-white">
                        {result.order_ref}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Expires {new Date(result.expires_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="rounded-full bg-purple-500/15 px-3 py-1 text-xs font-bold text-purple-300">
                      Unpaid
                    </span>
                  </div>
                </div>

                <div className="space-y-3 p-5">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-semibold text-white">
                          {item.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Qty {item.quantity}
                          {item.price !== null
                            ? ` · ${formatMoney(item.price)} each`
                            : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-white">
                        {item.price === null
                          ? "Unavailable"
                          : formatMoney(item.price * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>

                <dl className="space-y-3 border-t border-white/10 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-slate-400">Items subtotal</dt>
                    <dd className="text-sm font-bold text-white">
                      {formatMoney(result.summary.items_total)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-slate-400">Delivery fee</dt>
                    <dd className="text-sm font-bold text-white">
                      {formatMoney(result.summary.delivery_fee)}
                    </dd>
                  </div>
                  {result.summary.addons_total > 0 && (
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-sm text-slate-400">Add-ons</dt>
                      <dd className="text-sm font-bold text-white">
                        {formatMoney(result.summary.addons_total)}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-4">
                    <dt className="font-bold text-white">Grand total</dt>
                    <dd className="text-2xl font-black text-purple-300">
                      {formatMoney(
                        result.summary.grand_total,
                        result.summary.currency
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

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
