import { WebSearchResults } from './webSearch';

export type ResultItemType = 'video' | 'article' | 'image' | 'snippet';

export type ResultItem = {
  id: string;
  type: ResultItemType;
  title: string;
  url?: string;
  snippet?: string;
  thumbnail?: string;
  source?: string;
  code?: string;
  language?: string;
};

export const resultCardClasses = {
  block: 'my-4 space-y-3',
  header: 'text-[11px] uppercase tracking-wider text-gray-500 font-medium',
  headerRow: 'flex items-center justify-between gap-2',
  section: 'space-y-3',
  sectionTitle: 'text-xs font-semibold text-gray-700 tracking-tight',
  item: 'rounded-md border border-gray-200 bg-white p-3',
  itemInteractive:
    'cursor-pointer hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
  itemRow: 'flex gap-3',
  itemContent: 'flex-1 min-w-0',
  itemTitle: 'text-sm font-medium text-gray-900 leading-snug',
  itemSnippet: 'mt-1 text-xs text-gray-600 leading-relaxed',
  quote: 'border-l-2 border-gray-200 pl-2 text-xs text-gray-600 italic',
  citation: 'mt-2 text-[11px] text-gray-500 truncate',
  badge:
    'mb-2 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600',
  thumbnail: 'w-20 h-16 object-cover rounded flex-shrink-0',
  image: 'w-full h-48 object-cover rounded',
  imageGrid: 'flex flex-wrap gap-3',
  imageGridItem: 'w-full',
  code: 'mt-2 rounded bg-gray-100 p-2 font-mono text-xs whitespace-pre-wrap',
};

const getHostname = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    const match = url.match(/https?:\/\/([^/]+)/);
    return match ? match[1].replace('www.', '') : '';
  }
};

const buildId = (type: ResultItemType, url: string | undefined, index: number) => {
  const safeUrl = url ? url.replace(/[^a-z0-9]/gi, '-') : 'no-url';
  return `${type}-${index}-${safeUrl}`;
};

const deriveSnippetTitle = (source: string, kind: 'video' | 'article') => {
  if (source) return `Snippet from ${source}`;
  return kind === 'video' ? 'Video snippet' : 'Article snippet';
};

export const getCitationText = (item: ResultItem): string => {
  const source = item.source || getHostname(item.url);
  if (source && item.url) return `${source} · ${item.url}`;
  if (source) return source;
  return item.url || '';
};

export const normalizeSearchResults = (results: WebSearchResults): ResultItem[] => {
  const items: ResultItem[] = [];

  results.videos.forEach((video, index) => {
    const source = video.channel || getHostname(video.url);
    items.push({
      id: buildId('video', video.url, index),
      type: 'video',
      title: video.title,
      url: video.url,
      snippet: video.snippet,
      thumbnail: video.thumbnail,
      source,
    });

    if (video.snippet) {
      items.push({
        id: buildId('snippet', video.url, index),
        type: 'snippet',
        title: deriveSnippetTitle(source, 'video'),
        url: video.url,
        snippet: video.snippet,
        source,
      });
    }
  });

  results.articles.forEach((article, index) => {
    const source = article.source || getHostname(article.url);
    items.push({
      id: buildId('article', article.url, index),
      type: 'article',
      title: article.title,
      url: article.url,
      snippet: article.snippet,
      thumbnail: article.thumbnail,
      source,
    });

    if (article.snippet) {
      items.push({
        id: buildId('snippet', article.url, index),
        type: 'snippet',
        title: deriveSnippetTitle(source, 'article'),
        url: article.url,
        snippet: article.snippet,
        source,
      });
    }
  });

  results.images.forEach((image, index) => {
    items.push({
      id: buildId('image', image.url, index),
      type: 'image',
      title: image.title,
      url: image.url,
      snippet: image.snippet,
      thumbnail: image.thumbnail,
      source: getHostname(image.url),
    });
  });

  return items;
};

export type OrderedSearchResult = {
  type: 'video' | 'article' | 'image';
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
};

export const orderedSearchResultsToItems = (results: OrderedSearchResult[]): ResultItem[] => {
  return results.map((result, index) => ({
    id: buildId(result.type, result.url, index),
    type: result.type,
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    thumbnail: result.type === 'image' ? result.thumbnail || result.url : result.thumbnail,
    source: getHostname(result.url),
  }));
};

export const getResultSections = (items: ResultItem[]) => {
  const grouped = items.reduce<Record<ResultItemType, ResultItem[]>>((acc, item) => {
    acc[item.type] = acc[item.type] ? [...acc[item.type], item] : [item];
    return acc;
  }, {} as Record<ResultItemType, ResultItem[]>);

  const titles: Record<ResultItemType, string> = {
    video: 'YouTube Videos',
    article: 'Articles',
    snippet: 'Snippets',
    image: 'Images',
  };

  const orderOfFirstAppearance: ResultItemType[] = [];
  const seen = new Set<ResultItemType>();
  for (const item of items) {
    if (!seen.has(item.type)) {
      seen.add(item.type);
      orderOfFirstAppearance.push(item.type);
    }
  }

  return orderOfFirstAppearance
    .filter((type) => grouped[type]?.length)
    .map((type) => ({ type, title: titles[type], items: grouped[type] }));
};
