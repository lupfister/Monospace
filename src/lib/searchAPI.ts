/**
 * Search API integration
 * This file provides functions to search for YouTube videos, images, and articles
 * 
 * FREE OPTIONS AVAILABLE:
 * 1. Brave Search API - Free tier: 2,000 queries/month (RECOMMENDED)
 * 2. Pexels API - Completely free for images and videos
 * 3. Search1API - 100 free credits, no credit card required
 * 4. DuckDuckGo (via third-party) - Limited free tier
 */

import { YouTubeVideo, Article, ImageResult, parseSearchResults, type WebSearchResults } from './webSearch';

interface SearchAPIResult {
  title?: string;
  url?: string;
  snippet?: string;
  thumbnail?: string;
}

/**
 * Search using Brave Search API (FREE TIER: 2,000 queries/month)
 * Get API key at: https://brave.com/search/api/
 */
const searchBrave = async (query: string, options: { type?: 'video' | 'image' | 'web' } = {}): Promise<SearchAPIResult[]> => {
  const apiKey = import.meta.env.VITE_BRAVE_API_KEY;
  if (!apiKey) {
    console.warn('Brave API key not found');
    return [];
  }

  try {
    const searchType = options.type === 'image' ? 'images' : options.type === 'video' ? 'videos' : 'web';
    // Use proxy to avoid CORS issues
    const url = `/api/brave/res/v1/${searchType}/search?q=${encodeURIComponent(query)}&count=10`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Brave API error:', response.status, response.statusText, errorText);
      return [];
    }

    const data = await response.json();
    console.log('Brave API full response:', JSON.stringify(data, null, 2)); // Debug log
    
    // Brave API response structure:
    // For web: { web: { results: [...] } } OR { news: { results: [...] }, videos: { results: [...] } }
    // For images: { results: [...] }
    // For videos: { results: [...] } OR { videos: { results: [...] } }
    
    let results: any[] = [];
    
    if (searchType === 'images') {
      results = data.results || data.images?.results || [];
      console.log('Parsed image results:', results.length);
      return results.map((item: any) => ({
        title: item.title || item.properties?.title || '',
        url: item.url || '',
        snippet: item.properties?.alt || item.properties?.text || item.description || '',
        thumbnail: item.thumbnail?.src || item.thumbnail?.url || item.url || '',
      }));
    } else if (searchType === 'videos') {
      results = data.results || data.videos?.results || [];
      console.log('Parsed video results:', results.length);
      return results.map((item: any) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
        thumbnail: item.thumbnail?.src || item.thumbnail?.url || item.thumbnail || '',
      }));
    } else {
      // Web search - can return web.results OR news.results (for articles)
      results = data.web?.results || data.news?.results || [];
      console.log('Parsed web/news results:', results.length);
      if (results.length === 0) {
        console.warn('No web/news results found. Response keys:', Object.keys(data));
        // Try to get any results from mixed response
        if (data.mixed?.main) {
          console.log('Found mixed response, trying to extract web results');
        }
      }
      return results.map((item: any) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
        thumbnail: item.thumbnail?.src || item.thumbnail?.url || item.thumbnail || '',
      }));
    }
  } catch (error) {
    console.error('Brave search error:', error);
    return [];
  }
};

/**
 * Search for images using Pexels API (COMPLETELY FREE)
 * Get API key at: https://www.pexels.com/api/
 */
const searchPexels = async (query: string): Promise<SearchAPIResult[]> => {
  const apiKey = import.meta.env.VITE_PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey,
      },
    });

    if (!response.ok) {
      console.error('Pexels API error:', response.statusText);
      return [];
    }

    const data = await response.json();
    
    return (data.photos || []).map((photo: any) => ({
      title: photo.photographer || 'Pexels Image',
      url: photo.url || '',
      snippet: photo.alt || '',
      thumbnail: photo.src?.medium || photo.src?.small || '',
    }));
  } catch (error) {
    console.error('Pexels search error:', error);
    return [];
  }
};

/**
 * Search for videos using Pexels API (COMPLETELY FREE)
 */
const searchPexelsVideos = async (query: string): Promise<SearchAPIResult[]> => {
  const apiKey = import.meta.env.VITE_PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey,
      },
    });

    if (!response.ok) {
      console.error('Pexels Video API error:', response.statusText);
      return [];
    }

    const data = await response.json();
    
    return (data.videos || []).map((video: any) => ({
      title: video.user?.name || 'Pexels Video',
      url: video.url || '',
      snippet: video.duration ? `${video.duration}s video` : '',
      thumbnail: video.image || video.picture || '',
    }));
  } catch (error) {
    console.error('Pexels video search error:', error);
    return [];
  }
};

/**
 * Search using Search1API (FREE: 100 credits, no credit card)
 * Get API key at: https://www.search1api.com/
 */
