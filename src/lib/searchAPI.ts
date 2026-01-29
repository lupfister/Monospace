/**
 * Search API integration
 * This file provides functions to search for YouTube videos, images, and articles
 * 
 * FREE OPTIONS AVAILABLE:
 * 1. Gemini API (with Google Search grounding) - best for web/YouTube links
 * 2. Pexels API - Completely free for images and videos
 */

import { YouTubeVideo, Article, ImageResult, parseSearchResults, type WebSearchResults } from './webSearch';
import { searchWithGemini } from './gemini';

interface SearchAPIResult {
  title?: string;
  url?: string;
  snippet?: string;
  thumbnail?: string;
}

export type SearchCapabilities = {
  hasGeminiKey: boolean;
  hasPexelsKey: boolean;
};

export const getSearchCapabilities = (): SearchCapabilities => {
  const hasGeminiKey = Boolean(import.meta.env.VITE_GEMINI_API_KEY);
  const hasPexelsKey = Boolean(import.meta.env.VITE_PEXELS_API_KEY);
  return { hasGeminiKey, hasPexelsKey };
};

/**
 * Search the web using Gemini's built-in Google Search grounding.
 */
const searchGemini = async (
  query: string,
  options: { type?: 'video' | 'image' | 'web' } = {}
): Promise<SearchAPIResult[]> => {
  if (!import.meta.env.VITE_GEMINI_API_KEY) return [];
  const results = await searchWithGemini(query, { maxResults: 10 });

  // Gemini grounding provides sources (title + url) and sometimes small snippet text.
  // Thumbnail is best-effort; for YouTube we can derive from the video ID in parsing stage.
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    thumbnail: '',
  }));
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
      const errorText = await response.text().catch(() => response.statusText);
      console.error('Pexels API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    
    // Pexels returns photos with src.medium/src.large for direct image URLs
    return (data.photos || []).map((photo: any) => ({
      title: photo.photographer || 'Pexels Image',
      // Use the direct image URL (medium size) as the main URL for images
      url: photo.src?.medium || photo.src?.large || photo.url || '',
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
 * Main search function - tries free APIs in order of preference
 */
export const performWebSearch = async (
  query: string,
  options: { type?: 'video' | 'image' | 'web' } = {}
): Promise<SearchAPIResult[]> => {
  const caps = getSearchCapabilities();

  // For images, try Pexels first (completely free)
  if (options.type === 'image') {
    const pexelsResults = await searchPexels(query);
    if (pexelsResults.length > 0) return pexelsResults;

    // Fallback to Gemini: use Google Image Search query syntax
    // This helps Gemini return image-related results
    const imageQuery = `images of ${query}`;
    return await searchGemini(imageQuery, options);
  }

  // For videos, try Pexels first, then YouTube search
  if (options.type === 'video') {
    // Try to find YouTube videos via Gemini grounding
    const youtubeQuery = `${query} site:youtube.com`;

    const geminiResults = await searchGemini(youtubeQuery, { type: 'video' });
    if (geminiResults.length > 0) return geminiResults;
    
    // Fallback to Pexels videos
    return await searchPexelsVideos(query);
  }

  // For web/articles, use Gemini grounding
  return await searchGemini(query, options);
};

/**
 * Search for YouTube videos, images, and articles related to a query
 * Uses Gemini grounded search + Pexels for images/videos
 */
export const searchForContent = async (query: string): Promise<WebSearchResults> => {
  try {
    console.log('Searching for:', query);
    
    // Search for YouTube videos
    // Don't add "site:youtube.com" twice - the query might already have it
    const youtubeQuery = query.includes('site:youtube.com') ? query : `${query} site:youtube.com`;
    const videoResults = await performWebSearch(youtubeQuery, { type: 'video' }).catch(err => {
      console.warn('Video search failed:', err);
      return [];
    });
    console.log('Video results:', videoResults.length);
    
    // Search for articles
    // Use original query without site: restriction for articles
    const articleQuery = query.replace(/\s*site:\w+\.\w+/g, '').trim();
    const articleResults = await performWebSearch(articleQuery, { type: 'web' }).catch(err => {
      console.warn('Article search failed:', err);
      return [];
    });
    console.log('Article results:', articleResults.length);
    
    // Search for images (use Pexels first, then fallback to Gemini)
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
