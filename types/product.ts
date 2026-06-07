export type ProductCard = {
  id: string;
  name: string;
  price: number | null;
  currency: "LKR";
  imageUrl?: string | null;
  productUrl?: string | null;
  inStock?: boolean | null;
  reason?: string;
};