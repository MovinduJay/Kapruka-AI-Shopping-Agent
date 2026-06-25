export type ProductCard = {
  id: string;
  name: string;
  price: number | null;
  currency: "LKR";
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  inStock?: boolean | null;
  stockLevel?: "low" | "medium" | "high" | null;
  description?: string | null;
  reason?: string;
  rating?: number | null;
  reviewCount?: number | null;
  brand?: string | null;
  category?: string | null;
  shipsInternationally?: boolean | null;
  freeShipping?: boolean | null;
  priceValidUntil?: string | null;
  agentScore?: number;
  rankingReason?: string;
};

export type CartItem = ProductCard & {
  quantity: number;
};

export type ProductQuestion = {
  question: string;
  answer: string;
};

export type ProductSpecification = {
  label: string;
  value: string;
};

export type ProductDetails = {
  name: string | null;
  description: string | null;
  images: string[];
  highlights: string[];
  specifications: ProductSpecification[];
  questions: ProductQuestion[];
};
