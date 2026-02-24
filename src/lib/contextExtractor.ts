import { isAiTextSpan, isHumanTextSpan } from './textStyles';

export type ContextSource = 'human' | 'ai';

export interface ContextBlock {
    source: ContextSource;
    text: string;
    updatedAt?: number;
    highlighted?: boolean;
}

/**
 * Extracts a linear sequence of "turns" from the document.
 * Adjacent nodes of the same source are collapsed into a single block.
 */
export const extractDocumentContext = (editor: HTMLElement): ContextBlock[] => {
    const blocks: ContextBlock[] = [];
    let currentSource: ContextSource | null = null;
    let currentText = '';
    let currentUpdatedAt: number | undefined;
    let currentHighlighted: boolean | undefined;

    const MERGE_TIME_WINDOW_MS = 5 * 60 * 1000;

    const parseTimestamp = (raw?: string | null): number | undefined => {
        if (!raw) return undefined;
        const num = Number(raw);
        if (!Number.isNaN(num) && num > 0) return num;
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) return parsed;
        return undefined;
    };

    const isInOutputToggle = (node: Node): boolean => {
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
        if (!element) return false;
        return Boolean(element.closest('[data-ai-output-toggle="true"]'));
    };

    const commitCurrent = () => {
        if (currentSource && currentText.trim()) {
            blocks.push({
                source: currentSource,
                text: currentText.trim(),
                updatedAt: currentUpdatedAt,
                highlighted: currentHighlighted,
            });
        }
        currentText = '';
        currentSource = null;
        currentUpdatedAt = undefined;
        currentHighlighted = undefined;
    };

    const getSourceFromElement = (element: HTMLElement | null): ContextSource => {
        if (!element) return 'human';
        if (element.closest('[data-human-text="true"]')) return 'human';
        if (element.closest('[data-ai-text="true"], [data-ai-origin="true"], [data-ai-question="true"]')) return 'ai';
        if (isAiTextSpan(element)) return 'ai';
        if (isHumanTextSpan(element)) return 'human';
        return 'human';
    };

    const getUpdatedAtForElement = (element: HTMLElement | null, source: ContextSource, highlighted: boolean): number | undefined => {
        if (!element) return undefined;
        if (source === 'human') {
            const humanEl = element.closest('[data-human-updated-at]');
            return parseTimestamp(humanEl?.getAttribute('data-human-updated-at'));
        }
        if (highlighted) {
            const highlightEl = element.closest('[data-ai-highlighted-at]');
            const highlightTs = parseTimestamp(highlightEl?.getAttribute('data-ai-highlighted-at'));
            if (highlightTs) return highlightTs;
        }
        const outputEl = element.closest('[data-ai-output-generated-at]');
        const outputTs = parseTimestamp(outputEl?.getAttribute('data-ai-output-generated-at'));
        if (outputTs) return outputTs;
        const aiEl = element.closest('[data-ai-generated-at]');
        return parseTimestamp(aiEl?.getAttribute('data-ai-generated-at'));
    };

    const shouldMerge = (
        source: ContextSource,
        highlighted: boolean,
        updatedAt: number | undefined
    ): boolean => {
        if (currentSource !== source) return false;
        if (Boolean(currentHighlighted) !== Boolean(highlighted)) return false;
        if (!currentUpdatedAt || !updatedAt) {
            return true;
        }
        return Math.abs(currentUpdatedAt - updatedAt) <= MERGE_TIME_WINDOW_MS;
    };

    const processNode = (node: Node) => {
        if (isInOutputToggle(node)) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (!text.trim()) return;

            // Determine source based on parent element style
            const parent = node.parentElement;
            const source = getSourceFromElement(parent);
            const highlighted = Boolean(parent?.closest('[data-ai-highlighted="true"]'));
            const updatedAt = getUpdatedAtForElement(parent, source, highlighted);

            if (shouldMerge(source, highlighted, updatedAt)) {
                currentText += ' ' + text;
                if (updatedAt && (!currentUpdatedAt || updatedAt > currentUpdatedAt)) {
                    currentUpdatedAt = updatedAt;
                }
            } else {
                commitCurrent();
                currentSource = source;
                currentText = text;
                currentUpdatedAt = updatedAt;
                currentHighlighted = highlighted;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Recurse for elements
            const element = node as HTMLElement;
            if (element.getAttribute('data-ai-output-toggle') === 'true') {
                return;
            }
            // Handle line breaks as text separators if needed, but ' ' usually suffices for context
            if (element.tagName === 'BR') {
                if (currentSource) currentText += '\n';
                return;
            }

            // If it's a block element (P, DIV), implies a separator, but we just want the text stream.
            // We might want to add a newline to currentText if we are traversing.
            const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE'].includes(element.tagName);
            if (isBlock && currentSource) {
                currentText += '\n';
            }

            element.childNodes.forEach(processNode);

            if (isBlock && currentSource) {
                currentText += '\n';
            }
        }
    };

    editor.childNodes.forEach(processNode);
    commitCurrent();

    // Merge adjacent blocks of same source/metadata if any slipped through (though logic above handles it)
    // Also clean up empty blocks
    const merged: ContextBlock[] = [];
    for (const block of blocks) {
        if (!block.text) continue;
        const prev = merged[merged.length - 1];
        const canMerge =
            prev &&
            prev.source === block.source &&
            Boolean(prev.highlighted) === Boolean(block.highlighted) &&
            (!prev.updatedAt || !block.updatedAt || Math.abs(prev.updatedAt - block.updatedAt) <= MERGE_TIME_WINDOW_MS);

        if (canMerge) {
            prev.text += '\n' + block.text;
            if (block.updatedAt && (!prev.updatedAt || block.updatedAt > prev.updatedAt)) {
                prev.updatedAt = block.updatedAt;
            }
        } else {
            merged.push(block);
        }
    }

    return merged;
};
