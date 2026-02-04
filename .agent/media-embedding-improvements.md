# Video and Image Embedding Improvements

## Summary
Enhanced the AI search and media embedding system to pull in more interesting, valuable, and high-quality content. The system now intelligently scores and prioritizes content based on multiple quality signals.

## Key Changes

### 1. Enhanced Search Agent Instructions (`server/src/ai.ts`)
**What changed:** Completely rewrote the WebSearchAgent instructions to be more specific about quality standards.

**New capabilities:**
- **Primary source prioritization**: Official docs, research papers, authoritative institutions
- **Image search criteria**: Prefers diagrams, technical screenshots, data visualizations, infographics, scientific imagery
- **Video search criteria**: Prefers educational content, expert demonstrations, documentaries, lectures
- **Article search criteria**: Extracts the most interesting/surprising direct quotes instead of summaries
- **Explicit avoidance**: Stock photos, content farms, listicles, marketing pages, clickbait

### 2. Improved Search Planning (`server/src/ai.ts`)
**What changed:** Enhanced the search planner to generate more specific, targeted queries.

**New capabilities:**
- Generates queries with specific details (proper nouns, dates, technical terms, context)
- Targets primary sources and authoritative content
- Avoids generic queries like "stock photo" or "wikipedia"
- Provides clear examples of good vs. bad queries

### 3. Quality-Based Media Scoring (`src/lib/searchRenderers.ts`)
**What changed:** Added intelligent scoring system for images and videos.

**Scoring factors:**
- **Positive signals (+15 to +10 points)**: Wikipedia, NASA, museums, .edu/.gov domains, diagrams, infographics, HD/high-res, official documentation
- **Negative signals (-20 to -8 points)**: Stock photo sites, thumbnails, logos/icons, ads, converter tools
- **Type preference**: Videos get +10, images get +5 base score
- **Completeness**: Items with both thumbnail and URL get bonus points

**Result:** Media is now sorted by quality score, showing the most interesting content first.

### 4. Enhanced Excerpt Selection (`src/lib/searchRenderers.ts`)
**What changed:** Added sophisticated scoring for article excerpts.

**Scoring factors:**
- **Quotes (+15)**: Direct statements are often more interesting
- **Specific details (+10)**: Statistics, years, monetary values
- **Technical terms (+5)**: CamelCase, long words
- **Interesting patterns (+12 to +8)**: "discovered", "revealed", "however", "because"
- **Explanatory content (+6)**: How/why/what questions
- **Negative signals (-15 to -5)**: Click-bait, promotional language, self-promotional content
- **Length optimization (+8)**: Sweet spot is 80-200 characters

**Result:** Excerpts now surface the most insightful, surprising, or substantive content.

### 5. Increased Media Limit (`src/lib/searchRenderers.ts`)
**What changed:** Increased from 1 to 3 media items displayed.

**Why:** With quality scoring in place, we can confidently show more media knowing it will be interesting and relevant.

## Expected Impact

### Before
- Generic, low-quality images (stock photos, logos)
- Single media item regardless of quality
- AI-generated summaries instead of direct quotes
- Vague search queries leading to generic results
- Plain image thumbnails with no context
- No visual distinction between images and videos

### After
- High-quality, contextually relevant visuals (diagrams, screenshots, scientific imagery)
- Up to 3 interesting media items, ranked by quality
- Direct, compelling quotes from source material
- Specific, targeted search queries finding authoritative sources
- Rich media cards with titles, captions, and interactive elements
- Videos show play button overlay and are fully clickable
- Images include "View source" links
- Larger, more prominent media display (200-400px height)
- Smooth hover animations on video cards

## Additional Enhancements

### 6. Smart Image Extraction from HTML (`server/src/index.ts`)
**What changed:** Enhanced the image proxy to intelligently score and prioritize content images.

**Scoring factors:**
- **Size-based (+20 to -15)**: Larger images (600x400+) score higher; tiny images (<100x100) score lower
- **URL patterns (+15 to -30)**: "upload", "content", "media" score high; "logo", "icon", "tracking" score very low
- **Resolution indicators (+12)**: "1920x1080", "large", "full", "hd", "original"
- **Quality sources (+10)**: Wikipedia, Wikimedia
- **HTML attributes (+15)**: class="hero", class="featured", class="main"
- **Negative signals (-30 to -10)**: SVG files, ads, banners, tracking pixels

**Result:** The proxy now extracts the most relevant, high-quality image from a page instead of just the first one it finds.

### 7. Enhanced Media Card UI (`src/lib/searchRenderers.ts`)
**What changed:** Completely redesigned media cards for better visual appeal and usability.

**New features:**
- **Video cards**: 
  - Large play button overlay
  - Entire card is clickable (opens in new tab)
  - Smooth hover animation (lifts up with shadow)
  - Title/caption below thumbnail
- **Image cards**:
  - Larger display (200-400px height vs 120px)
  - Rounded corners with proper overflow handling
  - "View source" link below image
  - Title/caption for context
- **Both types**:
  - Better aspect ratio handling (object-fit: cover)
  - Lazy loading for performance
  - Graceful error handling with proxy fallback

**Result:** Media embeds now look professional, provide context, and are easy to interact with.

## Expected Impact

## Testing Recommendations

Try searching for:
1. **Technical topics**: "React Server Components" → Should find official docs, architecture diagrams
2. **Scientific topics**: "Hubble Deep Field" → Should find NASA images, research papers
3. **Historical topics**: "Apollo 11 mission" → Should find museum archives, historical photos
4. **Current events**: Recent news topics → Should find reputable news sources with substantive excerpts

## Future Enhancements

Potential improvements:
- User feedback mechanism to refine scoring weights
- Domain-specific quality signals (e.g., GitHub stars for code projects)
- Diversity scoring to avoid showing similar content
- Caching of quality scores to improve performance
