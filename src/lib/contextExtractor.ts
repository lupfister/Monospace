import { isAiTextSpan, isHumanTextSpan } from './textStyles';

export type ContextSource = 'human' | 'ai';

export interface ContextBlock {
    source: ContextSource;
    text: string;
}

/**
 * Extracts a linear sequence of "turns" from the document.
 * Adjacent nodes of the same source are collapsed into a single block.
 */
export const extractDocumentContext = (editor: HTMLElement): ContextBlock[] => {
    const blocks: ContextBlock[] = [];
    let currentSource: ContextSource | null = null;
    let currentText = '';

    const isInOutputToggle = (node: Node): boolean => {
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
        if (!element) return false;
        return Boolean(element.closest('[data-ai-output-toggle="true"]'));
    };

    const commitCurrent = () => {
        if (currentSource && currentText.trim()) {
            blocks.push({ source: currentSource, text: currentText.trim() });
        }
        currentText = '';
        currentSource = null;
    };

    const processNode = (node: Node) => {
        if (isInOutputToggle(node)) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (!text.trim()) return;

            // Determine source based on parent element style
            let source: ContextSource = 'human'; // Default to human
            const parent = node.parentElement;
            if (parent) {
                if (isAiTextSpan(parent)) {
                    source = 'ai';
                } else if (isHumanTextSpan(parent)) {
                    source = 'human';
                } else {
                    // Fallback for non-span elements (like P tags without spans)
                    // If the P tag has the AI style class or inline style, we could check that.
                    // But currently the editor seems to wrap everything in spans.
                    // If no specific span, assume human (user input).
                    source = 'human';
                }
            }

            if (currentSource === source) {
                currentText += ' ' + text;
            } else {
                commitCurrent();
                currentSource = source;
                currentText = text;
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

    // Merge adjacent blocks of same source if any slipped through (though logic above handles it)
    // Also clean up empty blocks
    const merged: ContextBlock[] = [];
    for (const block of blocks) {
        if (!block.text) continue;
        if (merged.length > 0 && merged[merged.length - 1].source === block.source) {
            merged[merged.length - 1].text += '\n' + block.text;
        } else {
            merged.push(block);
        }
    }

    return merged;
};
