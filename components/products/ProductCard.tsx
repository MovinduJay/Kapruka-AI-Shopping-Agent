"use client";

import { useState } from "react";
import { ExternalLink, ImageIcon, ShoppingCart } from "lucide-react";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  product: ProductCardType;
  onAddToCart: (product: ProductCardType) => void;
};

export function ProductCard({ product, onAddToCart }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl =
    !imageFailed && (product.imageUrl || product.productUrl)
      ? `/api/product-image?${new URLSearchParams({
          ...(product.imageUrl ? { src: product.imageUrl } : {}),
          ...(product.productUrl ? { product: product.productUrl } : {}),
        }).toString()}`
      : null;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[30px] border border-white/[0.09] bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-2 shadow-[0_18px_45px_-24px_rgba(0,0,0,0.9)] transition duration-300 hover:-translate-y-1.5 hover:border-emerald-300/70 hover:shadow-[0_24px_58px_-20px_rgba(16,185,129,0.5)]">
      <div className="relative aspect-square overflow-hidden rounded-[24px] border border-white/[0.06] bg-slate-900 shadow-inner">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full rounded-[23px] object-contain transition duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[23px] bg-gradient-to-br from-slate-800 to-slate-900 text-slate-400">
            <ImageIcon size={34} />
            <span className="text-xs">Image coming soon</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-4">
        <div>
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-white">
            {product.name}
          </h3>

          <p className="mt-2 text-lg font-bold text-emerald-300">
            Rs. {product.price?.toLocaleString() ?? "N/A"}
          </p>
        </div>

        <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-slate-400">
          {product.description ||
            product.reason ||
            "Open the product to view full details."}
        </p>

        <div className="mt-auto flex gap-2 pt-4">
          <button
            onClick={() => onAddToCart(product)}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400"
          >
            <ShoppingCart size={14} />
            Add
          </button>

          {product.productUrl && (
            <a
              href={product.productUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${product.name} on Kapruka`}
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
