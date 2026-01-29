# Quick Start: Free Search API Setup

## 🚀 Fastest Setup (5 minutes)

### Step 0: Get Gemini API Key (Required for Web/YouTube Search)
1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Add to `.env`:
```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### Step 1: Get Pexels API Key (FREE - Best for Images/Videos)
1. Go to https://www.pexels.com/api/
2. Click "Get Started" and sign up (free)
3. Copy your API key
4. Add to `.env`:
```
VITE_PEXELS_API_KEY=your_pexels_api_key_here
```

### Step 2: Restart Your Dev Server
```bash
npm run dev
```

That's it! The search feature will now work with real results.

## What You Get

✅ **YouTube Videos** - Found via Gemini grounded search  
✅ **High-Quality Images** - From Pexels (free stock photos)  
✅ **Articles** - Found via Gemini grounded search  

## Testing

1. Write some text in the editor
2. Select the text
3. Click the search icon (🔍) in the toolbar
4. See real search results!

## Need Help?

- Gemini API key: https://aistudio.google.com/apikey
- Pexels API Docs: https://www.pexels.com/api/documentation/
