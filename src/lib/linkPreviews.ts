export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

const LINK_PREVIEW_STORAGE_KEY = 'linkPreviewCache:v1';
const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

type CacheEntry = {
  fetchedAt: number;
  data: LinkPreviewData;
};

const readCache = (): Record<string, CacheEntry> => {
  try {
    const raw = localStorage.getItem(LINK_PREVIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeCache = (cache: Record<string, CacheEntry>) => {
  try {
    localStorage.setItem(LINK_PREVIEW_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage quota errors
  }
};

const normalizeUrl = (rawUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const withScheme = (() => {
    // Accept common “naked” URLs like `www.example.com`
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  })();

  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const decodeHtmlEntities = (value: string) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

const extractMetaContent = (html: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    // Handle both quoted and unquoted content attributes
    let content = raw;
    // Remove surrounding quotes if present
    if ((content.startsWith('"') && content.endsWith('"')) ||
      (content.startsWith("'") && content.endsWith("'"))) {
      content = content.slice(1, -1);
    }
    return decodeHtmlEntities(content);
  }
  return null;
};

const absolutizeUrl = (maybeRelative: string | null, pageUrl: string): string | null => {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, pageUrl).toString();
  } catch {
    return null;
  }
};

const fetchHtmlViaJina = async (url: string): Promise<string> => {
  // `r.jina.ai` is a CORS-friendly read-through service that returns HTML as text.
  // It is a pragmatic choice for static apps without a backend proxy.
  try {
    // NOTE: r.jina.ai expects the raw URL after the slash (do NOT encode it).
    const target = `https://r.jina.ai/${url}`;
    const res = await fetch(target, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new Error(`Link preview fetch failed (${res.status})`);
    }
    const html = await res.text();
    if (!html || html.length < 100) {
      throw new Error('Received empty or too short HTML');
    }
    return html;
  } catch (error) {
    console.warn('Jina.ai fetch failed, trying direct fetch:', error);
    // Fallback: try direct fetch (may fail due to CORS, but worth trying)
    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'no-cors', // This won't work for reading response, but we try
      });
      // If no-cors, we can't read the response, so throw
      throw new Error('Direct fetch blocked by CORS');
    } catch {
      throw error;
    }
  }
};

export const getLinkPreview = async (rawUrl: string): Promise<LinkPreviewData | null> => {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;

  const cache = readCache();
  const cached = cache[url];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  let html: string;
  try {
    html = await fetchHtmlViaJina(url);
  } catch (error) {
    console.error('Failed to fetch HTML for link preview:', url, error);
    // Return minimal data so at least the URL is shown
    return {
      url,
      title: null,
      description: null,
      imageUrl: null,
      siteName: null,
    };
  }

  // More robust meta extraction - handles various quote styles and attribute orders
  const ogTitle = extractMetaContent(html, [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:title["'][^>]*>/i,
    /<meta\s+property=["']og:title["']\s+content=([^\s>]+)[^>]*>/i,
    /<meta\s+content=([^\s>]+)\s+property=["']og:title["'][^>]*>/i,
  ]);
  const ogDescription = extractMetaContent(html, [
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:description["'][^>]*>/i,
    /<meta\s+name=["']description["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+name=["']description["'][^>]*>/i,
    /<meta\s+property=["']og:description["']\s+content=([^\s>]+)[^>]*>/i,
    /<meta\s+name=["']description["']\s+content=([^\s>]+)[^>]*>/i,
  ]);
  const ogImage = extractMetaContent(html, [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:image["'][^>]*>/i,
    /<meta\s+property=["']og:image["']\s+content=([^\s>]+)[^>]*>/i,
    /<meta\s+property=["']og:image:url["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+property=["']og:image:secure_url["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+property=["']twitter:image["']\s+content=["']([^"']*?)["'][^>]*>/i,
  ]);
  const ogSiteName = extractMetaContent(html, [
    /<meta\s+property=["']og:site_name["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:site_name["'][^>]*>/i,
  ]);
  const titleTag = extractMetaContent(html, [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<title[^>]*>([^<]*?)<\/title>/i,
  ]);

  const data: LinkPreviewData = {
    url,
    title: ogTitle ?? titleTag ?? null,
    description: ogDescription ?? null,
    imageUrl: absolutizeUrl(ogImage, url),
    siteName: ogSiteName ?? null,
  };

  // Trim cache and persist
  const nextCache = { ...cache, [url]: { fetchedAt: Date.now(), data } };
  const entries = Object.entries(nextCache).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
  writeCache(trimmed);

  return data;
};


export const isProbablyUrl = (text: string): boolean => {
  return normalizeUrl(text) !== null;
};

export const isImageUrl = (url: string): boolean => {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
};

