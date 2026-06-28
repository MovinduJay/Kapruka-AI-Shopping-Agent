import type {
  ProductDetails,
  ProductQuestion,
  ProductSpecification,
} from "@/types/product";
import { extractKaprukaProductImages } from "@/lib/kapruka-images";

const ALLOWED_PRODUCT_HOSTS = new Set([
  "www.kapruka.com",
  "kapruka.com",
]);

function parseProductUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      !ALLOWED_PRODUCT_HOSTS.has(url.hostname) ||
      !url.pathname.toLowerCase().includes("/buyonline/")
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

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
    );
}

function textFromHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|div|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
      .replace(/<\/?[a-z][^>]*$/i, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueClean(values: string[], limit: number) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    limit
  );
}

function extractName(html: string) {
  const match =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return match ? textFromHtml(match[1]).replace(/\s*\|\s*Kapruka.*$/i, "") : null;
}

function extractImages(html: string, productUrl: URL) {
  return extractKaprukaProductImages(html, productUrl);
}

function extractDetailsRegion(html: string) {
  const detailsStart = html.search(/id=["']Tab1["']/i);
  const questionsStart = html.search(/id=["']Tab2["']/i);

  if (detailsStart < 0) return "";

  const questionsTagStart =
    questionsStart > detailsStart
      ? html.lastIndexOf("<", questionsStart)
      : -1;
  const detailsEnd =
    questionsTagStart > detailsStart
      ? questionsTagStart
      : questionsStart > detailsStart
        ? questionsStart
        : detailsStart + 30_000;

  return html.slice(detailsStart, detailsEnd);
}

function extractHighlights(detailsRegion: string) {
  const highlights: string[] = [];

  for (const match of detailsRegion.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const value = textFromHtml(match[1]);
    if (value.length >= 3) highlights.push(value);
  }

  return uniqueClean(highlights, 10);
}

function extractDescription(detailsRegion: string) {
  const descriptionMatch = detailsRegion.match(
    /class=["'][^"']*detailDescription[^"']*["'][^>]*>([\s\S]*)/i
  );
  const raw = descriptionMatch?.[1] || detailsRegion;
  const withoutLists = raw.replace(/<ul[\s\S]*?<\/ul>/gi, " ");
  const description = textFromHtml(withoutLists);

  return description ? description.slice(0, 4000) : null;
}

function extractSpecifications(html: string) {
  const specifications: ProductSpecification[] = [];

  for (const match of html.matchAll(
    /<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi
  )) {
    const label = textFromHtml(match[1]);
    const value = textFromHtml(match[2]);

    if (label && value && label.length <= 80 && value.length <= 300) {
      specifications.push({ label, value });
    }
  }

  const unique = new Map<string, ProductSpecification>();

  for (const specification of specifications) {
    const key = specification.label.toLowerCase();
    if (!unique.has(key)) unique.set(key, specification);
  }

  return [...unique.values()].slice(0, 20);
}

function extractQuestions(html: string) {
  const questionsStart = html.search(/id=["']Tab2["']/i);
  if (questionsStart < 0) return [];

  const region = html.slice(questionsStart, questionsStart + 50_000);
  const questions: ProductQuestion[] = [];
  const pattern =
    /<button[^>]*class=["'][^"']*accordion[^"']*["'][^>]*>([\s\S]*?)<\/button>\s*<div[^>]*class=["'][^"']*panel[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

  for (const match of region.matchAll(pattern)) {
    const question = textFromHtml(match[1]);
    const answer = textFromHtml(match[2]);

    if (question && answer) questions.push({ question, answer });
  }

  return questions.slice(0, 12);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const productUrl = parseProductUrl(requestUrl.searchParams.get("url"));

  if (!productUrl) {
    return Response.json(
      { error: "Invalid Kapruka product URL." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(productUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 KaprukaAIConcierge/1.0",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json(
        { error: "Kapruka product page is unavailable." },
        { status: response.status }
      );
    }

    const html = await response.text();
    const detailsRegion = extractDetailsRegion(html);
    const details: ProductDetails = {
      name: extractName(html),
      description: extractDescription(detailsRegion),
      images: extractImages(html, productUrl),
      highlights: extractHighlights(detailsRegion),
      specifications: extractSpecifications(detailsRegion),
      questions: extractQuestions(html),
    };

    return Response.json(details, {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Product details error:", error);
    return Response.json(
      { error: "Could not load the product details right now." },
      { status: 502 }
    );
  }
}
