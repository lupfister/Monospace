import React, { useEffect, useState, useRef } from 'react';

interface LineHeightHandleProps {
    editorRef: React.RefObject<HTMLDivElement>;
}

interface Gap {
    nodes: HTMLElement[];
    topY: number;
    bottomY: number;
    left: number;
}

export function LineHeightHandle({ editorRef }: LineHeightHandleProps) {
    const [activeGap, setActiveGap] = useState<Gap | null>(null);
    const [dragging, setDragging] = useState<{ handle: 'top' | 'bottom'; startY: number; initialHeight: number } | null>(null);

    // Refs to track state inside event listeners without re-binding
    const draggingRef = useRef(dragging);
    const isMouseDownRef = useRef(false);

    useEffect(() => {
        draggingRef.current = dragging;
    }, [dragging]);

    // Check if an element is widely considered "empty" in our editor context
    const isEmptyElement = (node: Node | null): node is HTMLElement => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const el = node as HTMLElement;
        if (el === editorRef.current) return false;

        // Must be visibly part of the editor content
        if (!editorRef.current?.contains(el)) return false;

        // Ignore UI overlays
        if (el.style.position === 'fixed' || el.style.position === 'absolute') return false;

        // Content check
        if (el.textContent?.trim() !== '') return false;

        // Structural check: BR, empty text nodes, or no children
        const isBlank = el.tagName === 'BR' || el.querySelector('br') !== null || el.innerText.trim() === '';

        // Exclude system elements
        const isEmbed = el.hasAttribute('data-embed') || el.classList.contains('result-item');

        return isBlank && !isEmbed;
    };

    const detectGap = () => {
        // If mouse is down and we aren't dragging a handle, user is likely selecting text.
        // Hide handles to prevent interference and layout thrashing.
        if (isMouseDownRef.current && !draggingRef.current) {
            setActiveGap(null);
            return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || !editorRef.current) {
            setActiveGap(null);
            return;
        }

        const range = selection.getRangeAt(0);
        let node: Node | null = range.startContainer;
        let target: HTMLElement | null = null;

        // 1. Resolve selection to a target element
        if (node.nodeType === Node.TEXT_NODE) {
            target = node.parentElement;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const offset = range.startOffset;
            const childAtOffset = node.childNodes[offset] || node.childNodes[offset - 1] || node;
            target = childAtOffset.nodeType === Node.ELEMENT_NODE ? childAtOffset as HTMLElement : childAtOffset.parentElement;
        }

        if (!target || !editorRef.current.contains(target)) {
            setActiveGap(null);
            return;
        }

        // 2. Find the nearest "empty" ancestor/self from the click target
        let initialGapItem: HTMLElement | null = null;
        let curr: HTMLElement | null = target;
        while (curr && curr !== editorRef.current) {
            if (isEmptyElement(curr)) {
                initialGapItem = curr;
                break;
            }
            curr = curr.parentElement;
        }

        if (!initialGapItem) {
            setActiveGap(null);
            return;
        }

        // 3. RADAR SCAN: Use visual probing to find all adjacent empty blocks.
        // This transcends DOM structure issues (nested divs, siblings, AI wrappers).
        const foundNodes = new Set<HTMLElement>();
        foundNodes.add(initialGapItem);
        const gapNodesList: HTMLElement[] = [initialGapItem];

        const initialRect = initialGapItem.getBoundingClientRect();
        const centerX = initialRect.left + (initialRect.width / 2);

        // Scan UP
        let probeY = initialRect.top - 5;
        let checks = 0;
        const MAX_CHECKS = 50; // Safety limit

        while (checks < MAX_CHECKS) {
            const elAtPoint = document.elementFromPoint(centerX, probeY);
            let candidate: HTMLElement | null = null;

            // Walk up from hit target to find a valid empty block
            let temp = elAtPoint as HTMLElement;
            while (temp && temp !== editorRef.current && editorRef.current.contains(temp)) {
                if (isEmptyElement(temp) && !foundNodes.has(temp)) {
                    candidate = temp;
                    break;
                }
                temp = temp.parentElement as HTMLElement;
            }

            if (candidate) {
                foundNodes.add(candidate);
                gapNodesList.unshift(candidate);
                probeY = candidate.getBoundingClientRect().top - 5;
            } else {
                // If we didn't hit a new empty block, stop scanning
                break;
            }
            checks++;
        }

        // Scan DOWN
        probeY = initialRect.bottom + 5;
        checks = 0;
        while (checks < MAX_CHECKS) {
            const elAtPoint = document.elementFromPoint(centerX, probeY);
            let candidate: HTMLElement | null = null;

            let temp = elAtPoint as HTMLElement;
            while (temp && temp !== editorRef.current && editorRef.current.contains(temp)) {
                if (isEmptyElement(temp) && !foundNodes.has(temp)) {
                    candidate = temp;
                    break;
                }
                temp = temp.parentElement as HTMLElement;
            }

            if (candidate) {
                foundNodes.add(candidate);
                gapNodesList.push(candidate);
                probeY = candidate.getBoundingClientRect().bottom + 5;
            } else {
                break;
            }
            checks++;
        }

        // 4. Measure total boundaries
        const firstRect = gapNodesList[0].getBoundingClientRect();
        const lastRect = gapNodesList[gapNodesList.length - 1].getBoundingClientRect();
        const editorRect = editorRef.current.getBoundingClientRect();

        setActiveGap({
            nodes: gapNodesList,
            topY: firstRect.top,
            bottomY: lastRect.bottom,
            left: editorRect.left - 40
        });
    };

    useEffect(() => {
        const handleUpdate = () => requestAnimationFrame(detectGap);
        const handleMouseDown = () => { isMouseDownRef.current = true; handleUpdate(); };
        const handleMouseUp = () => { isMouseDownRef.current = false; handleUpdate(); };

        document.addEventListener('selectionchange', handleUpdate);
        window.addEventListener('resize', handleUpdate);
        window.addEventListener('scroll', handleUpdate, true);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);

        const observer = new MutationObserver(handleUpdate);
        if (editorRef.current) {
            observer.observe(editorRef.current, { childList: true, subtree: true, characterData: true });
        }

        return () => {
            document.removeEventListener('selectionchange', handleUpdate);
            window.removeEventListener('resize', handleUpdate);
            window.removeEventListener('scroll', handleUpdate, true);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            observer.disconnect();
        };
    }, [editorRef]);

    useEffect(() => {
        if (!dragging || !activeGap || !editorRef.current) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaY = e.clientY - dragging.startY;

            const sample = editorRef.current?.querySelector('p, div');
            const lineHeight = sample ? sample.getBoundingClientRect().height : 24;

            let deltaLines = Math.round(deltaY / lineHeight);
            if (dragging.handle === 'top') deltaLines = -deltaLines;

            if (deltaLines === 0) return;

            const currentCount = activeGap.nodes.length;
            const targetCount = Math.max(1, currentCount + deltaLines);
            if (targetCount === currentCount) return;

            // DETERMINE CORRECT PARENT AND REFERENCE FOR INSERTION based on drag handle
            // This is crucial if gaps span multiple containers
            let parent: HTMLElement | null = null;
            let referenceNode: Node | null = null;

            if (dragging.handle === 'top') {
                // Add/Remove from TOP
                const topNode = activeGap.nodes[0];
                parent = topNode.parentElement;
                referenceNode = topNode;
            } else {
                // Add/Remove from BOTTOM
                const bottomNode = activeGap.nodes[activeGap.nodes.length - 1];
                parent = bottomNode.parentElement;
                referenceNode = bottomNode.nextSibling; // Can be null (append)
            }

            if (!parent) return;

            if (targetCount > currentCount) {
                // Add more spacing lines
                const toAdd = targetCount - currentCount;
                for (let i = 0; i < toAdd; i++) {
                    const el = document.createElement('p');
                    el.innerHTML = '<br>';
                    parent.insertBefore(el, referenceNode); // Insert at the correct boundary
                }
            } else {
                // Remove spacing lines (keeping at least 1)
                const toRemove = currentCount - targetCount;
                // For removal, we always remove from the "dragging" end to feel natural
                if (dragging.handle === 'top') {
                    for (let i = 0; i < toRemove && activeGap.nodes.length > 1; i++) {
                        const node = activeGap.nodes.shift();
                        node?.remove();
                    }
                } else {
                    for (let i = 0; i < toRemove && activeGap.nodes.length > 1; i++) {
                        const node = activeGap.nodes.pop();
                        node?.remove();
                    }
                }
            }

            // Update state physically (visual update happens via mutation observer/RA)
            setDragging({
                ...dragging,
                startY: e.clientY,
                initialHeight: targetCount * lineHeight
            });
        };

        const handleMouseUp = () => setDragging(null);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragging, activeGap, editorRef]);

    if (!activeGap) return null;

    const h = 6;

    return (
        <>
            {/* Visual Track */}
            <div style={{
                position: 'fixed',
                top: `${activeGap.topY}px`,
                left: `${activeGap.left + 15.5}px`,
                width: '1px',
                height: `${activeGap.bottomY - activeGap.topY}px`,
                backgroundColor: '#e0e0e0',
                zIndex: 9999,
                pointerEvents: 'none'
            }} />

            {/* Top Drag Handle */}
            <div
                style={{
                    position: 'fixed',
                    top: `${activeGap.topY - h / 2}px`,
                    left: `${activeGap.left}px`,
                    width: '32px',
                    height: `${h}px`,
                    cursor: 'ns-resize',
                    zIndex: 10000,
                    backgroundColor: dragging?.handle === 'top' ? '#444' : '#e0e0e0',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.8,
                    transition: 'opacity 0.2s, background-color 0.2s',
                }}
                onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setDragging({ handle: 'top', startY: e.clientY, initialHeight: activeGap.bottomY - activeGap.topY });
                }}
            >
                <div style={{ width: '12px', height: '1px', backgroundColor: dragging?.handle === 'top' ? '#fff' : '#888' }} />
            </div>

            {/* Bottom Drag Handle */}
            <div
                style={{
                    position: 'fixed',
                    top: `${activeGap.bottomY - h / 2}px`,
                    left: `${activeGap.left}px`,
                    width: '32px',
                    height: `${h}px`,
                    cursor: 'ns-resize',
                    zIndex: 10000,
                    backgroundColor: dragging?.handle === 'bottom' ? '#444' : '#e0e0e0',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.8,
                    transition: 'opacity 0.2s, background-color 0.2s',
                }}
                onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setDragging({ handle: 'bottom', startY: e.clientY, initialHeight: activeGap.bottomY - activeGap.topY });
                }}
            >
                <div style={{ width: '12px', height: '1px', backgroundColor: dragging?.handle === 'bottom' ? '#fff' : '#888' }} />
            </div>

            {/* Line Counter */}
            <div
                style={{
                    position: 'fixed',
                    top: `${(activeGap.topY + activeGap.bottomY) / 2}px`,
                    left: `${activeGap.left - 28}px`,
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    fontWeight: '500',
                    color: '#666',
                    fontFamily: 'system-ui',
                    backgroundColor: 'white',
                    height: '20px',
                    padding: '0 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '10px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    pointerEvents: 'none',
                    zIndex: 10001,
                }}
            >
                {activeGap.nodes.length}
            </div>
        </>
    );
}
