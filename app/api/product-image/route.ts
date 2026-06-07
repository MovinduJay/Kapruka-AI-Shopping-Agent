const ALLOWED_IMAGE_HOSTS = new Set([
  "static2.kapruka.com",
  "www.kapruka.com",
  "kapruka.com",
]);

function parseAllowedUrl(value: string | null) {
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

function extractProductImage(html: string) {
  const match =
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    ) ||
    html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    );

  return parseAllowedUrl(match?.[1] || null);
}

async function fetchImage(url: URL) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.startsWith("image/")) {
    return null;
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const imageUrl = parseAllowedUrl(requestUrl.searchParams.get("src"));
  const productUrl = parseAllowedUrl(requestUrl.searchParams.get("product"));

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
        const recoveredImageUrl = extractProductImage(
          await productResponse.text()
        );

        if (recoveredImageUrl) {
          const recoveredImage = await fetchImage(recoveredImageUrl);

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
