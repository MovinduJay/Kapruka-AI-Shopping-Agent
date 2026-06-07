"use client";

import type { KeyboardEvent } from "react";
import {
  CakeSlice,
  Flower2,
  House,
  Laptop,
  Shirt,
  ShoppingBasket,
  Send,
  Sparkles,
} from "lucide-react";

const suggestions = [
  {
    label: "Cakes",
    prompt: "Show me popular cakes available for delivery",
    icon: CakeSlice,
  },
  {
    label: "Flowers",
    prompt: "Show me fresh flower bouquets available for delivery",
    icon: Flower2,
  },
  {
    label: "Electronics",
    prompt: "Show me wireless earbuds under Rs. 15,000",
    icon: Laptop,
  },
  {
    label: "Groceries",
    prompt: "Find pantry and household essentials for this week",
    icon: ShoppingBasket,
  },
  {
    label: "Fashion",
    prompt: "Show me casual clothing and accessories under Rs. 10,000",
    icon: Shirt,
  },
  {
    label: "Home & living",
    prompt: "Show me useful home and kitchen products",
    icon: House,
  },
];

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
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      onSubmit();
    }
  }

  return (
    <div className="flex flex-1 items-center overflow-hidden px-4 py-10 font-sans sm:px-6">
      <div className="mx-auto w-full max-w-6xl text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-emerald-500/20">
          <Sparkles className="text-emerald-300" size={40} />
        </div>

        <h2 className="mt-8 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
          Shop across Kapruka.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-xl tracking-[-0.02em] text-slate-300 sm:text-3xl">
          What do you need today?
        </p>

        <div className="mx-auto mt-8 flex w-full max-w-3xl gap-2 rounded-full border border-emerald-400/60 bg-white/[0.07] p-2 shadow-[0_20px_60px_-30px_rgba(16,185,129,0.6)]">
          <div className="flex items-center pl-3 text-emerald-300">
            <Sparkles size={20} />
          </div>
          <input
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder="What are you shopping for?"
            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-base text-white outline-none placeholder:text-slate-500 sm:text-lg"
          />
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={!input.trim()}
            aria-label="Start shopping"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-400 disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </div>

        <div className="mx-auto mt-8 flex max-w-5xl snap-x gap-4 overflow-x-auto px-1 pb-3 text-left [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {suggestions.map((suggestion) => {
            const Icon = suggestion.icon;

            return (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => onSubmit(suggestion.prompt)}
                className="min-h-48 w-56 shrink-0 snap-center rounded-[28px] border border-white/10 bg-white/[0.06] p-5 text-left shadow-lg transition hover:-translate-y-1 hover:border-emerald-400/50 hover:bg-white/10 sm:w-60"
              >
                <div className="flex h-20 items-center justify-center rounded-2xl bg-slate-900/70 text-emerald-300">
                  <Icon size={38} strokeWidth={1.5} />
                </div>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                  {suggestion.label}
                </p>
                <p className="mt-2 text-sm leading-5 text-slate-200">
                  {suggestion.prompt}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
