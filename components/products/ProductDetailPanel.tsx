"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Star,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import type { ProductCard, ProductDetails } from "@/types/product";

type Props = {
  product: ProductCard | null;
  isInCart: boolean;
  onAddToCart: (product: ProductCard) => void;
  onClose: () => void;
};

type DetailProps = Omit<Props, "product"> & {
  product: ProductCard;
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-LK", {
    maximumFractionDigits: 0,
  }).format(price);
}

function proxiedImage(imageUrl: string, productUrl?: string | null) {
  return `/api/product-image?${new URLSearchParams({
    src: imageUrl,
    ...(productUrl ? { product: productUrl } : {}),
  }).toString()}`;
}

export function ProductDetailPanel({
  product,
  isInCart,
  onAddToCart,
  onClose,
}: Props) {
  if (!product) return null;

  return (
    <ProductDetailContent
      key={product.id}
      product={product}
      isInCart={isInCart}
      onAddToCart={onAddToCart}
      onClose={onClose}
    />
  );
}

function ProductDetailContent({
  product,
  isInCart,
  onAddToCart,
  onClose,
}: DetailProps) {
  const [details, setDetails] = useState<ProductDetails | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(Boolean(product.productUrl));
  const [error, setError] = useState(
    product.productUrl
      ? ""
      : "Full product details are not available for this item."
  );

  useEffect(() => {
    const controller = new AbortController();

    if (!product.productUrl) {
      return () => controller.abort();
    }

    async function loadDetails() {
      try {
        const response = await fetch(
          `/api/product-details?${new URLSearchParams({
            url: product.productUrl!,
          }).toString()}`,
          { signal: controller.signal }
        );
        const data = (await response.json()) as ProductDetails & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not load product details.");
        }

        setDetails(data);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load product details."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadDetails();
    return () => controller.abort();
  }, [product]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, product]);

  const images = useMemo(() => {
    return [
      ...(details?.images || []),
      ...(product.imageUrl ? [product.imageUrl] : []),
    ].filter(
      (image, index, all) =>
        all.indexOf(image) === index && !failedImages.has(image)
    );
  }, [details?.images, failedImages, product]);

  const currentImageIndex = Math.min(
    selectedImage,
    Math.max(0, images.length - 1)
  );
  const currentImage = images[currentImageIndex] || null;
  const hasDiscount =
    product.price !== null &&
    typeof product.compareAtPrice === "number" &&
    product.compareAtPrice > product.price;
  const discountPercentage = hasDiscount
    ? Math.round(
        ((product.compareAtPrice! - product.price!) /
          product.compareAtPrice!) *
          100
      )
    : null;
  const isOutOfStock = product.inStock === false;
  const title = details?.name || product.name;

  function changeImage(direction: -1 | 1) {
    if (images.length < 2) return;
    setSelectedImage((current) => (current + direction + images.length) % images.length);
  }

  return (
    <div className="product-detail-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6">
      <button
        type="button"
        aria-label="Close product details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        className="product-detail-modal relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-[0_35px_120px_-30px_rgba(0,0,0,0.85)] sm:max-h-[calc(100vh-3rem)]"
      >
        <header className="product-detail-header flex items-center justify-between border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center">
              <BrandLogo size={56} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">
                Product details
              </p>
              <p className="truncate text-sm text-slate-400">
                Everything worth knowing before you choose
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </header>

        <div className="product-detail-scroll flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
            <div className="product-detail-gallery border-b border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-purple-950/30 p-4 sm:p-7 lg:sticky lg:top-0 lg:h-[calc(100vh-7rem)] lg:max-h-[820px] lg:border-b-0 lg:border-r">
              <div className="mx-auto flex h-full max-w-2xl flex-col">
                <div className="product-detail-image-stage relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.025] p-4 shadow-[0_30px_90px_-45px_rgba(64,41,112,0.35)] sm:min-h-[460px]">
                  {currentImage ? (
                    // Kapruka images are served through the local allow-listed proxy.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxiedImage(currentImage, product.productUrl)}
                      alt={title}
                      onError={() =>
                        setFailedImages((current) =>
                          new Set(current).add(currentImage)
                        )
                      }
                      className="h-full max-h-[620px] w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <ImageIcon size={48} />
                      <span className="text-sm">No product image available</span>
                    </div>
                  )}

                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => changeImage(-1)}
                        aria-label="Previous product image"
                        className="product-detail-image-nav absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-slate-950/75 p-2.5 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-slate-900"
                      >
                        <ChevronLeft size={21} />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeImage(1)}
                        aria-label="Next product image"
                        className="product-detail-image-nav absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-slate-950/75 p-2.5 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-slate-900"
                      >
                        <ChevronRight size={21} />
                      </button>
                    </>
                  )}

                  {images.length > 1 && (
                    <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                      {currentImageIndex + 1} / {images.length}
                    </span>
                  )}
                </div>

                {images.length > 1 && (
                  <div className="mt-4 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {images.map((image, index) => (
                      <button
                        key={image}
                        type="button"
                        onClick={() => setSelectedImage(index)}
                        aria-label={`Show product image ${index + 1}`}
                        aria-pressed={currentImageIndex === index}
                        className={`product-detail-thumbnail h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 bg-white/[0.035] p-1 transition ${
                          currentImageIndex === index
                            ? "border-purple-400 shadow-lg shadow-purple-500/20"
                            : "border-transparent opacity-65 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={proxiedImage(image, product.productUrl)}
                          alt=""
                          onError={() =>
                            setFailedImages((current) =>
                              new Set(current).add(image)
                            )
                          }
                          className="h-full w-full rounded-xl object-contain"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="product-detail-info bg-slate-950 px-5 py-7 sm:px-8 sm:py-9">
              <div className="mx-auto max-w-2xl">
                <div className="flex flex-wrap gap-2">
                  {product.brand && (
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-300">
                      {product.brand}
                    </span>
                  )}
                  {product.category && (
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-300">
                      {product.category}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      isOutOfStock
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-purple-500/15 text-purple-300"
                    }`}
                  >
                    {isOutOfStock ? "Currently unavailable" : "Available to order"}
                  </span>
                </div>

                <h2
                  id="product-detail-title"
                  className="mt-5 text-lg font-bold leading-7 text-white"
                >
                  {title}
                </h2>

                {typeof product.rating === "number" &&
                  product.rating > 0 &&
                  product.rating <= 5 &&
                  typeof product.reviewCount === "number" &&
                  product.reviewCount > 0 && (
                  <div className="mt-4 flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1 text-amber-400">
                      <Star size={18} fill="currentColor" />
                      <span className="font-bold text-white">
                        {product.rating.toFixed(1)}
                      </span>
                    </span>
                    {typeof product.reviewCount === "number" &&
                      product.reviewCount > 0 && (
                        <span className="text-slate-400">
                          from {formatPrice(product.reviewCount)} reviews
                        </span>
                      )}
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-end gap-3">
                  <p
                    className={`text-3xl font-black ${
                      hasDiscount ? "text-emerald-300" : "text-purple-300"
                    }`}
                  >
                    {hasDiscount && (
                      <span className="mr-2 align-middle text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                        Now
                      </span>
                    )}
                    {product.price === null
                      ? "Price unavailable"
                      : `Rs. ${formatPrice(product.price)}`}
                  </p>
                  {hasDiscount && (
                    <p className="pb-1 text-base font-medium text-slate-500">
                      <span className="mr-1.5 text-xs uppercase tracking-wide">
                        Was
                      </span>
                      <span className="line-through decoration-rose-400 decoration-2">
                        Rs. {formatPrice(product.compareAtPrice!)}
                      </span>
                    </p>
                  )}
                  {discountPercentage && (
                    <span className="mb-0.5 rounded-full bg-purple-500 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-white shadow-sm">
                      Save {discountPercentage}%
                    </span>
                  )}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <PackageCheck className="shrink-0 text-purple-300" size={21} />
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Kapruka marketplace
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        Availability and delivery are confirmed during checkout.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <ShieldCheck className="shrink-0 text-purple-300" size={21} />
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Real product page
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        Details and images are loaded directly from Kapruka.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => onAddToCart(product)}
                    disabled={isOutOfStock}
                    className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-purple-500 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-purple-400 disabled:bg-white/[0.08] disabled:text-slate-500"
                  >
                    <ShoppingCart size={19} />
                    {isInCart
                      ? "Add another"
                      : isOutOfStock
                        ? "Currently unavailable"
                        : "Add to cart"}
                  </button>
                  {product.productUrl && (
                    <a
                      href={product.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3.5 text-sm font-semibold text-white transition hover:border-purple-400/40 hover:bg-white/10"
                    >
                      <ExternalLink size={18} />
                      Open on Kapruka
                    </a>
                  )}
                </div>

                {loading && (
                  <div className="mt-9 space-y-4" aria-label="Loading product details">
                    <div className="h-5 w-40 animate-pulse rounded-full bg-white/10" />
                    <div className="h-24 animate-pulse rounded-3xl bg-white/[0.06]" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="h-24 animate-pulse rounded-2xl bg-white/[0.06]" />
                      <div className="h-24 animate-pulse rounded-2xl bg-white/[0.06]" />
                    </div>
                  </div>
                )}

                {error && !loading && (
                  <div className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                    {error} You can still open the original Kapruka page above.
                  </div>
                )}

                {!loading && details?.highlights.length ? (
                  <section className="mt-9">
                    <h3 className="text-xl font-bold text-white">Why it stands out</h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {details.highlights.map((highlight) => (
                        <div
                          key={highlight}
                          className="flex gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-4"
                        >
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-purple-300">
                            <Check size={14} />
                          </span>
                          <p className="text-sm leading-6 text-slate-300">
                            {highlight}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {!loading && (details?.description || product.description) && (
                  <section className="mt-9">
                    <h3 className="text-xl font-bold text-white">
                      Product story
                    </h3>
                    <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-300">
                      {details?.description || product.description}
                    </p>
                  </section>
                )}

                {!loading && details?.specifications.length ? (
                  <section className="mt-9">
                    <h3 className="text-xl font-bold text-white">
                      Specifications
                    </h3>
                    <dl className="mt-4 overflow-hidden rounded-3xl border border-white/10">
                      {details.specifications.map((specification, index) => (
                        <div
                          key={`${specification.label}-${index}`}
                          className="grid gap-1 border-b border-white/10 bg-white/[0.035] px-5 py-4 last:border-b-0 sm:grid-cols-[160px_1fr] sm:gap-5"
                        >
                          <dt className="text-sm font-semibold text-slate-400">
                            {specification.label}
                          </dt>
                          <dd className="text-sm leading-6 text-slate-200">
                            {specification.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {!loading && details?.questions.length ? (
                  <section className="mt-9 pb-8">
                    <h3 className="text-xl font-bold text-white">
                      Questions people ask
                    </h3>
                    <div className="mt-4 space-y-3">
                      {details.questions.map(({ question, answer }, index) => (
                        <details
                          key={`${question}-${index}`}
                          className="group rounded-2xl border border-white/10 bg-white/[0.035] open:border-purple-400/30 open:bg-purple-500/[0.06]"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold leading-6 text-white">
                            {question}
                            <ChevronRight
                              size={18}
                              className="shrink-0 text-slate-500 transition group-open:rotate-90 group-open:text-purple-300"
                            />
                          </summary>
                          <p className="border-t border-white/10 px-5 py-4 text-sm leading-7 text-slate-300">
                            {answer}
                          </p>
                        </details>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
