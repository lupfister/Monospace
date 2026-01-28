import { useEffect, useRef, useState } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  List,
  ListOrdered,
  MoveHorizontal,
  Sparkles,
  Loader2
} from 'lucide-react';
import { MarginText } from './MarginText';
import Vector59 from '../imports/Vector59';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { generateWithGemini, type GeminiAction } from '../lib/gemini';

export function DocumentEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedContent, setDraggedContent] = useState('');
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [dropCursorPos, setDropCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [dragElementPos, setDragElementPos] = useState<{ x: number; y: number } | null>(null);
  const draggedFragment = useRef<DocumentFragment | null>(null);
  const [marginTexts, setMarginTexts] = useState<{
    id: string;
    content: string;
    htmlContent: string;
    x: number;
    y: number;
  }[]>([]);
  const [dragTarget, setDragTarget] = useState<'editor' | 'left-margin' | 'right-margin' | null>(null);
  const [marginWidth, setMarginWidth] = useState(256);
  const [marginSide, setMarginSide] = useState<'left' | 'right' | null>(null);
  const [isResizingMargin, setIsResizingMargin] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [additionalSelections, setAdditionalSelections] = useState<Range[]>([]);
  const [isShiftSelecting, setIsShiftSelecting] = useState(false);
  const shiftSelectStart = useRef<{ x: number; y: number } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const savedSelection = useRef<Range | null>(null);

  // Auto-set margin side when there are texts
  useEffect(() => {
    if (marginTexts.length > 0 && marginSide === null) {
      // Determine side based on first text position or default to left
      setMarginSide('left');
    } else if (marginTexts.length === 0) {
      setMarginSide(null);
    }
  }, [marginTexts, marginSide]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      // Escape - Clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        return;
      }

      // Bold - Ctrl/Cmd + B
      if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
      }
      
      // Italic - Ctrl/Cmd + I
      if (ctrlKey && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
      }
      
      // Underline - Ctrl/Cmd + U
      if (ctrlKey && e.key === 'u') {
        e.preventDefault();
        document.execCommand('underline');
      }
      
      // Save - Ctrl/Cmd + S
      if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      
      // Undo - Ctrl/Cmd + Z
      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('undo');
      }
      
      // Redo - Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z
      if ((ctrlKey && e.key === 'y') || (ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        document.execCommand('redo');
      }

      // Show shortcuts - Ctrl/Cmd + /
      if (ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleAiAction = async (action: GeminiAction) => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const selectedText = (selection.toString() ?? '').trim();

    if (!selectedText) {
      setAiError('Select some text first.');
      return;
    }

    setAiError(null);
    setAiLoading(true);
    savedSelection.current = range;

    const result = await generateWithGemini(action, selectedText);
    setAiLoading(false);

    if (!result.ok) {
      setAiError(result.error);
      return;
    }

    const r = savedSelection.current;
    const editor = editorRef.current;
    if (r && editor.contains(r.startContainer)) {
      try {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(r);
          r.deleteContents();
          r.insertNode(document.createTextNode(result.text));
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } catch {
        setAiError('Could not replace selection. Result: ' + result.text.slice(0, 80));
      }
    } else {
      setAiError('Selection changed. Result: ' + result.text.slice(0, 120));
    }
    editorRef.current?.focus();
  };

  const handleSave = () => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML;
      localStorage.setItem('documentContent', content);
      
      // Show save notification
      const notification = document.createElement('div');
      notification.textContent = 'Document saved!';
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    }
  };

  // Load saved content on mount
  useEffect(() => {
    const savedContent = localStorage.getItem('documentContent');
    if (savedContent && editorRef.current) {
      editorRef.current.innerHTML = savedContent;
    }
  }, []);

  const isClickInSelection = (x: number, y: number): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    
    const range = selection.getRangeAt(0);
    if (range.collapsed) return false;
    
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true;
      }
    }
    return false;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    
    // Handle shift+click/drag for multi-selection
    if (e.shiftKey && selection && !selection.isCollapsed) {
      e.preventDefault();
      
      // Save the current selection as an additional selection
      const currentRange = selection.getRangeAt(0).cloneRange();
      setAdditionalSelections(prev => [...prev, currentRange]);
      
      // Start a new selection
      setIsShiftSelecting(true);
      shiftSelectStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    // Check if clicking inside existing selection (for drag and drop)
    if (selection && !selection.isCollapsed && isClickInSelection(e.clientX, e.clientY) && !e.shiftKey) {
      e.preventDefault();
      
      // Combine all selections (main + additional) for dragging
      const mainRange = selection.getRangeAt(0);
      const allRanges = [mainRange, ...additionalSelections];
      
      // Create a combined fragment
      const combinedFragment = document.createDocumentFragment();
      let combinedText = '';
      
      allRanges.forEach((range, index) => {
        const clonedContents = range.cloneContents();
        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.ELEMENT_NODE 
          ? container as HTMLElement 
          : container.parentElement;
        
        if (element) {
          const computedStyle = window.getComputedStyle(element);
          const wrapper = document.createElement('span');
          wrapper.style.fontFamily = computedStyle.fontFamily;
          wrapper.style.fontSize = computedStyle.fontSize;
          wrapper.style.fontWeight = computedStyle.fontWeight;
          wrapper.style.fontStyle = computedStyle.fontStyle;
          wrapper.style.color = computedStyle.color;
          wrapper.style.textDecoration = computedStyle.textDecoration;
          wrapper.style.lineHeight = computedStyle.lineHeight;
          wrapper.appendChild(clonedContents);
          combinedFragment.appendChild(wrapper);
        } else {
          combinedFragment.appendChild(clonedContents);
        }
        
        combinedText += range.toString();
        if (index < allRanges.length - 1) {
          combinedText += ' ';
        }
      });
      
      savedRange.current = mainRange.cloneRange();
      draggedFragment.current = combinedFragment;
      setDraggedContent(combinedText);
      setIsDragging(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
    } else if (!e.shiftKey) {
      // Clear additional selections if not shift-clicking
      setAdditionalSelections([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && dragStartPos.current) {
      // Check if Alt/Option key is pressed for duplication
      setIsDuplicating(e.altKey);
      
      // Check if moved enough to start drag
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        document.body.style.cursor = 'grabbing';
        
        // Update dragged element position
        setDragElementPos({ x: e.clientX, y: e.clientY });
        
        // Determine drop target
        if (editorRef.current && containerRef.current) {
          const editorRect = editorRef.current.getBoundingClientRect();
          
          if (e.clientX < editorRect.left) {
            setDragTarget('left-margin');
            setDropCursorPos(null);
          } else if (e.clientX > editorRect.right) {
            setDragTarget('right-margin');
            setDropCursorPos(null);
          } else if (e.clientX >= editorRect.left && e.clientX <= editorRect.right) {
            setDragTarget('editor');
            
            // Get all actual line positions from the editor content
            const lines: { top: number; bottom: number; left: number }[] = [];
            
            // Walk through block-level elements and get all line boxes within them
            const blockElements = editorRef.current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li');
            
            blockElements.forEach((element) => {
              const range = document.createRange();
              
              // Select the entire content of the block element
              range.selectNodeContents(element);
              
              // Get all client rects - each rect represents a visual line
              const rects = range.getClientRects();
              
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                if (rect.height > 0 && rect.width > 0) {
                  lines.push({
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left
                  });
                }
              }
            });
            
            // Also handle any text nodes that aren't in block elements
            const walker = document.createTreeWalker(
              editorRef.current,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  // Only accept text nodes that are direct children or not in a block element
                  const parent = node.parentElement;
                  if (!parent) return NodeFilter.FILTER_REJECT;
                  
                  const isInBlock = parent.closest('p, h1, h2, h3, h4, h5, h6, div, li');
                  return !isInBlock ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
              }
            );
            
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent?.trim()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();
                
                for (let i = 0; i < rects.length; i++) {
                  const rect = rects[i];
                  if (rect.height > 0 && rect.width > 0) {
                    lines.push({
                      top: rect.top,
                      bottom: rect.bottom,
                      left: rect.left
                    });
                  }
                }
              }
            }
            
            // Sort lines by top position
            lines.sort((a, b) => a.top - b.top);
            
            // Find the appropriate line to snap to
            let targetLine = null;
            
            // First, check if we're within any line's vertical bounds
            for (const line of lines) {
              if (e.clientY >= line.top && e.clientY <= line.bottom) {
                targetLine = line;
                break;
              }
            }
            
            // If not within any line, find which line we're between
            if (!targetLine) {
              for (let i = 0; i < lines.length - 1; i++) {
                const currentLine = lines[i];
                const nextLine = lines[i + 1];
                
                // Check if we're in the gap between these two lines
                if (e.clientY > currentLine.bottom && e.clientY < nextLine.top) {
                  // Use the midpoint of the gap to decide which line to snap to
                  const gapMidpoint = (currentLine.bottom + nextLine.top) / 2;
                  targetLine = e.clientY < gapMidpoint ? currentLine : nextLine;
                  break;
                }
              }
            }
            
            // If we're below all content or no lines found, calculate virtual line positions
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
            const editorTop = editorRect.top;
            
            if (!targetLine || (lastLine && e.clientY > lastLine.bottom + 10)) {
              // We're below content - create virtual lines
              const startY = lastLine ? lastLine.bottom : editorTop;
              const avgLineHeight = lastLine ? (lastLine.bottom - lastLine.top) : 28;
              
              // Calculate which virtual line we're on
              const relativeY = e.clientY - startY;
              const virtualLineIndex = Math.round(relativeY / avgLineHeight);
              const snappedY = startY + (virtualLineIndex * avgLineHeight);
              
              setDropCursorPos({ 
                x: e.clientX,
                y: snappedY 
              });
            } else if (targetLine) {
              // Snap to the target line
              setDropCursorPos({ 
                x: e.clientX,
                y: targetLine.top
              });
            }
          }
        }
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging && savedRange.current && draggedFragment.current) {
      e.preventDefault();
      
      if (dragTarget === 'left-margin' || dragTarget === 'right-margin') {
        // Add to margin
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const id = `margin-text-${Date.now()}-${Math.random()}`;
          const content = draggedContent;
          
          // Create a temporary container to get HTML
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(draggedFragment.current.cloneNode(true));
          const htmlContent = tempDiv.innerHTML;
          
          // Determine the new margin side
          const newSide = dragTarget === 'left-margin' ? 'left' : 'right';
          
          // Calculate position relative to the container
          let marginX = 0;
          let marginY = e.clientY - containerRect.top;
          
          if (newSide === 'left') {
            marginX = e.clientX - containerRect.left;
          } else {
            const editorRect = editorRef.current?.getBoundingClientRect();
            if (editorRect) {
              marginX = e.clientX - editorRect.right - 1;
            }
          }
          
          // Don't delete from editor - just copy to margin
          // savedRange.current.deleteContents();
          
          // Set the margin side and add the text
          setMarginSide(newSide);
          setMarginTexts(prev => [
            ...prev,
            {
              id,
              content,
              htmlContent,
              x: marginX,
              y: marginY
            }
          ]);
          
          // Clear selection
          window.getSelection()?.removeAllRanges();
        }
      } else {
        // Normal editor drop
        if (editorRef.current && draggedFragment.current && dropCursorPos) {
          // Only delete old selection if NOT duplicating
          if (!isDuplicating) {
            // Delete the content and normalize spaces
            const rangeToDelete = savedRange.current;
            
            // Check for spaces before and after the selection
            const beforeRange = document.createRange();
            beforeRange.setStart(rangeToDelete.startContainer, Math.max(0, rangeToDelete.startOffset - 1));
            beforeRange.setEnd(rangeToDelete.startContainer, rangeToDelete.startOffset);
            const charBefore = beforeRange.toString();
            
            const afterRange = document.createRange();
            const endContainer = rangeToDelete.endContainer;
            const maxOffset = endContainer.nodeType === Node.TEXT_NODE 
              ? (endContainer.textContent?.length || 0) 
              : endContainer.childNodes.length;
            afterRange.setStart(rangeToDelete.endContainer, rangeToDelete.endOffset);
            afterRange.setEnd(rangeToDelete.endContainer, Math.min(maxOffset, rangeToDelete.endOffset + 1));
            const charAfter = afterRange.toString();
            
            const hasSpaceBefore = /\s/.test(charBefore);
            const hasSpaceAfter = /\s/.test(charAfter);
            
            // Delete the selection
            rangeToDelete.deleteContents();
            
            // If there were spaces on both sides, normalize to a single space
            if (hasSpaceBefore && hasSpaceAfter) {
              // Delete one of the spaces
              const normalizeRange = document.createRange();
              const container = rangeToDelete.startContainer;
              const offset = rangeToDelete.startOffset;
              
              if (container.nodeType === Node.TEXT_NODE && container.textContent) {
                // Check if there are multiple spaces and reduce to one
                const text = container.textContent;
                const beforeText = text.substring(0, offset);
                const afterText = text.substring(offset);
                
                const trimmedBefore = beforeText.replace(/\s+$/, ' ');
                const trimmedAfter = afterText.replace(/^\s+/, '');
                
                if (beforeText !== trimmedBefore || afterText !== trimmedAfter) {
                  const newText = trimmedBefore + trimmedAfter;
                  container.textContent = newText;
                }
              }
            }
          }
          
          // Get all actual line positions to determine how many lines below we're dropping
          const lines: { top: number; bottom: number }[] = [];
          const walker = document.createTreeWalker(
            editorRef.current,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            null
          );
          
          const seenLines = new Set<number>();
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              const rects = range.getClientRects();
              
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                const lineKey = Math.round(rect.top);
                if (!seenLines.has(lineKey)) {
                  seenLines.add(lineKey);
                  lines.push({
                    top: rect.top,
                    bottom: rect.bottom
                  });
                }
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.matches && element.matches('h1, h2, h3, h4, h5, h6, p, div, li')) {
                const rect = element.getBoundingClientRect();
                if (rect.height > 0) {
                  const lineKey = Math.round(rect.top);
                  if (!seenLines.has(lineKey)) {
                    seenLines.add(lineKey);
                    lines.push({
                      top: rect.top,
                      bottom: rect.bottom
                    });
                  }
                }
              }
            }
          }
          
          lines.sort((a, b) => a.top - b.top);
          const lastLine = lines[lines.length - 1];
          
          // Check if we're dropping below the last line
          const isBelowContent = lastLine && dropCursorPos.y > lastLine.bottom + 10;
          
          if (isBelowContent) {
            // Calculate how many lines below we're dropping
            const avgLineHeight = lastLine.bottom - lastLine.top;
            const distanceBelow = dropCursorPos.y - lastLine.bottom;
            const linesBelow = Math.round(distanceBelow / avgLineHeight);
            
            // Create a range at the end of the editor
            const range = document.createRange();
            const lastChild = editorRef.current.lastChild;
            
            if (lastChild) {
              if (lastChild.nodeType === Node.TEXT_NODE) {
                range.setStart(lastChild, lastChild.textContent?.length || 0);
              } else {
                range.setStartAfter(lastChild);
              }
            } else {
              range.setStart(editorRef.current, 0);
            }
            range.collapse(true);
            
            // Insert line breaks to create the gap
            for (let i = 0; i < linesBelow; i++) {
              const br = document.createElement('br');
              range.insertNode(br);
              range.setStartAfter(br);
            }
            
            // Clone the fragment to insert
            const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
            const wrapper = document.createDocumentFragment();
            const nodesToInsert: Node[] = [];
            
            while (fragmentToInsert.firstChild) {
              nodesToInsert.push(fragmentToInsert.firstChild);
              fragmentToInsert.removeChild(fragmentToInsert.firstChild);
            }
            
            nodesToInsert.forEach(node => {
              wrapper.appendChild(node);
            });
            
            // Insert at the end
            range.insertNode(wrapper);
          } else {
            // Normal drop within existing content
            let range = document.caretRangeFromPoint(e.clientX, e.clientY);
            
            if (range && editorRef.current && draggedFragment.current) {
              // Check if we need to add spaces around the dropped content
              const container = range.startContainer;
              const offset = range.startOffset;
              
              // Check the character before the drop position
              let charBefore = '';
              if (container.nodeType === Node.TEXT_NODE && offset > 0) {
                charBefore = container.textContent?.charAt(offset - 1) || '';
              } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
                const prevNode = container.childNodes[offset - 1];
                if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
                  charBefore = prevNode.textContent?.charAt(prevNode.textContent.length - 1) || '';
                }
              }
              
              // Check the character after the drop position
              let charAfter = '';
              if (container.nodeType === Node.TEXT_NODE && container.textContent) {
                charAfter = container.textContent.charAt(offset) || '';
              } else if (container.nodeType === Node.ELEMENT_NODE) {
                const nextNode = container.childNodes[offset];
                if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
                  charAfter = nextNode.textContent?.charAt(0) || '';
                }
              }
              
              const needsSpaceBefore = charBefore && !/\s/.test(charBefore);
              const needsSpaceAfter = charAfter && !/\s/.test(charAfter);
              
              // Check if the dragged content has spaces at its edges
              const draggedText = draggedContent.trim();
              const hasLeadingSpace = draggedContent.startsWith(' ') || draggedContent.startsWith('\n');
              const hasTrailingSpace = draggedContent.endsWith(' ') || draggedContent.endsWith('\n');
              
              // Clone the fragment to insert
              const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
              const wrapper = document.createDocumentFragment();
              
              // Add leading space if needed
              if (needsSpaceBefore && !hasLeadingSpace) {
                wrapper.appendChild(document.createTextNode(' '));
              }
              
              // Add the dragged content
              const nodesToInsert: Node[] = [];
              while (fragmentToInsert.firstChild) {
                nodesToInsert.push(fragmentToInsert.firstChild);
                fragmentToInsert.removeChild(fragmentToInsert.firstChild);
              }
              
              nodesToInsert.forEach(node => {
                wrapper.appendChild(node);
              });
              
              // Add trailing space if needed
              if (needsSpaceAfter && !hasTrailingSpace) {
                wrapper.appendChild(document.createTextNode(' '));
              }
              
              // Insert at the drop position
              range.insertNode(wrapper);
            }
          }
          
          // Clear selection
          window.getSelection()?.removeAllRanges();
        }
      }
      
      // Reset state
      document.body.style.cursor = '';
      setIsDragging(false);
      setDraggedContent('');
      savedRange.current = null;
      dragStartPos.current = null;
      setDropCursorPos(null);
      setDragElementPos(null);
      draggedFragment.current = null;
      setDragTarget(null);
      setAdditionalSelections([]);
      setIsShiftSelecting(false);
      shiftSelectStart.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // If clicking outside selection (and not dragging), allow normal behavior
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && !isClickInSelection(e.clientX, e.clientY)) {
      // Let the browser handle deselection naturally
    }
  };

  const handleMarginTextPositionChange = (id: string, x: number, y: number) => {
    setMarginTexts(prev => prev.map(m => m.id === id ? { ...m, x, y } : m));
  };

  const handleMarginTextDelete = (id: string) => {
    setMarginTexts(prev => prev.filter(m => m.id !== id));
  };

  const handleMarginTextContentChange = (id: string, htmlContent: string) => {
    setMarginTexts(prev => prev.map(m => m.id === id ? { ...m, htmlContent } : m));
  };

  const handleMarginTextExpand = (id: string) => {
    const marginText = marginTexts.find(m => m.id === id);
    if (!marginText || !editorRef.current) return;
    
    // Set the editor content to the margin text's HTML content
    editorRef.current.innerHTML = marginText.htmlContent;
    
    // Remove the margin text from the margin
    setMarginTexts(prev => prev.filter(m => m.id !== id));
    
    // Focus the editor
    editorRef.current.focus();
  };

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingMargin(true);
    const startX = e.clientX;
    const startWidth = marginWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = marginSide === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const newWidth = Math.max(100, Math.min(600, startWidth + delta));
      setMarginWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingMargin(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleSwitchMarginSide = () => {
    if (marginSide) {
      setMarginSide(marginSide === 'left' ? 'right' : 'left');
    }
  };

  const hasMarginContent = marginTexts.length > 0;

  const shortcuts = [
    { keys: 'Ctrl/Cmd + B', action: 'Bold' },
    { keys: 'Ctrl/Cmd + I', action: 'Italic' },
    { keys: 'Ctrl/Cmd + U', action: 'Underline' },
    { keys: 'Ctrl/Cmd + Z', action: 'Undo' },
    { keys: 'Ctrl/Cmd + Y', action: 'Redo' },
    { keys: 'Ctrl/Cmd + S', action: 'Save' },
    { keys: 'Ctrl/Cmd + A', action: 'Select All' },
    { keys: 'Ctrl/Cmd + C', action: 'Copy' },
    { keys: 'Ctrl/Cmd + V', action: 'Paste' },
    { keys: 'Ctrl/Cmd + X', action: 'Cut' },
    { keys: 'Ctrl/Cmd + /', action: 'Show/Hide Shortcuts' },
    { keys: 'Escape', action: 'Clear Selection' },
  ];

  return (
    <div className="w-full min-h-screen">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-2 py-2">
        <div className="w-full mx-auto flex gap-0.5 items-center text-gray-400">
          {/* Text formatting */}
          <button
            onClick={() => handleFormat('bold')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Bold (Ctrl/Cmd+B)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFormat('italic')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Italic (Ctrl/Cmd+I)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFormat('underline')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Underline (Ctrl/Cmd+U)"
          >
            <Underline className="w-4 h-4" />
          </button>

          <div className="w-3" />

          {/* Lists */}
          <button
            onClick={() => handleFormat('insertUnorderedList')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Bullet List"
          >
            <List className="w-4 h-4" style={{ transform: 'scale(1.1)' }} />
          </button>
          <button
            onClick={() => handleFormat('insertOrderedList')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" style={{ transform: 'scale(1.1)' }} />
          </button>

          <div className="w-3" />

          {/* AI actions — Gemini (low-cost model) */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1.5 hover:text-gray-700 transition-colors disabled:opacity-50"
                title="AI: Summarize, improve, or expand selection"
                disabled={aiLoading}
                aria-label="AI actions"
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="w-4 h-4" aria-hidden />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2">
              <p className="text-xs text-gray-500 mb-2 px-1">Select text, then:</p>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('summarize')}
                  disabled={aiLoading}
                >
                  Summarize
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('improve')}
                  disabled={aiLoading}
                >
                  Improve writing
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('expand')}
                  disabled={aiLoading}
                >
                  Expand
                </button>
              </div>
              {aiError && (
                <p className="text-xs text-red-600 mt-2 px-1 break-words" role="alert">
                  {aiError}
                </p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Shortcuts Panel */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {shortcuts.map((shortcut, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-gray-700">{shortcut.action}</span>
                  <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drop Cursor Indicator */}
      {dropCursorPos && dragTarget === 'editor' && (
        <div
          className="fixed w-0.5 h-5 bg-blue-500 pointer-events-none z-50"
          style={{
            left: `${dropCursorPos.x}px`,
            top: `${dropCursorPos.y}px`,
          }}
        />
      )}

      {/* Dragged Text Element */}
      {dragElementPos && draggedContent && (
        <div
          className={`fixed pointer-events-none z-50 text-white px-2 py-1 rounded text-sm max-w-xs truncate shadow-lg ${
            isDuplicating ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{
            left: `${dragElementPos.x + 10}px`,
            top: `${dragElementPos.y + 10}px`,
          }}
        >
          {isDuplicating && <span className="mr-1">+</span>}
          {draggedContent}
        </div>
      )}

      {/* Additional Selection Highlights */}
      {additionalSelections.map((range, index) => {
        const rects = range.getClientRects();
        return Array.from(rects).map((rect, rectIndex) => (
          <div
            key={`${index}-${rectIndex}`}
            className="fixed pointer-events-none bg-blue-200/40 z-40"
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            }}
          />
        ));
      })}

      {/* Main Container */}
      <div
        ref={containerRef}
        className="relative max-w-7xl mx-auto flex overflow-hidden"
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {/* Left Margin (only when marginSide === 'left') */}
        {marginSide === 'left' && (
          <>
            <div 
              className="relative flex-shrink-0 overflow-hidden" 
              style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}
            >
              {/* Switch Handle */}
              <button
                onClick={handleSwitchMarginSide}
                className="absolute top-2 right-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200"
                title="Switch to right margin"
              >
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>

              {/* Margin Content */}
              {marginTexts.map(m => (
                <MarginText
                  key={m.id}
                  id={m.id}
                  content={m.content}
                  htmlContent={m.htmlContent}
                  x={m.x}
                  y={m.y}
                  onPositionChange={handleMarginTextPositionChange}
                  onDelete={() => handleMarginTextDelete(m.id)}
                  onContentChange={handleMarginTextContentChange}
                  onExpand={() => handleMarginTextExpand(m.id)}
                />
              ))}
            </div>

            {/* Left Divider */}
            {hasMarginContent && (
              <div 
                className="relative flex-shrink-0 group"
                onMouseDown={handleDividerMouseDown}
              >
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <Vector59 />
                </div>
              </div>
            )}
          </>
        )}

        {/* Editor */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-screen bg-white p-8 focus:outline-none prose prose-lg max-w-3xl mx-auto font-normal"
            spellCheck
            onMouseDown={handleMouseDown}
            onClick={handleClick}
          >
            <h1 className="font-['Georgia',serif]">Doc (computing)</h1>
            <p className="text-[#6e6e6e]">
              .doc (an abbreviation of "document") is a filename extension used for word processing documents stored on Microsoft's proprietary Microsoft Word Binary File Format; it was the primary format for Microsoft Word until the 2007 version replaced it with OfficeOpen XML .docx files.[4] Microsoft has used the extension since 1983.
            </p>
            <p>&nbsp;</p>
            <h1 className="font-['Georgia',serif]">Glossary</h1>
            <p className="text-[#6e6e6e]">
              word processing documents: digital files used to create, edit, and format text.
            </p>
          </div>
        </div>

        {/* Right Margin (only when marginSide === 'right') */}
        {marginSide === 'right' && (
          <>
            {/* Right Divider */}
            {hasMarginContent && (
              <div 
                className="relative flex-shrink-0 group"
                onMouseDown={handleDividerMouseDown}
              >
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <Vector59 />
                </div>
              </div>
            )}

            <div 
              className="relative flex-shrink-0 overflow-hidden" 
              style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}
            >
              {/* Switch Handle */}
              <button
                onClick={handleSwitchMarginSide}
                className="absolute top-2 left-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200"
                title="Switch to left margin"
              >
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>

              {/* Margin Content */}
              {marginTexts.map(m => (
                <MarginText
                  key={m.id}
                  id={m.id}
                  content={m.content}
                  htmlContent={m.htmlContent}
                  x={m.x}
                  y={m.y}
                  onPositionChange={handleMarginTextPositionChange}
                  onDelete={() => handleMarginTextDelete(m.id)}
                  onContentChange={handleMarginTextContentChange}
                  onExpand={() => handleMarginTextExpand(m.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}