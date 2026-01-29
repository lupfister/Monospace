/**
 * Web search service for finding YouTube videos, images, and articles
 * Uses web search API to find relevant content
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
}

export interface YouTubeVideo extends SearchResult {
  videoId: string;
  duration?: string;
  channel?: string;
}

export interface Article extends SearchResult {
  source?: string;
  publishedDate?: string;
}

export interface ImageResult extends SearchResult {
  width?: number;
  height?: number;
}

export interface WebSearchResults {
  videos: YouTubeVideo[];
  images: ImageResult[];
  articles: Article[];
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Extract YouTube video ID from URL
 */
const extractYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
};

/**
 * Check if URL is a YouTube video
 */
const isYouTubeUrl = (url: string): boolean => {
  return /youtube\.com|youtu\.be/.test(url);
};

/**
 * Check if URL is an image
 */
const isImageUrl = (url: string): boolean => {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
};

/**
 * Parse search results from web search
 */
export const parseSearchResults = (
  query: string,
  rawResults: Array<{ title?: string; url?: string; snippet?: string; thumbnail?: string }>
): WebSearchResults => {
  const videos: YouTubeVideo[] = [];
  const images: ImageResult[] = [];
  const articles: Article[] = [];

  for (const result of rawResults) {
    const url = isNonEmptyString(result.url) ? result.url.trim() : '';
    const title = isNonEmptyString(result.title) ? result.title.trim() : '';
    const snippet = isNonEmptyString(result.snippet) ? result.snippet.trim() : '';
    const thumbnail = isNonEmptyString(result.thumbnail) ? result.thumbnail.trim() : '';

    // Some providers (e.g. Pexels) return a page URL in `url` and the actual image in `thumbnail`.
    // Require at least a URL. For images we can fall back to thumbnail when `url` isn't a direct asset.
    if (!url) continue;
    const effectiveTitle = title || url;

    // Check if it's a YouTube video
    if (isYouTubeUrl(url)) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        videos.push({
          title: effectiveTitle,
          url,
          snippet,
          thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          videoId,
        });
      }
      continue;
    }

    // Check if it's an image (direct asset URL or provider thumbnail)
    const imageAssetUrl =
      isImageUrl(url) ? url : (thumbnail && isImageUrl(thumbnail) ? thumbnail : '');
    if (imageAssetUrl) {
      images.push({
        title: effectiveTitle,
        // Keep the "click-through" URL if it's a page; otherwise it's the asset itself.
        url,
        snippet,
        thumbnail: imageAssetUrl,
      });
      continue;
    }

    // Otherwise, treat as an article
    let source = '';
    try {
      source = new URL(url).hostname.replace('www.', '');
    } catch {
      // If URL parsing fails, try to extract domain manually
      const match = url.match(/https?:\/\/([^\/]+)/);
      source = match ? match[1].replace('www.', '') : '';
    }
    
    articles.push({
      title: effectiveTitle,
      url,
      snippet,
      thumbnail,
      source,
    });
  }

  return { videos, images, articles };
};

/**
 * Search the web for content related to a query
 * This function uses the web_search tool to find results
 */
export const searchWeb = async (query: string): Promise<WebSearchResults> => {
  // For now, we'll use a mock implementation that can be replaced with actual API calls
  // In production, you would use Google Custom Search API, SerpAPI, or similar
  
  // Format query for better results
  const searchQuery = query.trim();
  if (!searchQuery) {
    return { videos: [], images: [], articles: [] };
  }

  // Try to find YouTube videos
  const youtubeQuery = `${searchQuery} site:youtube.com`;
  
  // Try to find images
  const imageQuery = `${searchQuery} images`;
  
  // Try to find articles
  const articleQuery = searchQuery;

  // In a real implementation, you would make API calls here
  // For now, return empty results - the actual search will be done via the web_search tool
  // when called from the component
  
  return { videos: [], images: [], articles: [] };
};

/**
 * Format search results for display in the editor
 */
export const formatSearchResultsForDisplay = (results: WebSearchResults): string => {
  const parts: string[] = [];

  if (results.videos.length > 0) {
    parts.push('📹 YouTube Videos:');
    results.videos.slice(0, 3).forEach((video, index) => {
      parts.push(`${index + 1}. ${video.title}`);
      parts.push(`   ${video.url}`);
      if (video.snippet) {
        parts.push(`   ${video.snippet.substring(0, 100)}...`);
      }
      parts.push('');
    });
  }

  if (results.articles.length > 0) {
    parts.push('📰 Articles:');
    results.articles.slice(0, 3).forEach((article, index) => {
      parts.push(`${index + 1}. ${article.title}`);
      parts.push(`   ${article.url}`);
      if (article.snippet) {
        parts.push(`   ${article.snippet.substring(0, 100)}...`);
      }
      parts.push('');
    });
  }

  if (results.images.length > 0) {
    parts.push('🖼️ Images:');
    results.images.slice(0, 3).forEach((image, index) => {
      parts.push(`${index + 1}. ${image.title}`);
      parts.push(`   ${image.url}`);
      parts.push('');
    });
  }

  return parts.join('\n');
};