const searchSearch1API = async (query: string, options: { type?: 'video' | 'image' | 'web' } = {}): Promise<SearchAPIResult[]> => {
  const apiKey = import.meta.env.VITE_SEARCH1API_KEY;
  if (!apiKey) return [];

  try {
    const searchType = options.type === 'image' ? 'images' : options.type === 'video' ? 'videos' : 'google';
    const url = `https://api.search1api.com/api/search?q=${encodeURIComponent(query)}&engine=${searchType}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Search1API error:', response.statusText);
      return [];
    }

    const data = await response.json();
    
    if (searchType === 'images') {
      return (data.images || []).map((item: any) => ({
        title: item.title || '',
        url: item.url || item.link || '',
        snippet: item.snippet || '',
        thumbnail: item.thumbnail || item.url || '',
      }));
    } else if (searchType === 'videos') {
      return (data.videos || []).map((item: any) => ({
        title: item.title || '',
        url: item.url || item.link || '',
        snippet: item.snippet || '',
        thumbnail: item.thumbnail || '',
      }));
    } else {
      return (data.organic || []).map((item: any) => ({
        title: item.title || '',
        url: item.url || item.link || '',
        snippet: item.snippet || '',
        thumbnail: item.thumbnail || '',
      }));
    }
  } catch (error) {
    console.error('Search1API error:', error);
    return [];
  }
};

/**
 * Main search function - tries free APIs in order of preference
 */
export const performWebSearch = async (
  query: string,
  options: { type?: 'video' | 'image' | 'web' } = {}
): Promise<SearchAPIResult[]> => {
  // For images, try Pexels first (completely free)
  if (options.type === 'image') {
    const pexelsResults = await searchPexels(query);
    if (pexelsResults.length > 0) return pexelsResults;
    
    // Fallback to Brave or Search1API
    if (import.meta.env.VITE_BRAVE_API_KEY) {
      return await searchBrave(query, options);
    }
    if (import.meta.env.VITE_SEARCH1API_KEY) {
      return await searchSearch1API(query, options);
    }
    return pexelsResults;
  }

  // For videos, try Pexels first, then YouTube search
  if (options.type === 'video') {
    // Try to find YouTube videos via Brave or Search1API
    const youtubeQuery = `${query} site:youtube.com`;
    
    if (import.meta.env.VITE_BRAVE_API_KEY) {
      const braveResults = await searchBrave(youtubeQuery, { type: 'video' });
      if (braveResults.length > 0) return braveResults;
    }
    
    if (import.meta.env.VITE_SEARCH1API_KEY) {
      const search1Results = await searchSearch1API(youtubeQuery, { type: 'video' });
      if (search1Results.length > 0) return search1Results;
    }
    
    // Fallback to Pexels videos
    return await searchPexelsVideos(query);
  }

  // For web/articles, use Brave or Search1API
  if (import.meta.env.VITE_BRAVE_API_KEY) {
    return await searchBrave(query, options);
  }
  
  if (import.meta.env.VITE_SEARCH1API_KEY) {
    return await searchSearch1API(query, options);
  }

  // No API keys configured
  return [];
};

/**
 * Search for YouTube videos, images, and articles related to a query
 * Uses free APIs: Brave Search, Pexels, and Search1API
 */
export const searchForContent = async (query: string): Promise<WebSearchResults> => {
  try {
    console.log('Searching for:', query);
    
    // Search for YouTube videos (use Brave or Search1API)
    // Don't add "site:youtube.com" twice - the query might already have it
    const youtubeQuery = query.includes('site:youtube.com') ? query : `${query} site:youtube.com`;
    const videoResults = await performWebSearch(youtubeQuery, { type: 'video' }).catch(err => {
      console.warn('Video search failed:', err);
      return [];
    });
    console.log('Video results:', videoResults.length);
    
    // Search for articles (use Brave or Search1API)
    // Use original query without site: restriction for articles
    const articleQuery = query.replace(/\s*site:\w+\.\w+/g, '').trim();
    const articleResults = await performWebSearch(articleQuery, { type: 'web' }).catch(err => {
      console.warn('Article search failed:', err);
      return [];
    });
    console.log('Article results:', articleResults.length);
    
    // Search for images (use Pexels first, then fallback to Brave/Search1API)
    const imageQuery = query.replace(/\s*site:\w+\.\w+/g, '').trim();
    const imageResults = await performWebSearch(imageQuery, { type: 'image' }).catch(err => {
      console.warn('Image search failed:', err);
      return [];
    });
    console.log('Image results:', imageResults.length);
    
    // Combine all results
    const allResults = [...videoResults, ...articleResults, ...imageResults];
    console.log('Total results:', allResults.length);
    
    // Parse and categorize results
    const parsed = parseSearchResults(query, allResults);
    console.log('Parsed results:', parsed);
    
    return parsed;
  } catch (error) {
    console.error('Search error:', error);
    return { videos: [], images: [], articles: [] };
  }
};
