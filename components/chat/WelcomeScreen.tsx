"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CakeSlice,
  ChevronLeft,
  ChevronRight,
  Flower2,
  House,
  Laptop,
  PackageCheck,
  Shirt,
  ShoppingBasket,
  Send,
  Sparkles,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";

const suggestions = [
  {
    key: "cakes",
    label: "Cakes",
    prompt: "Show me popular cakes available for delivery",
    icon: CakeSlice,
  },
  {
    key: "flowers",
    label: "Flowers",
    prompt: "Show me fresh flower bouquets available for delivery",
    icon: Flower2,
  },
  {
    key: "electronics",
    label: "Electronics",
    prompt: "Show me wireless earbuds under Rs. 15,000",
    icon: Laptop,
  },
  {
    key: "groceries",
    label: "Groceries",
    prompt: "Find pantry and household essentials for this week",
    icon: ShoppingBasket,
  },
  {
    key: "fashion",
    label: "Fashion",
    prompt: "Show me casual clothing and accessories under Rs. 10,000",
    icon: Shirt,
  },
  {
    key: "home",
    label: "Home & living",
    prompt: "Show me useful home and kitchen products",
    icon: House,
  },
  {
    key: "tracking",
    label: "Order tracking",
    prompt: "Track order VPAY827982BA",
    icon: PackageCheck,
  },
];

type WelcomeProduct = {
  key: string;
  name: string;
  imageUrl: string;
  productUrl: string | null;
};

type Props = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (message?: string) => void;
};

export function WelcomeScreen({
  input,
  onInputChange,
  onSubmit,
}: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [products, setProducts] = useState<Record<string, WelcomeProduct>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadWelcomeProducts() {
      try {
        const response = await fetch("/api/welcome-products", {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          products?: WelcomeProduct[];
        };

        if (!response.ok || !data.products) return;

        setProducts(
          Object.fromEntries(
            data.products.map((product) => [product.key, product])
          )
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Could not load welcome product images:", error);
        }
      }
    }

    loadWelcomeProducts();

    return () => controller.abort();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      onSubmit();
    }
  }

  function scrollCategories(direction: "left" | "right") {
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
    <div className="flex flex-1 items-center overflow-y-auto px-4 pb-7 pt-5 font-sans sm:px-6 sm:pb-10 sm:pt-6">
      <div className="mx-auto w-full max-w-6xl text-center">
        <div className="mx-auto flex h-40 w-40 items-center justify-center overflow-visible drop-shadow-[0_22px_38px_rgba(64,41,112,0.22)] sm:h-[202px] sm:w-[202px]">
          <BrandLogo
            size={170}
            priority
            className="translate-y-1.5 sm:h-[184px] sm:w-[184px]"
          />
        </div>

        <h2 className="mt-0 text-[2.15rem] font-semibold leading-tight text-white sm:text-[3.35rem]">
          Shop across Kapruka.
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-lg text-slate-300 sm:text-[1.7rem] sm:leading-tight">
          Hi, what do you need today?
        </p>

        <div className="shopping-composer mx-auto mt-7 flex w-full max-w-[43rem] gap-2 rounded-full border p-2">
          <div className="shopping-composer-icon flex items-center pl-1">
            <Sparkles size={20} />
          </div>
          <input
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are you shopping for?"
            className="shopping-composer-input min-w-0 flex-1 bg-transparent px-2 py-2 text-base outline-none sm:text-[1.05rem]"
          />
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={!input.trim()}
            aria-label="Start shopping"
            className="shopping-composer-send flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40 sm:h-11 sm:w-11"
          >
            <Send size={18} />
          </button>
        </div>

        <div className="mx-auto mt-5 flex max-w-6xl items-center gap-3 pb-6 sm:mt-6 sm:gap-4 sm:pb-8">
          <button
            type="button"
            onClick={() => scrollCategories("left")}
            aria-label="Show previous categories"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-blue-600 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.45)] transition hover:border-blue-300 hover:bg-slate-50 sm:h-12 sm:w-12"
          >
            <ChevronLeft size={25} />
          </button>

          <div className="relative min-w-0 flex-1">
            <div className="welcome-carousel-fade welcome-carousel-fade-left pointer-events-none absolute inset-y-3 left-0 z-10 w-7" />
            <div className="welcome-carousel-fade welcome-carousel-fade-right pointer-events-none absolute inset-y-3 right-0 z-10 w-7" />

            <div
              ref={carouselRef}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-6 pt-2 text-left scroll-smooth [scrollbar-width:none] sm:gap-5 sm:pb-7 [&::-webkit-scrollbar]:hidden"
            >
            {suggestions.map((suggestion) => {
              const Icon = suggestion.icon;
              const product = products[suggestion.key];
              const canShowImage =
                product?.imageUrl && !failedImages.has(suggestion.key);
              const imageUrl = canShowImage
                ? `/api/product-image?${new URLSearchParams({
                    src: product.imageUrl,
                    ...(product.productUrl
                      ? { product: product.productUrl }
                      : {}),
                  }).toString()}`
                : null;

              return (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => onSubmit(suggestion.prompt)}
                  className="aspect-square w-[82%] shrink-0 snap-start cursor-pointer rounded-[26px] border border-white/10 bg-white/[0.06] p-4 text-left shadow-lg transition duration-200 hover:border-purple-400/70 hover:bg-white/10 hover:shadow-[0_0_0_3px_rgba(64,41,112,0.16),0_18px_42px_-24px_rgba(64,41,112,0.55)] sm:w-[calc((100%_-_1.25rem)/2)] lg:w-[calc((100%_-_2.5rem)/3)] 2xl:w-[calc((100%_-_3.75rem)/4)]"
                >
                  <div className="relative flex h-[60%] items-center justify-center overflow-hidden rounded-[20px] text-purple-300">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={product.name}
                        fill
                        unoptimized
                        sizes="(min-width: 1536px) 180px, (min-width: 1024px) 220px, 45vw"
                        className="object-contain"
                        onError={() =>
                          setFailedImages((current) => {
                            const next = new Set(current);
                            next.add(suggestion.key);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <Icon size={38} strokeWidth={1.5} />
                    )}
                  </div>
                  <p className="mt-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-purple-300">
                    {suggestion.label}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-slate-200">
                    {suggestion.prompt}
                  </p>
                </button>
              );
            })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => scrollCategories("right")}
            aria-label="Show more categories"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-blue-600 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.45)] transition hover:border-blue-300 hover:bg-slate-50 sm:h-12 sm:w-12"
          >
            <ChevronRight size={25} />
          </button>
        </div>
      </div>
    </div>
  );
}
