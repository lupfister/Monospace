# Code Examples: How Content is Retrieved

## Quick Reference: The Actual API Calls

### 1. Search Planning

**Frontend Call:**
```typescript
// src/lib/openaiAgentApi.ts
const plan = await planSearchWithGemini("quantum computing", "gpt-4o-mini");
```

**HTTP Request:**
```http
POST /api/ai/action
Content-Type: application/json

{
  "action": "plan_search",
  "text": "quantum computing",
  "model": "gpt-4o-mini"
}
```

**Backend Processing:**
```typescript
// server/src/ai.ts
import { Agent, run } from '@openai/agents';

const agent = new Agent({
  name: 'SearchPlanner',
  instructions: 'You are an expert search strategist...',
  model: 'gpt-4o-mini'
});

const result = await run(agent, prompt);
```

**Response:**
```json
{
  "ok": true,
  "plan": {
    "shouldSearch": true,
    "queries": [
      {
        "type": "image",
        "query": "quantum computing qubit architecture diagram",
        "reason": "Visual explanation of qubit structure"
      },
      {
        "type": "web",
        "query": "quantum entanglement research breakthrough 2023"
      }
    ]
  }
}
```

---

### 2. Web Search Execution

**Frontend Call:**
```typescript
// src/lib/openaiAgentApi.ts
const results = await searchWithAgent([
  { type: 'image', query: 'quantum computing qubit architecture diagram' },
  { type: 'article', query: 'quantum entanglement research breakthrough 2023' }
], 'gpt-4o-mini');
```

**HTTP Request:**
```http
POST /api/ai/search
Content-Type: application/json

{
  "queries": [
    {
      "type": "image",
      "query": "quantum computing qubit architecture diagram"
    },
    {
      "type": "article",
      "query": "quantum entanglement research breakthrough 2023"
    }
  ],
  "model": "gpt-4o-mini"
}
```

**Backend Processing:**
```typescript
// server/src/ai.ts
import { Agent, run, webSearchTool } from '@openai/agents';

// For EACH query:
const agent = new Agent({
  name: 'WebSearchAgent',
  instructions: 'You are an expert research assistant...',
  tools: [webSearchTool()],  // ← THE MAGIC
  model: 'gpt-4o-mini'
});

const prompt = `
Search Type: image
Search Query: quantum computing qubit architecture diagram
Return ONLY the required JSON structure...
`;

const result = await run(agent, prompt);
// The agent uses webSearchTool() internally to search the web
```

**What `webSearchTool()` Does:**
```typescript
// This is OpenAI's hosted tool (we don't implement it)
// Internally it:
// 1. Searches the web (like Bing/Google)
// 2. Crawls result pages
// 3. Extracts metadata (title, snippet, images)
// 4. Returns structured data to the agent
```

**Response:**
```json
{
  "ok": true,
  "results": [
    {
      "type": "image",
      "title": "IBM Quantum Processor Architecture",
      "url": "https://research.ibm.com/quantum/architecture",
      "snippet": "IBM's quantum processors use superconducting qubits...",
      "thumbnail": "https://research.ibm.com/images/quantum-chip.jpg"
    },
    {
      "type": "article",
      "title": "Quantum Entanglement Breakthrough - Nature",
      "url": "https://nature.com/articles/quantum-2023",
      "snippet": "Researchers at MIT demonstrated quantum coherence at room temperature..."
    },
    {
      "type": "image",
      "title": "Qubit Coherence Diagram",
      "url": "https://arxiv.org/quantum-diagrams",
      "thumbnail": "https://arxiv.org/images/qubit-coherence.png"
    }
  ]
}
```

---

### 3. Quality Scoring (Client-Side)

```typescript
// src/lib/searchRenderers.ts
const mediaItems = results
  .filter(item => item.type === 'video' || item.type === 'image')
  .map(item => {
    let score = 0;
    const text = `${item.url} ${item.title}`.toLowerCase();
    
    // Positive signals
    if (/wikipedia|nasa|museum|\.edu|\.gov/.test(text)) score += 15;
    if (/diagram|infographic|visualization/.test(text)) score += 12;
    if (/official|research|scientific/.test(text)) score += 10;
    
    // Negative signals
    if (/stock|shutterstock|getty/.test(text)) score -= 20;
    if (/logo|icon|favicon/.test(text)) score -= 15;
    
    return { ...item, qualityScore: score };
  })
  .sort((a, b) => b.qualityScore - a.qualityScore);

const topMedia = mediaItems.slice(0, 3);
```

**Example Scores:**
```
IBM Quantum Architecture:
  +15 (research.ibm.com)
  +12 (architecture in title)
  +10 (official source)
  = 37 points ✅

Stock Photo Site:
  -20 (shutterstock.com)
  = -20 points ❌

Wikipedia Diagram:
  +15 (wikipedia.org)
  +12 (diagram in URL)
  = 27 points ✅
```

---

### 4. Image Proxy (When Needed)

**When to use:**
- URL is not a direct image (e.g., `https://example.com/article` instead of `https://example.com/image.jpg`)
- Need to bypass CORS restrictions
- Need to extract the best image from a page

**Frontend:**
```typescript
// src/lib/searchRenderers.ts
const img = document.createElement('img');

if (isImageUrl(imageUrl)) {
  // Direct image URL
  img.src = imageUrl;
} else {
  // Page URL - use proxy
  img.src = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
}
```

**HTTP Request:**
```http
GET /api/ai/image?url=https%3A%2F%2Fresearch.ibm.com%2Fquantum
```

