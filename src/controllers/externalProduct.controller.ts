import { Request, Response } from "express";
import { env } from "../config/env";

type ExternalProductSource = "amazon" | "flipkart" | "spares";
type ExternalSearchProvider = "auto" | "brave" | "google";

type GoogleSearchApiItem = {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: {
    cse_image?: Array<{ src?: string }>;
    cse_thumbnail?: Array<{ src?: string }>;
    metatags?: Array<Record<string, string>>;
  };
};

type GoogleSearchApiResponse = {
  items?: GoogleSearchApiItem[];
  error?: {
    message?: string;
  };
};

type BraveSearchApiItem = {
  title?: string;
  url?: string;
  description?: string;
  profile?: {
    name?: string;
    long_name?: string;
    url?: string;
    img?: string;
  };
};

type BraveSearchApiResponse = {
  web?: {
    results?: BraveSearchApiItem[];
  };
  error?: {
    detail?: string;
    message?: string;
  };
};

type NormalizedExternalProductResult = {
  source: ExternalProductSource;
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  image: string;
};

type ExternalSourcePlatform = string;

type ExternalSourceImportResult = {
  externalSource: {
    platform: ExternalSourcePlatform;
    externalProductIdType: string;
    externalProductId: string;
    sourceUrl: string;
  };
  productName: string;
  category: string;
  description: string;
  image: string;
  price: string;
  priceCurrency: string;
  availability: string;
  warranty: string;
  brandName: string;
  manufacturer: string;
  modelNumber: string;
  productType: string;
  originCountry: string;
  warrantyDescription: string;
  baseProductWarrantyPeriod: string;
  baseProductWarrantyPeriodUnit: string;
  featureBullets: string[];
  technicalDetails: Record<string, string>;
};

