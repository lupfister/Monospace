# How the System Pulls In Content

## Complete Technical Flow

### Overview
The system uses **OpenAI's Agents API** with the **hosted web_search tool** to find and retrieve content. Here's the exact flow:

---

## Step-by-Step Process

### 1️⃣ User Triggers Search
**Location:** `src/hooks/useSearchAgent.ts` → `handleAiReview()`

```typescript
// User selects text or uses entire document
const textToReview = selection.toString() || editorRef.current.innerText;

// Example: "Tell me about quantum computing"
```

---

### 2️⃣ Search Planning Phase
**Location:** `src/lib/openaiAgentApi.ts` → `planSearchWithGemini()`
**Calls:** `POST /api/ai/action` with `action: 'plan_search'`
**Backend:** `server/src/ai.ts` → `handlePlanSearch()`

**What happens:**
```typescript
// Creates an OpenAI Agent with instructions
const agent = new Agent({
  name: 'SearchPlanner',
  instructions: 'Decide if search is useful and propose queries...',
  model: 'gpt-4o-mini' // or user's selected model
});

// Agent analyzes the text and returns JSON
const result = await run(agent, userPrompt);

// Returns something like:
{
  shouldSearch: true,
  queries: [
    { 
      type: "image", 
      query: "quantum computing qubit architecture diagram",
      reason: "Visual explanation of qubit structure"
    },
    { 
      type: "web", 
      query: "quantum entanglement research breakthrough 2023",
      reason: "Recent developments"
    }
  ]
}
```

**Key Point:** The AI decides WHETHER to search and WHAT to search for based on enhanced instructions that prioritize specific, interesting queries.

---

### 3️⃣ Web Search Execution
**Location:** `src/lib/openaiAgentApi.ts` → `searchWithAgent()`
**Calls:** `POST /api/ai/search`
**Backend:** `server/src/ai.ts` → `handleAgentSearch()` → `runSearchAgentForQuery()`

**What happens:**
```typescript
// For EACH query, creates a specialized search agent
const agent = new Agent({
  name: 'WebSearchAgent',
  instructions: '...enhanced quality criteria...',
  tools: [webSearchTool()],  // ← OpenAI's HOSTED web search
  model: 'gpt-4o-mini'
});

// The agent uses OpenAI's web_search tool
const result = await run(agent, `
  Search Type: image
  Search Query: quantum computing qubit architecture diagram
  Return ONLY JSON...
`);
```

**The Magic: OpenAI's `webSearchTool()`**
- This is a **hosted tool** provided by OpenAI
- It performs actual web searches (similar to Bing/Google)
- Returns real URLs, titles, snippets, and thumbnails
- The agent interprets results based on our instructions

**Agent returns:**
```json
{
  "results": [
    {
      "title": "Quantum Computing Architecture - IBM Research",
      "url": "https://research.ibm.com/quantum/architecture",
      "snippet": "IBM's quantum processors use superconducting qubits arranged in a lattice...",
      "thumbnail": "https://research.ibm.com/images/quantum-chip.jpg"
    },
    {
      "title": "Qubit Coherence Diagram - Nature Physics",
      "url": "https://nature.com/articles/quantum-coherence",
      "snippet": "Researchers demonstrated quantum coherence times exceeding 100 microseconds...",
      "thumbnail": "https://nature.com/content/diagrams/qubit-coherence.png"
    }
  ]
}
```

---

### 4️⃣ Content Aggregation
**Location:** `src/hooks/useSearchAgent.ts`

```typescript
// Collect all search results from all queries
const searchResults = await searchWithAgent(agentQueries, selectedModel);

// Results now contain:
// - URLs to articles
// - URLs to images
// - URLs to videos (YouTube thumbnails)
// - Text snippets from pages
// - Titles and metadata

// Prepare context for the narrative
const searchContext = searchResults
  .map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
  .join('\n\n');
```

---

### 5️⃣ Narrative Generation
**Location:** `src/lib/openaiAgentApi.ts` → `fetchSkeletonNotesWithGemini()`
**Backend:** `server/src/ai.ts` → `handleReviewSkeletonNotes()`

