"use client";

import { useState } from "react";
import {
  Check,
  ExternalLink,
  ImageIcon,
  ShoppingCart,
} from "lucide-react";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  product: ProductCardType;
  isInCart: boolean;
  onAddToCart: (product: ProductCardType) => void;
  onViewDetails: (product: ProductCardType) => void;
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-LK", {
    maximumFractionDigits: 0,
  }).format(price);
}

function ratingStarFill(rating: number, index: number) {
  return Math.max(0, Math.min(1, rating - index)) * 100;
}

export function ProductCard({
  product,
  isInCart,
  onAddToCart,
  onViewDetails,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl =
    !imageFailed && (product.imageUrl || product.productUrl)
      ? `/api/product-image?${new URLSearchParams({
          ...(product.imageUrl ? { src: product.imageUrl } : {}),
          ...(product.productUrl ? { product: product.productUrl } : {}),
        }).toString()}`
      : null;
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
  const contextLabel =
    product.brand &&
    product.category &&
    product.brand.toLowerCase() !== product.category.toLowerCase()
      ? `${product.brand} · ${product.category}`
      : product.brand || product.category;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`View details for ${product.name}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a")) return;
        onViewDetails(product);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onViewDetails(product);
        }
      }}
      className="product-card group flex h-full cursor-pointer flex-col overflow-hidden rounded-[30px] border border-white/[0.09] bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-2 shadow-none outline-none transition duration-300 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-[0_8px_20px_-16px_rgba(16,185,129,0.4)] focus-visible:border-emerald-300 focus-visible:ring-4 focus-visible:ring-emerald-500/15"
    >
      <div className="relative aspect-square overflow-hidden rounded-[24px] border border-white/[0.06] bg-slate-900">
        {imageUrl ? (
          // Images are already normalized through the local product-image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={product.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full rounded-[23px] object-contain transition duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[23px] bg-gradient-to-br from-slate-800 to-slate-900 text-slate-400">
            <ImageIcon size={38} />
            <span className="text-sm">Image coming soon</span>
          </div>
        )}

        {discountPercentage && (
          <span className="absolute left-3 top-3 rounded-md bg-rose-500 px-2 py-1 text-[11px] font-bold text-white shadow-sm">
            {discountPercentage}% off
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
        <div>
          {contextLabel && (
            <p className="mb-1.5 truncate text-xs font-semibold uppercase text-slate-500">
              {contextLabel}
            </p>
          )}

          <h3
            title={product.name}
            className="line-clamp-2 text-base font-semibold leading-6 text-white"
          >
            {product.name}
          </h3>

          {typeof product.rating === "number" && product.rating > 0 && (
            <div
              className="mt-2 flex items-center gap-1.5 text-sm"
              aria-label={`${product.rating.toFixed(1)} out of 5 stars${
                product.reviewCount
                  ? ` from ${product.reviewCount} reviews`
                  : ""
              }`}
            >
              <span className="flex items-center gap-0.5" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => {
                  const fill = ratingStarFill(product.rating!, index);

                  return (
                    <span
                      key={index}
                      className="relative inline-block h-4 w-4 text-base leading-4"
                    >
                      <span className="absolute inset-0 text-slate-600">
                        ★
                      </span>
                      <span
                        className="absolute inset-0 overflow-hidden"
                        style={{ width: `${fill}%` }}
                      >
                        <span className="text-amber-400">★</span>
                      </span>
                    </span>
                  );
                })}
              </span>
              <span className="font-semibold text-slate-200">
                {product.rating.toFixed(1)}
              </span>
              {typeof product.reviewCount === "number" &&
                product.reviewCount > 0 && (
                  <span className="text-slate-500">
                    ({formatPrice(product.reviewCount)})
                  </span>
                )}
            </div>
          )}

          <div className="mt-2 flex min-h-8 flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-xl font-bold text-emerald-300">
              {product.price === null
                ? "Price unavailable"
                : `Rs. ${formatPrice(product.price)}`}
            </p>

            {hasDiscount && (
              <p className="text-sm text-slate-500 line-through">
                Rs. {formatPrice(product.compareAtPrice!)}
              </p>
            )}
          </div>
        </div>

        <div className="mt-auto flex gap-2 pt-3">
          <button
            type="button"
            onClick={() => onAddToCart(product)}
            disabled={isInCart || isOutOfStock}
            aria-label={
              isInCart
                ? `${product.name} is in your cart`
                : isOutOfStock
                  ? `${product.name} is out of stock`
                  : `Add ${product.name} to cart`
            }
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:bg-white/[0.07] disabled:text-slate-500"
          >
            {isInCart ? <Check size={17} /> : <ShoppingCart size={16} />}
            {isInCart ? "In cart" : isOutOfStock ? "Unavailable" : "Add to cart"}
          </button>

          {product.productUrl && (
            <a
              href={product.productUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${product.name} on Kapruka`}
              title="View product details on Kapruka"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-emerald-400/40 hover:bg-white/10 hover:text-white"
            >
              <ExternalLink size={17} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
