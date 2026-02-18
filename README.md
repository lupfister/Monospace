# Simple Document Editor v3

A research‑assisted writing environment that treats the document itself as the UI. It combines a minimal content‑editable editor with AI review, web search, inline media embeds, and margin notes so you can draft, explore sources, and capture side thoughts without leaving the page.

## What’s the point?
This project is an experiment in **document‑first UX**:
- The document is the interface. Everything (AI notes, questions, sources, images, videos, etc) is rendered directly into the editable flow rather than in side panels or modals.
- Human and AI text are visually distinct, so you can see what you wrote vs. what the system generated.
- Research is “serendipitous.” The AI review uses web search to pull surprising connections and context, then inserts a structured narrative and prompts right into the doc.
- Margin notes let you drag selections out of the main flow, rearrange them freely, and expand them back into the document later.

## How it works (high‑level flow)
1. **Editing:** The main editor is a `contentEditable` div. Text is inserted through custom handlers so every character is wrapped in styled spans (human text = Garamond 20px, AI text = Inter 18px gray).
2. **AI review trigger:** Select text (or leave selection empty to use the whole document) and click the ✨ “AI Review” button or press `Cmd/Ctrl + Enter`.
3. **Client request:** The client extracts document context (human/AI blocks), shows a shimmer placeholder, and calls `POST /api/ai/review`.
4. **Server orchestration:** The server uses the OpenAI Agents SDK to:
   - Plan searches (web/image/video) for serendipitous context.
   - Execute those searches in parallel with the hosted `web_search` tool.
   - Generate a structured “skeleton notes” JSON response (info + questions).
5. **Rendering in the document:** The client renders:
   - A per‑review AI output wrapper with a loop‑icon toggle
   - A collapsible “Viewed sources” list
   - The best image and/or video embeds
   - A highlighted excerpt quote
   - The AI narrative and questions as editable blocks
6. **Link hydration:** Any raw URLs typed/pasted in the editor become unified “source pills.”
7. **Image proxy:** Media embeds use `/api/ai/image` to safely fetch OG images or page images and avoid broken thumbnails.

## Key UX features
- **Inline AI blocks:** Each AI review is inserted directly into the editor as a self‑contained output block.
- **Per‑output hiding:** Every AI output has its own loop‑icon line to collapse/reveal it; hidden outputs leave only highlights and user text visible.
- **Margin notes:** Drag a selection into the left or right margin to create a floating note; click once to edit, double‑click to expand back into the main document.
- **Multi‑selection drag:** Hold Shift to create extra selections, then drag them together.
- **Line‑height handle:** Empty gap blocks can be expanded/contracted with a draggable handle for manual spacing control.
- **Smart paste:** URLs become source pills; text preserves line breaks.
- **Local persistence:** Document content is stored in `localStorage` on save (`Cmd/Ctrl + S`).

## AI review lifecycle (vision)
1. Day 0: the user writes notes.
2. Day 1: the AI review inserts excerpts and questions into the document.
3. Day 2+: the previous day’s AI output collapses into a single loop‑icon line; only highlighted AI text and user‑written text remain visible. Clicking the line reveals the full output.
4. A fresh AI review appears below, and the cycle repeats.

In this prototype, “days” are simulated manually: each AI output can be collapsed/expanded via its own loop‑icon line, and new reviews auto‑collapse earlier outputs to keep focus on the current pass.

## Architecture
- **Frontend:** React + Vite + Tailwind utilities (with some custom DOM manipulation).
- **Backend:** Express server providing AI endpoints and an image proxy.
- **AI orchestration:** `@openai/agents` with `webSearchTool()` for real web results.

## Important files
- `src/components/DocumentEditor.tsx` — main editor logic, drag/drop, AI trigger, toolbar, margin notes.
- `src/components/MarginText.tsx` — floating margin notes (edit/drag/expand).
- `src/components/LineHeightHandle.tsx` — adjustable empty‑line spacing control.
- `src/hooks/useSearchAgent.ts` — AI review client flow and shimmer handling.
- `src/hooks/useLinkHydrator.ts` — URL → source pill conversion, image hydration.
- `src/lib/aiOutputVisibility.ts` — per‑output AI hiding logic (collapsed state + highlight preservation).
- `src/lib/searchRenderers.ts` — renders sources/media/quotes/notes into the doc.
- `src/lib/openaiAgentApi.ts` — client API helpers and types.
- `server/src/ai.ts` — OpenAI Agents logic (plan, search, narrative).
- `server/src/index.ts` — Express routes and image proxy.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root with your API key:
   ```bash
   OPENAI_API_KEY=sk-...
   ```
3. Run both client and server:
   ```bash
   npm run dev
   ```
4. Open the app at the Vite dev server URL (usually `http://localhost:5173`).

## Scripts
- `npm run dev` — run client + server concurrently
- `npm run dev:client` — Vite dev server
- `npm run dev:server` — Express AI server (default port 4000)
- `npm run build` — production build

## Notes and constraints
- The editor relies on `contentEditable` and custom DOM handling; changes to core DOM structures can break selection behavior.
- The AI search feature requires network access and will incur OpenAI API usage costs.
- The image proxy is designed to handle real‑world pages (og:image or <img>), but some sites will still block requests.

## Design principles
- **All text is the same and editable:** Text written by humans is always the same styling, size, and color. Text written by AI is always the same styling, size, and color.
- **Document‑first UI:** All output (AI, sources, media) lives inside the editable flow, not in side panels. They are all directly manipulable
- **Visual provenance:** Human vs. AI text is visually distinct to preserve authorship clarity.
- **Serendipity over exhaustiveness:** Search aims for surprising, high‑signal context, not exhaustive coverage.
- **Direct manipulation:** Dragging, margin notes, and inline edits should feel physical and immediate.
- **Minimal chrome:** The editor stays lightweight; controls are secondary to the writing surface.

## Known quirks
- `contentEditable` edge cases can cause selection glitches, especially around mixed inline/block nodes.
- Drag/drop placement uses DOM rect heuristics and can feel “off” in very dense layouts.
- Some sources block image fetching, so thumbnails may fall back to links or “Image unavailable.”
- Large documents can make mutation observers and selection tracking feel sluggish.