**What happens:**
```typescript
// Another AI agent creates the narrative
const agent = new Agent({
  name: 'DocumentAssistant',
  instructions: 'Write skeleton notes...',
  model: 'gpt-4o-mini'
});

// Passes the search context to the agent
const result = await run(agent, `
  ${instructions}
  
  Context from web search:
  ${searchContext}
  
  User's text:
  ${userText}
`);

// Returns structured notes
{
  "blocks": [
    {
      "kind": "ai",
      "text": "Quantum computing uses qubits that can exist in superposition..."
    },
    {
      "kind": "input",
      "prompt": "How might quantum error correction change in the next decade?",
      "lines": 3
    }
  ]
}
```

---

### 6️⃣ Media Quality Scoring
**Location:** `src/lib/searchRenderers.ts` → `buildSearchResultsBlock()`

```typescript
// Convert search results to items
const resultItems = orderedSearchResultsToItems(searchResults);

// Filter and score media
const mediaItems = resultItems
  .filter(item => item.type === 'video' || item.type === 'image')
  .map(item => {
    let score = 0;
    const text = `${item.url} ${item.title}`.toLowerCase();
    
    // Score based on quality signals
    if (/wikipedia|nasa|museum/.test(text)) score += 15;
    if (/diagram|infographic/.test(text)) score += 12;
    if (/stock|shutterstock/.test(text)) score -= 20;
    // ... more scoring logic
    
    return { ...item, qualityScore: score };
  })
  .sort((a, b) => b.qualityScore - a.qualityScore);

// Take top 3
const topMedia = mediaItems.slice(0, 3);
```

---

### 7️⃣ Image Proxy & Extraction
**Location:** `server/src/index.ts` → `GET /api/ai/image`

**When rendering, if an image URL is not a direct image:**
```typescript
// Frontend requests:
<img src="/api/ai/image?url=https://example.com/article" />

// Backend fetches the page
const response = await fetch('https://example.com/article');
const html = await response.text();

// Extracts and scores all images
const images = extractImgSrcsFromHtml(html, baseUrl);
// Returns: [
//   { url: "logo.svg", score: -25 },
//   { url: "ad-banner.jpg", score: -20 },
//   { url: "content-image.jpg", score: +35 }  ← Winner!
// ]

// Fetches the highest-scored image
const bestImage = await fetch(images[0].url);

// Returns the image data
return bestImage.arrayBuffer();
```

**The browser receives the actual image bytes and displays it.**

---

### 8️⃣ UI Rendering
**Location:** `src/lib/searchRenderers.ts` → `createInlineResultCard()`

```typescript
// For each media item, create a rich card
const container = document.createElement('div');

// Add the image/video
const img = document.createElement('img');
img.src = item.thumbnail || `/api/ai/image?url=${item.url}`;
img.style.height = '200-400px';

// Add play button for videos
if (item.type === 'video') {
  const playIcon = createPlayButton();
  container.appendChild(playIcon);
  container.onclick = () => window.open(item.url);
}

// Add title/caption
const caption = document.createElement('div');
caption.textContent = item.title;
container.appendChild(caption);

// Insert into document
editorRef.current.appendChild(container);
```

---

## Key Technologies

### OpenAI Agents API
```typescript
import { Agent, run, webSearchTool } from '@openai/agents';

// The webSearchTool() is the key
// It's a hosted service that:
// 1. Performs web searches
// 2. Crawls pages
// 3. Extracts metadata
// 4. Returns structured results
```

### What `webSearchTool()` Actually Does:
1. **Searches the web** using OpenAI's search infrastructure
2. **Crawls result pages** to extract content
3. **Identifies images/videos** from pages
4. **Extracts snippets** of text
5. **Returns structured data** (title, URL, snippet, thumbnail)

**It's like having Bing/Google API + web scraping built-in.**

---

## Data Flow Diagram

