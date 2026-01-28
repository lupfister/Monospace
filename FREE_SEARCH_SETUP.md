# Quick Start: Free Search API Setup

## 🚀 Fastest Setup (5 minutes)

### Step 1: Get Pexels API Key (FREE - Best for Images/Videos)
1. Go to https://www.pexels.com/api/
2. Click "Get Started" and sign up (free)
3. Copy your API key
4. Add to `.env`:
```
VITE_PEXELS_API_KEY=your_pexels_api_key_here
```

### Step 2: Get Brave Search API Key (FREE - Best for Web/YouTube)
1. Go to https://brave.com/search/api/
2. Sign up for free account
3. Get your API key (2,000 free queries/month)
4. Add to `.env`:
```
VITE_BRAVE_API_KEY=your_brave_api_key_here
```

### Step 3: Restart Your Dev Server
```bash
npm run dev
```

That's it! The search feature will now work with real results.

## What You Get

✅ **YouTube Videos** - Found via Brave Search  
✅ **High-Quality Images** - From Pexels (free stock photos)  
✅ **Articles** - Found via Brave Search  
✅ **All FREE** - No credit card required!

## Alternative: Search1API (Also Free)

If you prefer a single API:
1. Go to https://www.search1api.com/
2. Sign up (100 free credits)
3. Add to `.env`:
```
VITE_SEARCH1API_KEY=your_search1api_key_here
```

## Testing

1. Write some text in the editor
2. Select the text
3. Click the search icon (🔍) in the toolbar
4. See real search results!

## Need Help?

- Brave API Docs: https://api.search.brave.com/
- Pexels API Docs: https://www.pexels.com/api/documentation/
- Search1API Docs: https://www.search1api.com/docs
