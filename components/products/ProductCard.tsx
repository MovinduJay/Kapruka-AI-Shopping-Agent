import { ExternalLink, ImageIcon, ShoppingCart } from "lucide-react";
import type { ProductCard as ProductCardType } from "@/types/product";

type Props = {
  product: ProductCardType;
  onAddToCart: (product: ProductCardType) => void;
};

export function ProductCard({ product, onAddToCart }: Props) {
  return (
    <div className="group overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] shadow-xl transition hover:-translate-y-1 hover:bg-white/[0.09]">
      <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-emerald-500/20 via-slate-800 to-slate-950">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImageIcon size={34} />
            <span className="text-xs">Image coming soon</span>
          </div>
        )}

        <div className="absolute left-3 top-3 rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-slate-950">
          Match
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 text-sm font-semibold text-white">
            {product.name}
          </h3>

          <p className="mt-2 text-lg font-bold text-emerald-300">
            Rs. {product.price?.toLocaleString() ?? "N/A"}
          </p>
        </div>

        <p className="line-clamp-2 text-xs leading-5 text-slate-400">
          {product.reason || "Good match for your request."}
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => onAddToCart(product)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
          >
            <ShoppingCart size={14} />
            Add
          </button>

          {product.productUrl && (
            <a
              href={product.productUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/10"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}