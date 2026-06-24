"use client";

import { useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  products: ProductCardType[];
  cartProductIds: string[];
  onAddToCart: (product: ProductCardType) => void;
  onViewDetails: (product: ProductCardType) => void;
  onFollowUp: (message: string) => void;
  searchContext: string;
  disabled?: boolean;
};

export function ProductCarousel({
  products,
  cartProductIds,
  onAddToCart,
  onViewDetails,
  onFollowUp,
  searchContext,
  disabled = false,
}: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const prices = products
    .map((product) => product.price)
    .filter((price): price is number => typeof price === "number" && price > 0);
  const minimumPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const priceThresholds = [
    5_000,
    10_000,
    20_000,
    50_000,
    100_000,
    200_000,
    500_000,
    1_000_000,
  ]
    .filter((threshold) => threshold >= minimumPrice)
    .slice(0, 3);
  const followUps = [
    ...priceThresholds.map((threshold) => ({
      label: `Under Rs. ${threshold / 1_000}k`,
      message: `Under Rs. ${threshold.toLocaleString("en-LK")}, find ${searchContext}`,
    })),
    {
      label: "Best value",
      message: `Find the best-value options for ${searchContext}`,
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

  return (
    <div className="mt-4 min-w-0">
      {products.length >= 5 && (
        <div className="mb-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label="Show previous products"
            className="rounded-full border border-white/10 bg-white/[0.06] p-2 text-slate-300 transition hover:border-purple-400/40 hover:bg-purple-500 hover:text-white"
          >
            <ChevronLeft size={18} />
          </button>

          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label="Show more products"
            className="rounded-full border border-white/10 bg-white/[0.06] p-2 text-slate-300 transition hover:border-purple-400/40 hover:bg-purple-500 hover:text-white"
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
            key={`${product.id}:${product.imageUrl || product.productUrl || "no-image"}`}
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
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        aria-label="Suggested follow-up searches"
      >
        {followUps.map((followUp) => (
          <button
            key={followUp.label}
            type="button"
            onClick={() => onFollowUp(followUp.message)}
            disabled={disabled}
            className="group flex items-center gap-2 rounded-full border border-purple-500/25 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-300 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-purple-500 hover:bg-purple-500 hover:text-white hover:shadow-[0_10px_24px_-14px_rgba(64,41,112,0.8)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {followUp.label}
            <ArrowRight
              size={15}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