**Backend Processing:**
```typescript
// server/src/index.ts
app.get('/api/ai/image', async (req, res) => {
  const pageUrl = req.query.url;
  
  // 1. Fetch the HTML page
  const response = await fetch(pageUrl);
  const html = await response.text();
  
  // 2. Extract and score all images
  const images = extractImgSrcsFromHtml(html, pageUrl);
  // Returns: [
  //   { url: "logo.svg", score: -25 },
  //   { url: "hero-image.jpg", score: +35 },
  //   { url: "ad-banner.jpg", score: -20 }
  // ]
  
  // 3. Get the highest-scored image
  const bestImageUrl = images[0].url;
  
  // 4. Fetch the actual image
  const imageResponse = await fetch(bestImageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  
  // 5. Return the image
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(Buffer.from(imageBuffer));
});
```

**Image Scoring Logic:**
```typescript
// server/src/index.ts
const extractImgSrcsFromHtml = (html: string, baseUrl: string) => {
  const candidates = [];
  
  // Find all <img> tags
  const imgTags = html.matchAll(/<img[^>]+>/gi);
  
  for (const tag of imgTags) {
    const src = tag.match(/src=["']([^"']+)["']/)?.[1];
    const width = tag.match(/width=["']?(\d+)/)?.[1];
    const height = tag.match(/height=["']?(\d+)/)?.[1];
    
    let score = 0;
    
    // Size scoring
    if (width >= 600 || height >= 400) score += 20;
    else if (width < 100 && height < 100) score -= 15;
    
    // URL scoring
    if (/upload|content|media/.test(src)) score += 15;
    if (/logo|icon|favicon/.test(src)) score -= 25;
    
    candidates.push({ url: absolutize(src, baseUrl), score });
  }
  
  return candidates.sort((a, b) => b.score - a.score);
};
```

---

### 5. Narrative Generation

**Frontend Call:**
```typescript
// src/lib/openaiAgentApi.ts
const result = await fetchSkeletonNotesWithGemini(
  "quantum computing",
  "gpt-4o-mini",
  searchContext  // Results from web search
);
```

**HTTP Request:**
```http
POST /api/ai/action
Content-Type: application/json

{
  "action": "review",
  "text": "quantum computing",
  "model": "gpt-4o-mini",
  "searchContext": "Title: IBM Quantum...\nURL: https://...\nSnippet: ..."
}
```

**Backend Processing:**
```typescript
// server/src/ai.ts
const agent = new Agent({
  name: 'DocumentAssistant',
  instructions: 'You are writing skeleton notes...',
  model: 'gpt-4o-mini'
});

const prompt = `
${instructions}

Context from web search:
${searchContext}

User's text:
quantum computing
`;

const result = await run(agent, prompt);
```

**Response:**
```json
{
  "ok": true,
  "text": "{\"blocks\":[{\"kind\":\"ai\",\"text\":\"Quantum computing uses qubits that can exist in superposition, allowing them to process multiple states simultaneously. IBM's quantum processors use superconducting qubits arranged in a lattice, achieving coherence times exceeding 100 microseconds.\"},{\"kind\":\"input\",\"prompt\":\"How might quantum error correction evolve in the next decade?\",\"lines\":3}]}"
}
```

---

### 6. Final Rendering

```typescript
// src/lib/searchRenderers.ts
const buildSearchResultsBlock = async (items, notes) => {
  const container = document.createElement('div');
  
  // 1. Render media (top 3)
  topMedia.forEach(item => {
    const card = createInlineResultCard(item);
    container.appendChild(card);
  });
  
  // 2. Render excerpt
  const excerpt = document.createElement('blockquote');
  excerpt.textContent = `"${bestSnippet.snippet}"`;
  container.appendChild(excerpt);
  
  // 3. Render AI narrative
  notes.blocks.forEach(block => {
    if (block.kind === 'ai') {
      const aiText = document.createElement('div');
      aiText.textContent = block.text;
      container.appendChild(aiText);
    }
  });
  
  return container;
};
```

---

## Complete Example: From User Input to Rendered Content

```typescript
// User types: "quantum computing"

// 1. Plan search
const plan = await planSearchWithGemini("quantum computing");
// → { shouldSearch: true, queries: [...] }

// 2. Execute searches
const results = await searchWithAgent(plan.queries);
// → [{ type: "image", url: "...", title: "..." }, ...]

// 3. Score and filter
const topMedia = scoreAndFilterMedia(results);
// → Top 3 highest-quality items

// 4. Generate narrative
const notes = await fetchSkeletonNotesWithGemini("quantum computing", searchContext);
// → { blocks: [{ kind: "ai", text: "..." }] }

// 5. Render everything
const block = await buildSearchResultsBlock(topMedia, notes);
editorRef.current.appendChild(block);
// → Beautiful media cards with captions, play buttons, etc.
```

---

## Key Takeaways

1. **OpenAI's `webSearchTool()` does the heavy lifting**
   - It's a hosted service that searches the web
   - Returns structured data (URLs, titles, snippets, thumbnails)
   - We don't implement the search ourselves

2. **We enhance the results with:**
   - Smart query generation (specific, targeted)
   - Quality scoring (filter out junk)
   - Image extraction (best image from page)
   - Rich UI rendering (engaging presentation)

3. **It's a pipeline, not a single call:**
   ```
   Plan → Search → Score → Extract → Render
   ```

4. **Each stage adds intelligence:**
   - Planning: What to search for
   - Searching: Where to look
   - Scoring: What's worth showing
   - Extracting: Best content from pages
   - Rendering: How to present it