type JsonLdNode = Record<string, unknown>;
type ExternalProductIdentifier = {
  externalProductId: string;
  externalProductIdType: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function cleanTextContent(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImportedText(value: string) {
  return cleanTextContent(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAllSparesTitleSuffix(value: string) {
  return value.replace(/\s*-\s*All\s+Spares\s*$/i, "").trim();
}

function normalizeExternalSourceValue(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getPrimaryDomainLabel(hostname: string) {
  const normalized = normalizeDomain(hostname).replace(/^www\./i, "");
  const parts = normalized.split(".").filter(Boolean);

  if (parts.length === 0) {
    return "WEBSITE";
  }

  if (parts.length === 1) {
    return normalizeExternalSourceValue(parts[0]) || "WEBSITE";
  }

  const secondaryDomainParts = new Set(["co", "com", "net", "org", "gov", "ac"]);
  const tld = parts[parts.length - 1];
  const secondLevelDomain = parts[parts.length - 2];
  const domainLabel =
    parts.length >= 3 &&
    tld.length === 2 &&
    secondaryDomainParts.has(secondLevelDomain)
      ? parts[parts.length - 3]
      : secondLevelDomain;

  return normalizeExternalSourceValue(domainLabel) || "WEBSITE";
}

function extractMetaTagContent(
  html: string,
  attributeName: "property" | "name",
  attributeValue: string
) {
  const escapedValue = escapeRegExp(attributeValue);
  const patterns = [
    new RegExp(
      `<meta[^>]+${attributeName}=["']${escapedValue}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+${attributeName}=["']${escapedValue}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }

  return "";
}

function extractLinkHref(html: string, relValue: string) {
  const escapedValue = escapeRegExp(relValue);
  const patterns = [
    new RegExp(
      `<link[^>]+rel=["']${escapedValue}["'][^>]+href=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<link[^>]+href=["']([^"']*)["'][^>]+rel=["']${escapedValue}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }

  return "";
}

function collectJsonLdNodes(value: unknown): JsonLdNode[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonLdNodes(item));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const nodes = [record];

  if (Array.isArray(record["@graph"])) {
    nodes.push(...collectJsonLdNodes(record["@graph"]));
  }

  return nodes;
}

function extractJsonLdNodes(html: string) {
  const nodes: JsonLdNode[] = [];
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    const rawPayload = String(match[1] || "").trim();

    if (!rawPayload) {
      continue;
    }

    try {
      const parsedPayload = JSON.parse(rawPayload);
      nodes.push(...collectJsonLdNodes(parsedPayload));
    } catch {
      continue;
    }
  }

  return nodes;
}

function normalizeJsonLdType(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").toLowerCase());
  }

  const normalized = String(value || "").toLowerCase().trim();
  return normalized ? [normalized] : [];
}

function findJsonLdNodeByType(nodes: JsonLdNode[], expectedType: string) {
  const normalizedExpectedType = expectedType.toLowerCase();

  return (
    nodes.find((node) =>
      normalizeJsonLdType(node["@type"]).includes(normalizedExpectedType)
    ) || null
  );
}

function extractAllSparesWidgetData(html: string) {
  const match = html.match(/space="widget\/ecommerce"\s+data="([^"]+)"/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function extractAllSparesWarranty(html: string) {
  const match = html.match(
    /Warranty:\s*<span[^>]*>([\s\S]*?)<\/span>/i
  );

  return match?.[1] ? cleanTextContent(match[1]) : "";
}

function extractAllSparesAvailability(html: string) {
  const match = html.match(
    /component_product_in-stock_title[^>]*>\s*Availability[^:]*:\s*<\/span>\s*<span[^>]*>[\s\S]*?<i[^>]*>([\s\S]*?)<\/i>/i
  );

  return match?.[1] ? cleanTextContent(match[1]) : "";
}

function extractAllSparesProductId(params: {
  html: string;
  image: string;
  widgetData: Record<string, any> | null;
}) {
  const widgetProductId =
    params.widgetData?.dynx?.google_tag_params?.ecomm_prodid ?? "";
  const normalizedWidgetProductId = String(widgetProductId || "").trim();

  if (normalizedWidgetProductId) {
    return normalizedWidgetProductId;
  }

  const htmlProductIdMatch = params.html.match(
    /All-Spares product ID is[:\s<]+(\d+)/i
  );

  if (htmlProductIdMatch?.[1]) {
    return htmlProductIdMatch[1].trim();
  }

  const imageProductIdMatch = params.image.match(/\/p\/(\d+)\//i);
  return imageProductIdMatch?.[1]?.trim() || "";
}

function normalizeAvailabilityStatus(value: string) {
  return value
    .replace(/^https?:\/\/schema\.org\//i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function getJsonLdObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getJsonLdScalarValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeImportedText(String(value));
  }

  return "";
}

function extractTitleTagContent(html: string) {
  return cleanTextContent(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractOfferNode(productJsonLd: JsonLdNode | null) {
  if (!productJsonLd) {
    return null;
  }

  const offers = productJsonLd.offers;

  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const normalizedOffer = getJsonLdObject(offer);

      if (normalizedOffer) {
        return normalizedOffer;
      }
    }

    return null;
  }

  return getJsonLdObject(offers);
}

function extractCategoryFromBreadcrumb(nodes: JsonLdNode[]) {
  const breadcrumbNode = findJsonLdNodeByType(nodes, "BreadcrumbList");
  const items = Array.isArray(breadcrumbNode?.itemListElement)
    ? breadcrumbNode.itemListElement
    : [];

  const labels = items
    .map((item) => {
      const breadcrumbItem = getJsonLdObject(item);

      if (!breadcrumbItem) {
        return "";
      }

      const directName = getJsonLdScalarValue(breadcrumbItem.name);

      if (directName) {
        return directName;
      }

      const innerItem = getJsonLdObject(breadcrumbItem.item);
      return getJsonLdScalarValue(innerItem?.name);
    })
    .filter(Boolean);

  if (labels.length >= 2) {
    return labels[labels.length - 2];
  }

  return labels[0] || "";
}

function extractProductCategory(productJsonLd: JsonLdNode | null, nodes: JsonLdNode[]) {
  if (productJsonLd?.category) {
    if (Array.isArray(productJsonLd.category)) {
      for (const item of productJsonLd.category) {
        const normalized = getJsonLdScalarValue(item);

        if (normalized) {
          return normalized;
        }
      }
    }

    const normalizedCategory = getJsonLdScalarValue(productJsonLd.category);

    if (normalizedCategory) {
      return normalizedCategory;
    }
  }

  return extractCategoryFromBreadcrumb(nodes);
}

function extractGenericWarranty(html: string) {
  const match = html.match(
    /Warranty(?:[^A-Za-z0-9]{0,20}|(?:\s*[:\-]\s*))(?:<[^>]+>)*([^<]{2,80})/i
  );

  if (!match?.[1]) {
    return "";
  }

  const cleanedWarranty = normalizeImportedText(match[1]);

  if (
    !cleanedWarranty ||
    /class=|a-section|aok-hidden|script|function|display\s*:|onclick=|href=/i.test(
      cleanedWarranty
    )
  ) {
    return "";
  }

  return cleanedWarranty;
}

function normalizeDetailKey(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s/]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function extractHtmlDetailRows(html: string) {
  const details: Record<string, string> = {};
  const rowPattern =
    /<tr[^>]*>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>\s*<\/tr>/gi;

  for (const match of html.matchAll(rowPattern)) {
    const rawLabel = normalizeImportedText(match[1] || "");
    const rawValue = normalizeImportedText(match[2] || "");
    const normalizedKey = normalizeDetailKey(rawLabel);

    if (!normalizedKey || !rawValue) {
      continue;
    }

    if (!details[normalizedKey]) {
      details[normalizedKey] = rawValue;
    }
  }

  return details;
}

function getDetailValue(
  details: Record<string, string>,
  keyCandidates: string[]
) {
  for (const key of keyCandidates) {
    const match = details[normalizeDetailKey(key)];

    if (match) {
      return match;
    }
  }

  return "";
}

function extractFeatureBullets(html: string) {
  const bullets: string[] = [];
  const bulletPattern =
    /<li[^>]*>\s*<span[^>]*class=["'][^"']*a-list-item[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/li>/gi;

  for (const match of html.matchAll(bulletPattern)) {
    const value = normalizeImportedText(match[1] || "");

    if (value) {
      bullets.push(value);
    }
  }

  return Array.from(new Set(bullets));
}

function extractBrandName(
  productJsonLd: JsonLdNode | null,
  html: string,
  details: Record<string, string>
) {
  const brandValue = productJsonLd?.brand;

  if (typeof brandValue === "string") {
    return normalizeImportedText(brandValue);
  }

  const brandObject = getJsonLdObject(brandValue);
  const jsonLdBrandName = getJsonLdScalarValue(brandObject?.name);

  if (jsonLdBrandName) {
    return jsonLdBrandName;
  }

  const detailsBrand =
    getDetailValue(details, ["Brand", "Manufacturer"]) ||
    extractMetaTagContent(html, "name", "brand");

  if (detailsBrand) {
    return detailsBrand;
  }

  const scriptedBrandMatch = html.match(/"brand":"([^"]+)"/i);
  return scriptedBrandMatch?.[1]
    ? normalizeImportedText(scriptedBrandMatch[1])
    : "";
}

function extractScriptedNumericValue(html: string, key: string) {
  const match = html.match(
    new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  );

  return match?.[1] ? normalizeImportedText(match[1]) : "";
}

function extractScriptedStringValue(html: string, key: string) {
  const match = html.match(
    new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"]+)"`, "i")
  );

  return match?.[1] ? normalizeImportedText(match[1]) : "";
}

function parseWarrantyPeriod(value: string) {
  const normalizedValue = normalizeImportedText(value);
  const match = normalizedValue.match(
    /(\d+(?:\.\d+)?)\s*(day|days|month|months|year|years)/i
  );

  if (!match) {
    return {
      baseProductWarrantyPeriod: "",
      baseProductWarrantyPeriodUnit: "",
    };
  }

  const unit = match[2].toLowerCase();
  const normalizedUnit = unit.startsWith("day")
    ? "Days"
    : unit.startsWith("month")
      ? "Months"
      : "Years";

  return {
    baseProductWarrantyPeriod: match[1],
    baseProductWarrantyPeriodUnit: normalizedUnit,
  };
}

function normalizeSourceUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";

  if (!url.pathname) {
    url.pathname = "/";
  }

  return url.toString();
}

function isAllSparesDomain(value: string) {
  const normalized = normalizeDomain(value).replace(/^www\./i, "");
  return normalized === "all-spares.com" || normalized.endsWith(".all-spares.com");
}

function detectExternalSourcePlatform(hostname: string): ExternalSourcePlatform {
  if (isAmazonDomain(hostname)) {
    return "AMAZON";
  }

  if (isFlipkartDomain(hostname)) {
    return "FLIPKART";
  }

  if (isAllSparesDomain(hostname)) {
    return "ALL_SPARES";
  }

  return getPrimaryDomainLabel(hostname);
}

function detectIdentifierFromUrl(url: URL): ExternalProductIdentifier {
  const host = url.hostname;
  const path = url.pathname;

  if (isAmazonDomain(host)) {
    const asinMatch = path.match(
      /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i
    );

    return {
      externalProductId: asinMatch?.[1]?.toUpperCase() || "",
      externalProductIdType: asinMatch ? "ASIN" : "",
    };
  }

  if (isFlipkartDomain(host)) {
    const pid = (url.searchParams.get("pid") || "").trim().toUpperCase();

    return {
      externalProductId: pid,
      externalProductIdType: pid ? "PID" : "",
    };
  }

  const queryParamMatches: Array<[string, string]> = [
    ["product_id", "PRODUCT_ID"],
    ["productid", "PRODUCT_ID"],
    ["item_id", "ITEM_ID"],
    ["itemid", "ITEM_ID"],
    ["sku", "SKU"],
    ["asin", "ASIN"],
    ["pid", "PID"],
    ["id", "ID"],
  ];

  for (const [key, label] of queryParamMatches) {
    const value = (url.searchParams.get(key) || "").trim();

    if (value) {
      return {
        externalProductId: value,
        externalProductIdType: label,
      };
    }
  }

  return {
    externalProductId: "",
    externalProductIdType: "",
  };
}

function detectIdentifierFromProductJsonLd(
  productJsonLd: JsonLdNode | null
): ExternalProductIdentifier {
  if (!productJsonLd) {
    return {
      externalProductId: "",
      externalProductIdType: "",
    };
  }

  const candidates: Array<[string, string]> = [
    ["productID", "PRODUCT_ID"],
    ["sku", "SKU"],
    ["mpn", "MPN"],
    ["gtin14", "GTIN14"],
    ["gtin13", "GTIN13"],
    ["gtin12", "GTIN12"],
    ["gtin8", "GTIN8"],
    ["gtin", "GTIN"],
  ];

  for (const [field, label] of candidates) {
    const value = getJsonLdScalarValue(productJsonLd[field]);

    if (value) {
      return {
        externalProductId: value,
        externalProductIdType: label,
      };
    }
  }

  return {
    externalProductId: "",
    externalProductIdType: "",
  };
}

function detectIdentifierFromHtml(html: string): ExternalProductIdentifier {
  const patterns: Array<[RegExp, string]> = [
    [/<meta[^>]+property=["']product:retailer_item_id["'][^>]+content=["']([^"']+)["']/i, "PRODUCT_ID"],
    [/<meta[^>]+name=["']sku["'][^>]+content=["']([^"']+)["']/i, "SKU"],
    [/<meta[^>]+property=["']og:sku["'][^>]+content=["']([^"']+)["']/i, "SKU"],
    [/<meta[^>]+itemprop=["']sku["'][^>]+content=["']([^"']+)["']/i, "SKU"],
  ];

  for (const [pattern, label] of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return {
        externalProductId: decodeHtmlEntities(match[1]).trim(),
        externalProductIdType: label,
      };
    }
  }

  return {
    externalProductId: "",
    externalProductIdType: "",
  };
}

function extractProductImage(productJsonLd: JsonLdNode | null, html: string) {
  const imageValue = productJsonLd?.image;

  if (Array.isArray(imageValue)) {
    for (const item of imageValue) {
      const normalized = getJsonLdScalarValue(item);

      if (normalized) {
        return normalized;
      }
    }
  }

  const normalizedImage = getJsonLdScalarValue(imageValue);

  if (normalizedImage) {
    return normalizedImage;
  }

  return (
    extractMetaTagContent(html, "property", "og:image") ||
    extractMetaTagContent(html, "name", "twitter:image") ||
    extractMetaTagContent(html, "name", "twitter:image:src")
  );
}

function cleanImportedProductTitle(
  title: string,
  platform: ExternalSourcePlatform
) {
  const trimmedTitle = normalizeImportedText(title);

  if (platform === "AMAZON") {
    return trimmedTitle
      .replace(/\s*\|\s*amazon\.[a-z.]+.*$/i, "")
      .replace(/\s*-\s*amazon\.[a-z.]+.*$/i, "")
      .replace(/\s*:\s*amazon\.[a-z.]+.*$/i, "")
      .replace(/^amazon\.[a-z.]+\s*:\s*/i, "")
      .trim();
  }

  if (platform === "FLIPKART") {
    return trimmedTitle
      .replace(/\s*\|\s*flipkart(?:\.com)?.*$/i, "")
      .replace(/\s*-\s*flipkart(?:\.com)?.*$/i, "")
      .replace(/^buy\s+/i, "")
      .replace(/\s+online.*$/i, "")
      .trim();
  }

  if (platform === "ALL_SPARES") {
    return stripAllSparesTitleSuffix(trimmedTitle);
  }

  return trimmedTitle;
}

function getImageFromSearchItem(item: GoogleSearchApiItem) {
  const pagemap = item.pagemap;

  return String(
    pagemap?.cse_image?.[0]?.src ||
      pagemap?.cse_thumbnail?.[0]?.src ||
      pagemap?.metatags?.[0]?.["og:image"] ||
      pagemap?.metatags?.[0]?.["twitter:image"] ||
      ""
  ).trim();
}

function getDisplayLinkFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeExternalSearchProvider(value: string): ExternalSearchProvider {
  const normalized = value.trim().toLowerCase();

  if (normalized === "brave" || normalized === "google") {
    return normalized;
  }

  return "auto";
}

function resolveExternalSearchProvider() {
  const preferredProvider = normalizeExternalSearchProvider(
    env.EXTERNAL_SEARCH_PROVIDER
  );
  const hasBraveSearch = Boolean(env.BRAVE_SEARCH_API_KEY);
  const hasGoogleSearch = Boolean(
    env.GOOGLE_PROGRAMMABLE_SEARCH_API_KEY &&
      env.GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID
  );

  if (preferredProvider === "brave") {
    if (!hasBraveSearch) {
      throw new Error("BRAVE_SEARCH_NOT_CONFIGURED");
    }

    return "brave" as const;
  }

  if (preferredProvider === "google") {
    if (!hasGoogleSearch) {
      throw new Error("GOOGLE_PROGRAMMABLE_SEARCH_NOT_CONFIGURED");
    }

    return "google" as const;
  }

  if (hasBraveSearch) {
    return "brave" as const;
  }

  if (hasGoogleSearch) {
    return "google" as const;
  }

  throw new Error("EXTERNAL_SEARCH_NOT_CONFIGURED");
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

function isAmazonDomain(value: string) {
  const normalized = normalizeDomain(value);
  return normalized === "amazon.in" || normalized.endsWith(".amazon.in");
}

function isFlipkartDomain(value: string) {
  const normalized = normalizeDomain(value);
  return normalized === "flipkart.com" || normalized.endsWith(".flipkart.com");
}

function filterResultBySource(source: ExternalProductSource, link: string) {
  try {
    const host = new URL(link).hostname;

    if (source === "amazon") {
      return isAmazonDomain(host);
    }

    if (source === "flipkart") {
      return isFlipkartDomain(host);
    }

    return !isAmazonDomain(host) && !isFlipkartDomain(host);
  } catch {
    return false;
  }
}

function buildSearchQuery(params: {
  keyword: string;
  category: string;
  source: ExternalProductSource;
}) {
  const { keyword, category, source } = params;
  const keywordText = keyword.trim();
  const categoryText = category.trim();

  if (source === "amazon") {
    return `${keywordText} ${categoryText} site:amazon.in`.trim();
  }

  if (source === "flipkart") {
    return `${keywordText} ${categoryText} site:flipkart.com`.trim();
  }

  const lowerSearchText = `${keywordText} ${categoryText}`.toLowerCase();
  const spareTerms = ["mobile spare parts"];

  if (lowerSearchText.includes("batter")) {
    spareTerms.push("battery");
  }

  return `${keywordText} ${categoryText} ${spareTerms.join(" ")}`.trim();
}

async function runGoogleProgrammableSearch(params: {
  keyword: string;
  category: string;
  source: ExternalProductSource;
}) {
  const apiKey = env.GOOGLE_PROGRAMMABLE_SEARCH_API_KEY;
  const searchEngineId = env.GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    throw new Error("GOOGLE_PROGRAMMABLE_SEARCH_NOT_CONFIGURED");
  }

  const query = buildSearchQuery(params);
  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");

  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "6");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");

  const response = await fetch(url);
  const payload =
    (await response.json().catch(() => null)) as GoogleSearchApiResponse | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Google search request failed with status ${response.status}`
    );
  }

  return (payload?.items || [])
    .filter((item) => {
      const link = String(item.link || "").trim();
      return Boolean(link) && filterResultBySource(params.source, link);
    })
    .map<NormalizedExternalProductResult>((item) => ({
      source: params.source,
      title: String(item.title || "").trim(),
      link: String(item.link || "").trim(),
      snippet: String(item.snippet || "").trim(),
      displayLink: String(item.displayLink || "").trim(),
      image: getImageFromSearchItem(item),
    }))
    .filter((item) => item.title && item.link);
}

async function runBraveSearch(params: {
  keyword: string;
  category: string;
  source: ExternalProductSource;
}) {
  const apiKey = env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_NOT_CONFIGURED");
  }

  const query = buildSearchQuery(params);
  const url = new URL("https://api.search.brave.com/res/v1/web/search");

  url.searchParams.set("q", query);
  url.searchParams.set("count", "6");
  url.searchParams.set("country", "IN");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("spellcheck", "true");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("result_filter", "web");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  const payload =
    (await response.json().catch(() => null)) as BraveSearchApiResponse | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.detail ||
        payload?.error?.message ||
        `Brave search request failed with status ${response.status}`
    );
  }

  return (payload?.web?.results || [])
    .filter((item) => {
      const link = String(item.url || "").trim();
      return Boolean(link) && filterResultBySource(params.source, link);
    })
    .map<NormalizedExternalProductResult>((item) => {
      const link = String(item.url || "").trim();

      return {
        source: params.source,
        title: String(item.title || "").trim(),
        link,
        snippet: String(item.description || "").trim(),
        displayLink: String(
          item.profile?.long_name ||
            item.profile?.name ||
            getDisplayLinkFromUrl(link)
        ).trim(),
        image: String(item.profile?.img || "").trim(),
      };
    })
    .filter((item) => item.title && item.link);
}

