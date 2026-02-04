import { useState, useCallback } from 'react';
import { planSearchWithGemini, searchWithAgent, type AgentSearchRequest, fetchSkeletonNotesWithGemini, type SkeletonNotes } from '../lib/openaiAgentApi';
import { buildSearchResultsBlock } from '../lib/searchRenderers';
import { orderedSearchResultsToItems } from '../lib/searchResultItems';

export function useSearchAgent(
    editorRef: React.RefObject<HTMLDivElement>,
    selectedModel: string,
    hydrateSearchResultImages: (root: HTMLElement | null) => void
) {
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    const handleAiReview = useCallback(async () => {
        if (!editorRef.current || aiLoading || isSearching) return;

        setAiError(null);
        setAiLoading(true);

        try {
            const selection = window.getSelection();
            let textToReview = '';
            let range: Range | null = null;

            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                range = selection.getRangeAt(0);
                textToReview = range.toString();
            } else {
                textToReview = editorRef.current.innerText || '';
            }

            const trimmedText = textToReview.trim();
            if (!trimmedText) {
                setAiLoading(false);
                return;
            }

            // 1. Plan Search
            const plan = await planSearchWithGemini(trimmedText, selectedModel);
            console.log('[useSearchAgent] Plan:', plan);

            let searchResults: any[] = [];
            let searchContext: string | undefined = undefined;

            // 2. Execute Search (if needed)
            if (plan.shouldSearch && plan.queries.length > 0) {
                setIsSearching(true);
                const agentQueries: AgentSearchRequest[] = plan.queries.map(q => ({
                    type: q.type === 'web' ? 'article' : q.type,
                    query: q.query
                }));

                try {
                    searchResults = await searchWithAgent(agentQueries, selectedModel);
                    console.log('[useSearchAgent] Search Results:', searchResults);
                    if (searchResults.length > 0) {
                        // Prepare context for the narrative agent
                        searchContext = searchResults.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet || ''}`).join('\n\n');
                    }
                } catch (e) {
                    console.error('Search failed', e);
                } finally {
                    setIsSearching(false);
                }
            }

            // 3. Generate Narrative (Skeleton Notes) - Passing Search Context
            const skeletonResult = await fetchSkeletonNotesWithGemini(trimmedText, selectedModel, searchContext);
            const notes = skeletonResult.ok ? skeletonResult.notes : undefined;

            // 4. Render Combined Output
            if (searchResults.length > 0 || (notes && notes.blocks.length > 0)) {
                // Check if notes requested *more* search (unlikely given the new order, but we can support it if we want to loop, but let's just stick to the initial search for now or do a quick secondary fetch if absolutely needed. For now, we trust the initial search is sufficient.)

                // One edge case: If the narrative decided to add a search tag despite us already searching, do we search again?
                // The prompt says "After the JSON, if you think web search results would be helpful..."
                // Since we already searched, we might want to skip this or treat it as "additional" queries.
                // Let's keep it simple: We use the already-fetched results. If we really want to support the "post-generation" search tag, we could.
                // But the user asked for "searching should always precede the narrative". So we consider the loop closed.
                // However, we might want to MERGE any *extra* media queries?
                // Actually, let's just rely on the initial plan.

                // 3. Render integrated block
                const resultItems = orderedSearchResultsToItems(searchResults as any);
                const resultsFragment = await buildSearchResultsBlock(resultItems, notes);

                // 4. Insert into editor
                if (range) {
                    range.collapse(false); // Insert after selection
                    // Simply insert the fragment. It contains proper blocks (p/div) and spacers.
                    range.insertNode(resultsFragment);
                } else {
                    const lastChild = editorRef.current.lastChild;
                    const newRange = document.createRange();
                    if (lastChild) {
                        newRange.setStartAfter(lastChild);
                    } else {
                        newRange.setStart(editorRef.current, 0);
                    }
                    newRange.collapse(true);
                    newRange.insertNode(resultsFragment);
                }

                hydrateSearchResultImages(editorRef.current);
            } else {
                setAiError("AI decided no search or review was needed for this text.");
            }
        } catch (err) {
            setAiError(err instanceof Error ? err.message : String(err));
        } finally {
            setAiLoading(false);
        }
    }, [editorRef, selectedModel, hydrateSearchResultImages, aiLoading, isSearching]);

    return {
        handleAiReview,
        aiLoading,
        aiError,
        isSearching,
        setAiError
    };
}
