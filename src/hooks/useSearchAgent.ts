import { useState, useCallback, useRef } from 'react';
import { fullReview, type AiError, type AgentSearchResult } from '../lib/openaiAgentApi';
import { extractDocumentContext } from '../lib/contextExtractor';
import {
    buildSearchResultsBlock,
    createLoadingShimmer,
    updateShimmerPhase,
    type LoadingPhase
} from '../lib/searchRenderers';
import { orderedSearchResultsToItems } from '../lib/searchResultItems';

export type ReviewPhase = 'idle' | 'planning' | 'searching' | 'generating' | 'rendering';

export function useSearchAgent(
    editorRef: React.RefObject<HTMLDivElement>,
    selectedModel: string,
    hydrateSearchResultImages: (root: HTMLElement | null) => void,
    onResultsInserted?: (outputContainer: HTMLElement) => void
) {
    const [phase, setPhase] = useState<ReviewPhase>('idle');
    const [error, setError] = useState<AiError | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const shimmerRef = useRef<HTMLElement | null>(null);

    /**
     * Cancels any in-progress AI review.
     * Removes the shimmer from the document and resets state.
     */
    const cancelReview = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        // Clean up shimmer if present
        if (shimmerRef.current && shimmerRef.current.parentNode) {
            shimmerRef.current.parentNode.removeChild(shimmerRef.current);
            shimmerRef.current = null;
        }
        setPhase('idle');
    }, []);

    /**
     * Triggers AI review on the current selection or entire document.
     * Inserts a shimmer loading indicator and calls the batched API endpoint.
     */
    const handleAiReview = useCallback(async () => {
        if (!editorRef.current || phase !== 'idle') return;

        // Cancel any existing request
        cancelReview();

        setError(null);

        // Create new abort controller
        abortControllerRef.current = new AbortController();

        try {
            // Get text to review
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
                return;
            }

            // Insert shimmer loading state
            setPhase('planning');
            const shimmer = createLoadingShimmer('planning');
            shimmerRef.current = shimmer;

            // Insert after selection or at end of document
            if (range) {
                range.collapse(false);
                range.insertNode(shimmer);
            } else {
                const lastChild = editorRef.current.lastChild;
                const newRange = document.createRange();
                if (lastChild) {
                    newRange.setStartAfter(lastChild);
                } else {
                    newRange.setStart(editorRef.current, 0);
                }
                newRange.collapse(true);
                newRange.insertNode(shimmer);
            }

            // Update shimmer phase as we progress
            setPhase('searching');
            updateShimmerPhase(shimmer, 'searching');

            // Make the unified API call with context
            const context = extractDocumentContext(editorRef.current);
            const result = await fullReview(
                trimmedText,
                selectedModel,
                abortControllerRef.current.signal,
                context
            );

            if (!result.ok) {
                // Remove shimmer, set error
                shimmer.remove();
                shimmerRef.current = null;

                if (result.error.type !== 'cancelled') {
                    setError(result.error);
                }
                setPhase('idle');
                return;
            }

            // Update shimmer to "generating" during render phase
            setPhase('generating');
            updateShimmerPhase(shimmer, 'generating');

            // Build and insert results
            const { searchResults, narrative } = result.data;

            if (searchResults.length > 0 || (narrative && narrative.blocks.length > 0)) {
                const resultItems = orderedSearchResultsToItems(searchResults as AgentSearchResult[]);
                const resultsBlock = await buildSearchResultsBlock(resultItems, narrative);

                // Replace shimmer with results
                shimmer.replaceWith(resultsBlock);
                shimmerRef.current = null;

                hydrateSearchResultImages(editorRef.current);
                onResultsInserted?.(resultsBlock);
            } else {
                // No results - remove shimmer, set error
                shimmer.remove();
                shimmerRef.current = null;
                setError({
                    type: 'no_results',
                    message: 'AI decided no search or review was needed for this text.',
                    suggestion: 'Try selecting a different passage or adding more context.'
                });
            }
        } catch (err) {
            // Clean up shimmer on unexpected error
            if (shimmerRef.current) {
                shimmerRef.current.remove();
                shimmerRef.current = null;
            }

            if (err instanceof DOMException && err.name === 'AbortError') {
                // Cancelled - already handled
                setPhase('idle');
                return;
            }

            setError({
                type: 'unknown',
                message: err instanceof Error ? err.message : String(err)
            });
        } finally {
            setPhase('idle');
            abortControllerRef.current = null;
        }
    }, [editorRef, selectedModel, hydrateSearchResultImages, phase, cancelReview]);

    return {
        handleAiReview,
        cancelReview,
        phase,
        isLoading: phase !== 'idle',
        // Legacy compatibility aliases
        aiLoading: phase !== 'idle',
        isSearching: phase === 'searching',
        aiError: error,
        setAiError: setError
    };
}
