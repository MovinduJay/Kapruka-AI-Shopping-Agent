import Image from "next/image";

type Props = {
  size?: number;
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ size = 40, className = "", priority = false }: Props) {
  return (
    <Image
      src="/logo.png"
      alt="Kapruka AI Concierge logo"
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
