# Web Search API Setup

The web search feature is now integrated into the document editor with **FREE API options** built-in!

## 🆓 Free API Options (Recommended)

### Option 1: Brave Search API ⭐ (Best for General Search)
**Free Tier: 2,000 queries/month**

1. Sign up at [Brave Search API](https://brave.com/search/api/)
2. Get your API key (free tier available)
3. Add to your `.env` file:
```
VITE_BRAVE_API_KEY=your_api_key_here
```

**Pros:**
- Independent web index (not Google-dependent)
- Great for AI applications
- 2,000 free queries/month
- Supports web, images, and videos

### Option 2: Pexels API ⭐ (Best for Images & Videos)
**Completely FREE - No limits for standard usage**

1. Sign up at [Pexels API](https://www.pexels.com/api/)
2. Get your API key (completely free)
3. Add to your `.env` file:
```
VITE_PEXELS_API_KEY=your_api_key_here
```

**Pros:**
- 100% free for images and videos
- High-quality stock photos and videos
- No credit card required
- Perfect for visual content

### Option 3: Search1API
**Free Tier: 100 credits, no credit card required**

1. Sign up at [Search1API](https://www.search1api.com/)
2. Get your API key
3. Add to your `.env` file:
```
VITE_SEARCH1API_KEY=your_api_key_here
```

**Pros:**
- 100 free credits to start
- No credit card required
- Supports multiple search engines (Google, Bing, DuckDuckGo, YouTube, etc.)
- Fast response times

## 🎯 Recommended Setup

For the best free experience, use **both**:
1. **Brave Search API** for web articles and YouTube videos
2. **Pexels API** for high-quality images and videos

The implementation automatically uses the best available API for each content type!

## 💰 Paid Options (If you need more)

### Google Custom Search API
- Free tier: 100 queries/day
- Paid: $5 per 1,000 queries

### SerpAPI
- Paid plans starting at $50/month
- Comprehensive search coverage

### Bing Search API
- Free tier: Limited
- Paid: Pay-as-you-go pricing

## Usage

Once configured:

1. Select text in the document editor
2. Click the search icon (🔍) in the toolbar
3. The AI will suggest search queries based on your text
4. Search results will appear in a dialog showing:
   - YouTube videos
   - Articles
   - Images

## Features

- **Smart Query Generation**: Uses Gemini AI to suggest optimal search queries
- **Categorized Results**: Automatically categorizes results into videos, articles, and images
- **Rich Display**: Shows thumbnails, snippets, and links for easy browsing
- **Click to Open**: All results are clickable and open in new tabs

## Notes

- The search feature requires an active internet connection
- API usage may incur costs depending on your provider
- Rate limits may apply based on your API plan