async function runExternalSearch(params: {
  keyword: string;
  category: string;
  source: ExternalProductSource;
}) {
  const provider = resolveExternalSearchProvider();

  if (provider === "brave") {
    return runBraveSearch(params);
  }

  return runGoogleProgrammableSearch(params);
}

async function fetchSourcePageHtml(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Source page request failed with status ${response.status}`);
  }

  return {
    html,
    responseUrl: normalizeSourceUrl(response.url || sourceUrl),
  };
}

async function fetchAllSparesSourceDetails(
  sourceUrl: string
): Promise<ExternalSourceImportResult> {
  const { html, responseUrl } = await fetchSourcePageHtml(sourceUrl);

  const jsonLdNodes = extractJsonLdNodes(html);
  const productJsonLd = findJsonLdNodeByType(jsonLdNodes, "Product");
  const widgetData = extractAllSparesWidgetData(html) as Record<string, any> | null;
  const canonicalUrl = extractLinkHref(html, "canonical") || responseUrl;
  const featureBullets = extractFeatureBullets(html);
  const title =
    stripAllSparesTitleSuffix(String(productJsonLd?.name || "").trim()) ||
    stripAllSparesTitleSuffix(
      extractMetaTagContent(html, "property", "og:title")
    ) ||
    stripAllSparesTitleSuffix(
      cleanTextContent((html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""))
    );
  const image =
    (Array.isArray(productJsonLd?.image)
      ? String(productJsonLd?.image?.[0] || "").trim()
      : String(productJsonLd?.image || "").trim()) ||
    extractMetaTagContent(html, "property", "og:image");
  const productId = extractAllSparesProductId({
    html,
    image,
    widgetData,
  });
  const category = String(widgetData?.dynx?.cat_l1 || "").trim();
  const offer =
    productJsonLd &&
    typeof productJsonLd.offers === "object" &&
    !Array.isArray(productJsonLd.offers)
      ? (productJsonLd.offers as Record<string, unknown>)
      : {};
  const warrantyDescription = extractAllSparesWarranty(html);
  const warrantyPeriod = parseWarrantyPeriod(warrantyDescription);

  if (!title || !productId) {
    throw new Error(
      "Unable to extract All-Spares product details from the provided URL."
    );
  }

  return {
    externalSource: {
      platform: "ALL_SPARES",
      externalProductIdType: "ALL_SPARES_PRODUCT_ID",
      externalProductId: productId,
      sourceUrl: canonicalUrl,
    },
    productName: title,
    category,
    description:
      String(productJsonLd?.description || "").trim() ||
      extractMetaTagContent(html, "property", "og:description"),
    image,
    price: String(offer.price || "").trim(),
    priceCurrency: String(offer.priceCurrency || "").trim(),
    availability:
      extractAllSparesAvailability(html) ||
      normalizeAvailabilityStatus(String(offer.availability || "").trim()),
    warranty: warrantyDescription,
    brandName: String(widgetData?.dynx?.brand || "").trim(),
    manufacturer: "",
    modelNumber: "",
    productType: category || "",
    originCountry: "",
    warrantyDescription,
    baseProductWarrantyPeriod: warrantyPeriod.baseProductWarrantyPeriod,
    baseProductWarrantyPeriodUnit: warrantyPeriod.baseProductWarrantyPeriodUnit,
    featureBullets,
    technicalDetails: {},
  };
}

async function fetchGenericSourceDetails(
  sourceUrl: string
): Promise<ExternalSourceImportResult> {
  const { html, responseUrl } = await fetchSourcePageHtml(sourceUrl);
  const normalizedResponseUrl = normalizeSourceUrl(responseUrl);
  const url = new URL(normalizedResponseUrl);
  const platform = detectExternalSourcePlatform(url.hostname);

  if (platform === "ALL_SPARES") {
    return fetchAllSparesSourceDetails(normalizedResponseUrl);
  }

  const jsonLdNodes = extractJsonLdNodes(html);
  const productJsonLd = findJsonLdNodeByType(jsonLdNodes, "Product");
  const detailRows = extractHtmlDetailRows(html);
  const offerNode = extractOfferNode(productJsonLd);
  const featureBullets = extractFeatureBullets(html);
  const brandName = extractBrandName(productJsonLd, html, detailRows);
  const manufacturer = getDetailValue(detailRows, [
    "Manufacturer",
    "Manufacturer name",
  ]);
  const modelNumber = getDetailValue(detailRows, [
    "Item model number",
    "Model number",
    "Model name",
  ]);
  const productType =
    getDetailValue(detailRows, [
      "Generic Name",
      "Product Type",
      "Item Type Name",
    ]) || "";
  const originCountry = getDetailValue(detailRows, [
    "Country of Origin",
    "Country / Region Of Origin",
    "Country/Region of origin",
  ]);
  const warrantyDescription =
    getDetailValue(detailRows, [
      "Warranty Description",
      "Warranty",
    ]) || extractGenericWarranty(html);
  const warrantyPeriod = parseWarrantyPeriod(warrantyDescription);
  const title =
    cleanImportedProductTitle(
      getJsonLdScalarValue(productJsonLd?.name) ||
        extractMetaTagContent(html, "property", "og:title") ||
        extractTitleTagContent(html),
      platform
    ) || cleanImportedProductTitle(extractTitleTagContent(html), platform);
  const image = extractProductImage(productJsonLd, html);
  const category = extractProductCategory(productJsonLd, jsonLdNodes);
  const description =
    getJsonLdScalarValue(productJsonLd?.description) ||
    extractMetaTagContent(html, "property", "og:description") ||
    extractMetaTagContent(html, "name", "description") ||
    featureBullets.slice(0, 4).join(" | ");
  const price =
    getJsonLdScalarValue(offerNode?.price) ||
    extractMetaTagContent(html, "property", "product:price:amount") ||
    extractScriptedNumericValue(html, "productPrice") ||
    extractScriptedNumericValue(html, "buyBoxOfferBuyingPrice");
  const priceCurrency =
    getJsonLdScalarValue(offerNode?.priceCurrency) ||
    extractMetaTagContent(html, "property", "product:price:currency") ||
    extractScriptedStringValue(html, "currencyCode");
  const availability = normalizeAvailabilityStatus(
    getJsonLdScalarValue(offerNode?.availability) ||
      extractMetaTagContent(html, "property", "product:availability")
  );
  const warranty = extractGenericWarranty(html);

  const identifierCandidates = [
    detectIdentifierFromUrl(url),
    detectIdentifierFromProductJsonLd(productJsonLd),
    detectIdentifierFromHtml(html),
  ];
  const identifier =
    identifierCandidates.find(
      (candidate) => candidate.externalProductId || candidate.externalProductIdType
    ) || {
      externalProductId: "",
      externalProductIdType: "",
    };

  if (!title && !description && !image) {
    throw new Error(
      "Unable to extract enough product details from the provided URL."
    );
  }

  return {
    externalSource: {
      platform,
      externalProductIdType: identifier.externalProductIdType,
      externalProductId: identifier.externalProductId,
      sourceUrl:
        extractLinkHref(html, "canonical") || normalizedResponseUrl,
    },
    productName: title,
    category,
    description,
    image,
    price,
    priceCurrency,
    availability,
    warranty: warrantyDescription,
    brandName,
    manufacturer,
    modelNumber,
    productType: productType || category || "",
    originCountry,
    warrantyDescription,
    baseProductWarrantyPeriod: warrantyPeriod.baseProductWarrantyPeriod,
    baseProductWarrantyPeriodUnit: warrantyPeriod.baseProductWarrantyPeriodUnit,
    featureBullets,
    technicalDetails: detailRows,
  };
}

export async function fetchExternalSourceDetails(req: Request, res: Response) {
  try {
    const sourceUrl = normalizeSourceUrl(String(req.body?.sourceUrl || ""));
    const result = await fetchGenericSourceDetails(sourceUrl);

    return res.json({
      success: true,
      result,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to fetch external source details";

    if (/invalid url/i.test(message)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid source URL.",
      });
    }

    return res.status(502).json({
      success: false,
      message,
    });
  }
}

export async function searchExternalProducts(
  req: Request,
  res: Response
) {
  try {
    const keyword = String(req.body?.keyword || "").trim();
    const category = String(req.body?.category || "").trim();

    const [amazon, flipkart, spares] = await Promise.all([
      runExternalSearch({
        keyword,
        category,
        source: "amazon",
      }),
      runExternalSearch({
        keyword,
        category,
        source: "flipkart",
      }),
      runExternalSearch({
        keyword,
        category,
        source: "spares",
      }),
    ]);

    return res.json({
      success: true,
      results: {
        amazon,
        flipkart,
        spares,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unable to search products";

    if (
      message === "EXTERNAL_SEARCH_NOT_CONFIGURED" ||
      message === "BRAVE_SEARCH_NOT_CONFIGURED" ||
      message === "GOOGLE_PROGRAMMABLE_SEARCH_NOT_CONFIGURED"
    ) {
      return res.status(503).json({
        success: false,
        message:
          "External search is not configured. Set BRAVE_SEARCH_API_KEY or configure Google Programmable Search with GOOGLE_PROGRAMMABLE_SEARCH_API_KEY/GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID. You can also set EXTERNAL_SEARCH_PROVIDER=brave to force Brave Search.",
      });
    }

    return res.status(502).json({
      success: false,
      message,
    });
  }
}
