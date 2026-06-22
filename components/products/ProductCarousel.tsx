"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  products: ProductCardType[];
  cartProductIds: string[];
  onAddToCart: (product: ProductCardType) => void;
  onViewDetails: (product: ProductCardType) => void;
};

export function ProductCarousel({
  products,
  cartProductIds,
  onAddToCart,
  onViewDetails,
}: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);

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
    </div>
  );
}
