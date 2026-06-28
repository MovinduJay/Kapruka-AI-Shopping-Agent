import {
  extractKaprukaProductImages,
  normalizeKaprukaImageUrl,
} from "@/lib/kapruka-images";

const ALLOWED_IMAGE_HOSTS = new Set([
  "static2.kapruka.com",
  "partnercentral.kapruka.com",
  "www.kapruka.com",
  "kapruka.com",
]);

function parseAllowedImageUrl(value: string | null) {
  const normalized = normalizeKaprukaImageUrl(value);

  if (!normalized) return null;

  try {
    const url = new URL(normalized);

    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function parseAllowedProductUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

async function fetchImage(url: URL) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get("content-type") || "";
    const finalUrl = parseAllowedImageUrl(response.url);

    if (!response.ok || !contentType.startsWith("image/") || !finalUrl) {
      return null;
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    // Let the caller recover from the product page's og:image instead.
    return null;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const imageUrl = parseAllowedImageUrl(requestUrl.searchParams.get("src"));
  const productUrl = parseAllowedProductUrl(requestUrl.searchParams.get("product"));

  if (!imageUrl && !productUrl) {
    return new Response("Invalid Kapruka image request.", { status: 400 });
  }

  try {
    if (imageUrl) {
      const imageResponse = await fetchImage(imageUrl);

      if (imageResponse) return imageResponse;
    }

    if (productUrl) {
      const productResponse = await fetch(productUrl, {
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (productResponse.ok) {
        const recoveredImageUrls = extractKaprukaProductImages(
          await productResponse.text(),
          productUrl
        );

        for (const recoveredImageUrl of recoveredImageUrls) {
          const recoveredImage = await fetchImage(new URL(recoveredImageUrl));

          if (recoveredImage) return recoveredImage;
        }
      }
    }

    return new Response("Product image unavailable.", { status: 404 });
  } catch (error) {
    console.error("Product image proxy error:", error);
    return new Response("Product image unavailable.", { status: 502 });
  }
}
