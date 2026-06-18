"use client";

import { useRef } from "react";
import {
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Plus,
  Tag,
} from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  products: ProductCardType[];
  cartProductIds: string[];
  onAddToCart: (product: ProductCardType) => void;
  onViewDetails: (product: ProductCardType) => void;
  onSearchRevision: (message: string) => void;
  searchQuery: string;
  disabled?: boolean;
};

export function ProductCarousel({
  products,
  cartProductIds,
  onAddToCart,
  onViewDetails,
  onSearchRevision,
  searchQuery,
  disabled = false,
}: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const queryLabel = searchQuery.trim() || "these products";
  const previewProducts = products.filter(
    (product) => product.imageUrl || product.productUrl
  );
  const revisionActions = [
    {
      title: "More Results",
      description: "Show a wider set of matches",
      icon: Plus,
      product: previewProducts[0] || products[0],
      message: `Show me more results for ${queryLabel}. Include a broader mix of relevant products.`,
    },
    {
      title: "Filter Price",
      description: "Find lower-budget options",
      icon: BadgeDollarSign,
      product: previewProducts[1] || products[1] || products[0],
      message: `Show me cheaper options for ${queryLabel}. Keep them relevant and in stock if possible.`,
    },
    {
      title: "Filter Category",
      description: "Search similar categories",
      icon: ListFilter,
      product: previewProducts[2] || products[2] || products[0],
      message: `Show me similar categories and close alternatives for ${queryLabel}.`,
    },
    {
      title: "Best Value",
      description: "Balance price and quality",
      icon: Tag,
      product: previewProducts[3] || products[3] || products[0],
      message: `Show me the best value options for ${queryLabel}. Balance price, quality, and relevance.`,
    },
  ];

  function scroll(direction: "left" | "right") {
    const carousel = carouselRef.current;
    const firstCard = carousel?.firstElementChild;

    if (!carousel || !(firstCard instanceof HTMLElement)) return;

    const gap = Number.parseFloat(getComputedStyle(carousel).columnGap) || 0;
    const cardStep = firstCard.getBoundingClientRect().width + gap;

    carousel.scrollBy({
      left: direction === "left" ? -cardStep : cardStep,
      behavior: "smooth",
    });
  }

  function imageUrlFor(product?: ProductCardType) {
    if (!product || (!product.imageUrl && !product.productUrl)) return null;

    return `/api/product-image?${new URLSearchParams({
      ...(product.imageUrl ? { src: product.imageUrl } : {}),
      ...(product.productUrl ? { product: product.productUrl } : {}),
    }).toString()}`;
  }

  return (
    <div className="mt-4 min-w-0">
      {products.length >= 5 && (
        <div className="mb-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label="Show previous products"
            className="rounded-full border border-white/10 bg-white/[0.06] p-2 text-slate-300 transition hover:border-emerald-400/40 hover:bg-emerald-500 hover:text-white"
          >
            <ChevronLeft size={18} />
          </button>

          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label="Show more products"
            className="rounded-full border border-white/10 bg-white/[0.06] p-2 text-slate-300 transition hover:border-emerald-400/40 hover:bg-emerald-500 hover:text-white"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <div
        ref={carouselRef}
        className="flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto scroll-smooth py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[82%] shrink-0 snap-start sm:w-[calc((100%_-_1rem)/2)] lg:w-[calc((100%_-_2rem)/3)] xl:w-[calc((100%_-_3rem)/4)]"
          >
            <ProductCard
              product={product}
              isInCart={cartProductIds.includes(product.id)}
              onAddToCart={onAddToCart}
              onViewDetails={onViewDetails}
            />
          </div>
        ))}

        <div className="w-full shrink-0 snap-start">
          <section
            aria-label="Refine product search"
            className="flex h-full min-h-[420px] flex-col rounded-[30px] border border-white/[0.09] bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-4"
          >
            <p className="px-1 text-lg leading-7 text-slate-300">
              <span className="font-semibold text-white">Still looking?</span>{" "}
              Try these refinements.
            </p>

            <div className="mt-4 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              {revisionActions.map((action) => {
                const Icon = action.icon;
                const actionImageUrl = imageUrlFor(action.product);

                return (
                  <button
                    key={action.title}
                    type="button"
                    onClick={() => onSearchRevision(action.message)}
                    disabled={disabled}
                    className="group relative grid min-h-[168px] grid-cols-[minmax(120px,0.9fr)_minmax(0,1fr)] overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.045] p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/50 hover:bg-emerald-500/10 disabled:opacity-55 sm:min-h-0"
                  >
                    <span className="absolute left-0 top-0 z-10 flex h-11 w-12 items-center justify-center rounded-br-[22px] bg-emerald-500 text-white shadow-sm">
                      <Icon size={22} />
                    </span>

                    <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-[22px] bg-slate-900/70">
                      {actionImageUrl ? (
                        // Images are routed through the same local proxy as product cards.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={actionImageUrl}
                          alt=""
                          loading="lazy"
                          className="h-full max-h-[150px] w-full object-contain p-3 transition duration-300 group-hover:scale-[1.03] sm:max-h-[170px]"
                        />
                      ) : (
                        <SparklePlaceholder />
                      )}
                    </div>

                    <span className="flex min-w-0 flex-col justify-end px-1 pb-1 pl-4">
                      <span className="text-lg font-semibold leading-6 text-white">
                        {action.title}
                      </span>
                      <span className="mt-1 text-sm leading-5 text-slate-400">
                        {action.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SparklePlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-emerald-300">
      <Plus size={28} />
    </div>
  );
}
