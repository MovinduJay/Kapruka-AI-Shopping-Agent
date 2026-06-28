const ALLOWED_IMAGE_HOSTS = new Set([
  "static2.kapruka.com",
  "partnercentral.kapruka.com",
  "www.kapruka.com",
  "kapruka.com",
]);

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: "-",
    mdash: "-",
  };

  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) =>
      name.toLowerCase() in namedEntities
        ? namedEntities[name.toLowerCase()]
        : entity
    )
    .replace(/\\\//g, "/");
}

export function normalizeKaprukaImageUrl(value: string | null | undefined) {
  if (!value) return null;

  const decoded = decodeHtml(value.trim().replace(/[),.]+$/g, ""));

  if (!decoded) return null;

  try {
    const url = new URL(
      decoded.startsWith("//") ? `https:${decoded}` : decoded,
      "https://www.kapruka.com"
    );

    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
      return null;
    }

    if (
      /(?:youtube|play[_-]?button|logo|sprite|placeholder|icon|blank|loading)/i.test(
        url.pathname
      )
    ) {
      return null;
    }

    url.searchParams.delete("v");
    return url.toString();
  } catch {
    return null;
  }
}

function comparableImageToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function productImageTokens(productUrl?: URL | null) {
  const rawProductId = productUrl?.pathname.match(/\/kid\/([^/?#]+)/i)?.[1] || "";
  const normalizedProductId = comparableImageToken(rawProductId);
  const tokens = new Set<string>();

  if (normalizedProductId.length >= 8) {
    tokens.add(normalizedProductId);
    tokens.add(normalizedProductId.replace(/^efpc/, ""));
    tokens.add(normalizedProductId.replace(/pod(\d+)p?$/i, "p$1"));
    tokens.add(
      normalizedProductId.replace(/^efpc/, "").replace(/pod(\d+)p?$/i, "p$1")
    );
  }

  const coreMatch = normalizedProductId.match(/[a-z]+0v\d+(?:pod)?\d+p?/i);

  if (coreMatch?.[0]) {
    const core = coreMatch[0];

    tokens.add(core);
    tokens.add(core.replace(/pod(\d+)p?$/i, "p$1"));
  }

  return [...tokens].filter((token) => token.length >= 8);
}

function imageBelongsToProduct(imageUrl: string, productTokens: string[]) {
  if (productTokens.length === 0) return true;

  const imageToken = comparableImageToken(imageUrl);

  return productTokens.some((token) => imageToken.includes(token));
}

function uniqueImages(values: string[], limit = 12) {
  const unique = new Map<string, string>();

  for (const value of values) {
    try {
      const url = new URL(value);
      const filename = url.pathname.split("/").pop()?.toLowerCase();
      const key = filename || url.toString();

      if (!unique.has(key)) unique.set(key, value);
    } catch {
      if (!unique.has(value)) unique.set(value, value);
    }
  }

  return [...unique.values()].slice(0, limit);
}

function srcsetUrls(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function extractKaprukaProductImages(
  html: string,
  productUrl?: URL | null
) {
  const productTokens = productImageTokens(productUrl);
  const urls: string[] = [];
  const galleryStart = html.search(/id=["']sync1["']|class=["'][^"']*(?:product|gallery|zoom|owl-carousel)/i);
  const galleryEnd =
    galleryStart >= 0
      ? html.slice(galleryStart).search(/id=["']sync2["']|id=["']Tab1["']|class=["'][^"']*related/i)
      : -1;
  const gallery =
    galleryStart >= 0
      ? html.slice(
          galleryStart,
          galleryEnd > 0 ? galleryStart + galleryEnd : galleryStart + 40_000
        )
      : html.slice(0, 120_000);

  const addUrl = (value: string | null | undefined) => {
    const url = normalizeKaprukaImageUrl(value);

    if (url && imageBelongsToProduct(url, productTokens)) urls.push(url);
  };

  for (const match of gallery.matchAll(
    /\b(?:src|data-src|data-large|data-zoom-image|data-original|data-lazy|href)=["']([^"']+\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"']*)?)["']/gi
  )) {
    addUrl(match[1]);
  }

  for (const match of gallery.matchAll(/\b(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    for (const url of srcsetUrls(match[1])) addUrl(url);
  }

  for (const match of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi
  )) {
    addUrl(match[1]);
  }

  for (const match of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/gi
  )) {
    addUrl(match[1]);
  }

  for (const match of html.matchAll(
    /["'](?:image|image_url|imageUrl|mainImage|thumbnail|thumbnail_url|zoomImage|large)["']\s*:\s*["']([^"']+\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"']*)?)["']/gi
  )) {
    addUrl(match[1]);
  }

  for (const match of html.matchAll(
    /https?:\\?\/\\?\/(?:static2\.kapruka\.com|partnercentral\.kapruka\.com|www\.kapruka\.com|kapruka\.com)[^"' <>)]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"' <>)]+)?/gi
  )) {
    addUrl(decodeHtml(match[0]));
  }

  return uniqueImages(urls);
}
