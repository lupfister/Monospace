import { useCallback, useEffect, useRef } from 'react';
import { createAiTextSpan, createStyledSourceLink } from '../lib/textStyles';

export function useLinkHydrator(editorRef: React.RefObject<HTMLDivElement>) {
    const createLinkAnchor = useCallback((url: string) => {
        const link = createStyledSourceLink(url, url);
        // Add small margins for inline display
        link.style.marginLeft = '4px';
        link.style.marginRight = '4px';
        return link;
    }, []);

    const processLinksAndEmbeds = useCallback(() => {
        const root = editorRef.current;
        if (!root) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const parent = (node as Text).parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest('a')) return NodeFilter.FILTER_REJECT;
                if (parent.closest('[role="link"]')) return NodeFilter.FILTER_REJECT;
                if (!(node.textContent || '').includes('http')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });

        const urlRegex = /(https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?])/g;
        const textNodes: Text[] = [];
        let n: Node | null;
        while ((n = walker.nextNode())) {
            textNodes.push(n as Text);
        }

        for (const textNode of textNodes) {
            const text = textNode.textContent || '';
            if (!urlRegex.test(text)) continue;
            urlRegex.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = urlRegex.exec(text))) {
                const start = match.index;
                const end = start + match[0].length;
                const url = match[0];

                if (start > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
                }
                frag.appendChild(createLinkAnchor(url));
                lastIndex = end;
            }

            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            textNode.parentNode?.replaceChild(frag, textNode);
        }
    }, [createLinkAnchor, editorRef]);

    const hydrateSearchResultImages = useCallback((root: HTMLElement | null) => {
        if (!root) return;
        const imgs = root.querySelectorAll<HTMLImageElement>('img[data-proxy-url]');
        imgs.forEach((img) => {
            const proxyUrl = img.dataset.proxyUrl;
            if (!proxyUrl) return;
            fetch(proxyUrl)
                .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const ct = (res.headers.get('content-type') || '').toLowerCase();
                    if (!ct.startsWith('image/')) throw new Error('Not an image');
                    return res.blob();
                })
                .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    img.src = url;
                    img.onload = () => URL.revokeObjectURL(url);
                })
                .catch(() => {
                    const figure = img.closest('figure');
                    const fallbackUrl = img.dataset.fallbackUrl || figure?.dataset.fallbackUrl || '';
                    const fallback = document.createElement('div');
                    if (fallbackUrl) {
                        const imgLabel = img.alt ? `Open image: ${img.alt}` : 'Open image';
                        fallback.appendChild(createStyledSourceLink(fallbackUrl, imgLabel));
                    } else {
                        fallback.appendChild(createAiTextSpan('Image unavailable'));
                    }
                    img.parentNode?.insertBefore(fallback, img);
                    img.remove();
                });
        });
    }, []);

    useEffect(() => {
        const root = editorRef.current;
        if (!root) return;

        let rafId: number | null = null;
        const schedule = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => processLinksAndEmbeds());
        };

        const observer = new MutationObserver(() => schedule());
        observer.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
        });

        schedule();

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [processLinksAndEmbeds, editorRef]);

    return {
        hydrateSearchResultImages
    };
}