```
┌─────────────┐
│ User Input  │ "quantum computing"
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 1. Search Planner Agent             │
│    (OpenAI GPT-4o-mini)             │
│    Decides: What to search for      │
└──────┬──────────────────────────────┘
       │ Queries: [
       │   "quantum qubit diagram",
       │   "quantum research 2023"
       │ ]
       ▼
┌─────────────────────────────────────┐
│ 2. Web Search Agent                 │
│    (OpenAI GPT-4o-mini)             │
│    + webSearchTool()                │
│    ↓                                │
│    Searches web via OpenAI          │
│    Crawls pages                     │
│    Extracts content                 │
└──────┬──────────────────────────────┘
       │ Results: [
       │   {title, url, snippet, thumbnail},
       │   {title, url, snippet, thumbnail}
       │ ]
       ▼
┌─────────────────────────────────────┐
│ 3. Quality Scoring (Client-side)   │
│    Scores each result               │
│    Filters low-quality              │
│    Sorts by score                   │
└──────┬──────────────────────────────┘
       │ Top 3 media items
       ▼
┌─────────────────────────────────────┐
│ 4. Image Proxy (if needed)          │
│    Fetches HTML page                │
│    Scores all images on page        │
│    Returns best image               │
└──────┬──────────────────────────────┘
       │ Image bytes
       ▼
┌─────────────────────────────────────┐
│ 5. Rich UI Rendering                │
│    Creates media cards              │
│    Adds play buttons, titles        │
│    Inserts into document            │
└─────────────────────────────────────┘
```

---

## Example: Complete Flow

**User types:** "quantum computing"

**1. Planning:**
```
AI Agent → "I should search for:
  - quantum computing qubit architecture diagram (image)
  - quantum computing breakthrough research (web)"
```

**2. Searching:**
```
webSearchTool() → Searches web
  → Finds: IBM Research, Nature Physics, MIT News
  → Returns: URLs, snippets, thumbnails
```

**3. Results:**
```json
[
  {
    "type": "image",
    "title": "IBM Quantum Processor Architecture",
    "url": "https://research.ibm.com/quantum",
    "thumbnail": "https://research.ibm.com/images/quantum-chip.jpg"
  },
  {
    "type": "article",
    "title": "Quantum Breakthrough at MIT",
    "url": "https://news.mit.edu/quantum-breakthrough",
    "snippet": "Researchers achieved quantum coherence at room temperature..."
  }
]
```

**4. Quality Scoring:**
```
IBM image: +42 points (official source +10, diagram +12, large +20)
MIT article: +38 points (university +15, research +10, statistics +10)
```

**5. Image Proxy (if needed):**
```
/api/ai/image?url=https://research.ibm.com/quantum
  → Fetches HTML
  → Finds 15 images on page
  → Scores: logo (-25), nav icon (-15), hero image (+35)
  → Returns hero image bytes
```

**6. Rendering:**
```html
<div class="media-card">
  <img src="[quantum-chip.jpg]" style="height: 300px" />
  <div class="caption">IBM Quantum Processor Architecture</div>
  <a href="https://research.ibm.com/quantum">View source →</a>
</div>
```

---

## Why It's Better Now

### Before:
- Generic queries → Generic results
- First image found → Often logos/icons
- No quality filter → Stock photos
- Small display → Not engaging

### After:
- Specific queries → Authoritative sources
- Scored images → Content images
- Multi-factor scoring → High quality
- Rich cards → Engaging & informative

---

## Technical Stack

| Component | Technology |
|-----------|------------|
| **Search Planning** | OpenAI Agents API (GPT-4o-mini) |
| **Web Search** | OpenAI webSearchTool() (hosted) |
| **Image Proxy** | Express.js server endpoint |
| **Quality Scoring** | Client-side TypeScript algorithms |
| **UI Rendering** | Vanilla JavaScript DOM manipulation |
| **API Communication** | Fetch API (REST) |

---

## Key Insight

**The system doesn't just "pull in" content—it:**
1. **Intelligently decides** what to search for
2. **Uses AI-powered web search** to find quality sources
3. **Scores and filters** results for quality
4. **Extracts the best** images from pages
5. **Presents content** in an engaging, interactive way

**It's a multi-stage AI pipeline, not just a simple API call!**
