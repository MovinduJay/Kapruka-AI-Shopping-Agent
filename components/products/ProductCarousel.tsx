"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  products: ProductCardType[];
  onAddToCart: (product: ProductCardType) => void;
};

export function ProductCarousel({ products, onAddToCart }: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);

  function scroll(direction: "left" | "right") {
    const carousel = carouselRef.current;

    if (!carousel) return;

    carousel.scrollBy({
      left:
        direction === "left"
          ? -carousel.clientWidth
          : carousel.clientWidth,
      behavior: "smooth",
    });
  }

  return (
    <div className="mt-4 min-w-0">
      {products.length > 1 && (
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
            <ProductCard product={product} onAddToCart={onAddToCart} />
          </div>
        ))}
      </div>
    </div>
  );
}
