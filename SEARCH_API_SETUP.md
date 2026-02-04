# Web Search API Setup

The web search feature is now integrated into the document editor using **OpenAI Agents**.

## Setup

1. Ensure your server has a valid `OPENAI_API_KEY` in the `.env` file.
2. The search agent uses the `web_search` tool from the `@openai/agents-openai` SDK.

## Capabilities

- **YouTube Videos**: Finds relevant videos.
- **Images**: Finds contextually relevant images (screenshots, diagrams, icons, etc.).
- **Articles**: Finds and summarizes relevant web articles.

## Usage

1. Select text in the document editor.
2. Click the search icon (🔍) in the toolbar.
3. The AI will suggest search queries based on your text.
4. Search results will appear in a dialog.

## Notes

- The search feature requires an active internet connection.
- Costs are incurred via your OpenAI API usage.
