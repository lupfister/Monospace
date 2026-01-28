import React, { useRef, useState } from 'react';
import { createHumanTextSpan, isHumanTextSpan } from '../lib/textStyles';

interface MarginTextProps {
  // Some TS setups treat `key` as a normal prop; allow it to avoid type errors.
  key?: React.Key;
  id: string;
  content: string;
  htmlContent: string;
  x: number;
  y: number;
  onPositionChange: (id: string, x: number, y: number) => void;
  onDelete: () => void;
  onContentChange?: (id: string, htmlContent: string) => void;
  onExpand?: (id: string) => void;
}

export function MarginText({ id, content, htmlContent, x, y, onPositionChange, onDelete, onContentChange, onExpand }: MarginTextProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [position, setPosition] = useState({ x, y });
  const dragStart = useRef({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const clickTimeout = useRef<NodeJS.Timeout | null>(null);
  const clickCount = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't start dragging if we're in edit mode
    if (isEditing) return;
    
    if (e.target === elementRef.current || (e.target as HTMLElement).closest('.margin-text-content')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newX = moveEvent.clientX - dragStart.current.x;
        const newY = moveEvent.clientY - dragStart.current.y;
        setPosition({ x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        onPositionChange(id, position.x, position.y);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      onDelete();
    }
  };

  const handleDoubleClick = () => {
    // If in editing mode, don't expand - just continue editing
    if (isEditing) return;
    
    // Otherwise expand to main editor
    if (onExpand) {
      onExpand(id);
    }
  };

  const handleContentDoubleClick = (e: React.MouseEvent) => {
    // When in edit mode and double-clicking, just select text (default behavior)
    if (isEditing) {
      e.stopPropagation();
      return;
    }
    
    // Otherwise, this is the expand trigger
    handleDoubleClick();
  };

  const handleContentClick = (e: React.MouseEvent) => {
    // If not editing, track clicks to distinguish single vs double
    if (!isEditing) {
      clickCount.current++;
      
      if (clickCount.current === 1) {
        // First click - wait to see if there's a second
        clickTimeout.current = setTimeout(() => {
          // Single click - enter edit mode
          setIsEditing(true);
          clickCount.current = 0;
        }, 250);
      } else if (clickCount.current === 2) {
        // Double click - expand
        if (clickTimeout.current) {
          clearTimeout(clickTimeout.current);
        }
        clickCount.current = 0;
        if (onExpand) {
          onExpand(id);
        }
      }
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (onContentChange && contentRef.current) {
      onContentChange(id, contentRef.current.innerHTML);
    }
  };

  const insertStyledText = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !contentRef.current) return;
    
    const range = selection.getRangeAt(0);
    
    // Delete any selected text first
    if (!range.collapsed) {
      range.deleteContents();
    }
    
    // Check if we're at the end of a styled span and can append to it
    let targetSpan: HTMLElement | null = null;
    let canAppend = false;
    
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const parent = textNode.parentElement;
      
      if (parent && parent.tagName === 'SPAN' && isHumanTextSpan(parent)) {
        // Check if we're at the end of the text node
        const offset = range.startOffset;
        const textLength = textNode.textContent?.length || 0;
        if (offset === textLength) {
          targetSpan = parent;
          canAppend = true;
        }
      }
    }
    
    // If we can append to existing styled span, do that
    if (targetSpan && canAppend) {
      const lastChild = targetSpan.lastChild;
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
        lastChild.textContent = (lastChild.textContent || '') + text;
      } else {
        targetSpan.appendChild(document.createTextNode(text));
      }
      
      // Move cursor after the inserted text
      const newRange = document.createRange();
      newRange.selectNodeContents(targetSpan);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      // Get the computed line-height from the parent
      const parentElement = range.startContainer.nodeType === Node.TEXT_NODE
        ? (range.startContainer as Text).parentElement
        : range.startContainer as HTMLElement;
      let lineHeight = '1'; // Use 1 to minimize line height impact
      
      if (parentElement) {
        const computedStyle = window.getComputedStyle(parentElement);
        const parentLineHeight = computedStyle.lineHeight;
        const parentFontSize = parseFloat(computedStyle.fontSize);
        
        // Calculate line-height that maintains the same total line height
        if (parentLineHeight && parentFontSize && !isNaN(parentFontSize)) {
          const lineHeightPx = parseFloat(parentLineHeight);
          if (!isNaN(lineHeightPx)) {
            // Calculate what line-height we need for 20px font to match parent's total line height
            const targetLineHeightPx = lineHeightPx; // Keep same total line height
            const ourFontSize = 20;
            const calculatedLineHeight = targetLineHeightPx / ourFontSize;
            lineHeight = String(calculatedLineHeight);
          }
        } else if (parentLineHeight && !parentLineHeight.includes('px')) {
          // Unitless - calculate to maintain same total height
          const unitless = parseFloat(parentLineHeight);
          if (!isNaN(unitless) && parentFontSize) {
            const targetLineHeightPx = unitless * parentFontSize;
            const ourFontSize = 20;
            const calculatedLineHeight = targetLineHeightPx / ourFontSize;
            lineHeight = String(calculatedLineHeight);
          } else {
            lineHeight = parentLineHeight;
          }
        }
      }
      
      // Create a new span with human text styling (black Garamond 20pt)
      const span = createHumanTextSpan(text, lineHeight);
      
      // Insert the styled span
      range.insertNode(span);
      
      // Move cursor after the inserted text
      range.setStartAfter(span);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only handle when editing
    if (!isEditing) return;
    
    // Handle printable characters (but not with modifiers)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const isPrintable = e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape';
      if (isPrintable) {
        e.preventDefault();
        e.stopPropagation();
        insertStyledText(e.key);
        return;
      }
    }
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;
    
    // Only handle text insertion events
    if (inputEvent.inputType === 'insertText' || inputEvent.inputType === 'insertCompositionText') {
      const textToInsert = inputEvent.data || '';
      
      if (!textToInsert) return;
      
      // Prevent default insertion
      e.preventDefault();
      
      // Insert with our styled handler
      insertStyledText(textToInsert);
    }
  };


  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !contentRef.current) return;
    
    const range = selection.getRangeAt(0);
    const pastedText = e.clipboardData.getData('text/plain');
    
    if (!pastedText) return;
    
    // Delete any selected text first
    if (!range.collapsed) {
      range.deleteContents();
    }
    
    // Get the computed line-height from the parent
    const parentElement = range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer as Text).parentElement
      : range.startContainer as HTMLElement;
    let lineHeight = '1'; // Use 1 to minimize line height impact
    
    if (parentElement) {
      const computedStyle = window.getComputedStyle(parentElement);
      const parentLineHeight = computedStyle.lineHeight;
      const parentFontSize = parseFloat(computedStyle.fontSize);
      
      // Calculate line-height that maintains the same total line height
      if (parentLineHeight && parentFontSize && !isNaN(parentFontSize)) {
        const lineHeightPx = parseFloat(parentLineHeight);
        if (!isNaN(lineHeightPx)) {
          // Calculate what line-height we need for 20px font to match parent's total line height
          const targetLineHeightPx = lineHeightPx; // Keep same total line height
          const ourFontSize = 20;
          const calculatedLineHeight = targetLineHeightPx / ourFontSize;
          lineHeight = String(calculatedLineHeight);
        }
      } else if (parentLineHeight && !parentLineHeight.includes('px')) {
        // Unitless - calculate to maintain same total height
        const unitless = parseFloat(parentLineHeight);
        if (!isNaN(unitless) && parentFontSize) {
          const targetLineHeightPx = unitless * parentFontSize;
          const ourFontSize = 20;
          const calculatedLineHeight = targetLineHeightPx / ourFontSize;
          lineHeight = String(calculatedLineHeight);
        } else {
          lineHeight = parentLineHeight;
        }
      }
    }
    
    // Create a span with human text styling (black Garamond 20pt) for pasted text
    const span = createHumanTextSpan('', lineHeight);
    
    // Preserve line breaks by converting them to <br> tags
    const lines = pastedText.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        span.appendChild(document.createElement('br'));
      }
      if (line) {
        span.appendChild(document.createTextNode(line));
      }
    });
    
    // Insert the styled span
    range.insertNode(span);
    
    // Move cursor after the pasted content
    range.setStartAfter(span);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  return (
    <div
      ref={elementRef}
      className={`absolute cursor-move ${isDragging ? 'opacity-75' : 'opacity-100'}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div 
        ref={contentRef}
        className="margin-text-content prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        onDoubleClick={handleContentDoubleClick}
        onClick={handleContentClick}
        onBlur={handleBlur}
        onKeyDown={handleContentKeyDown}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
        contentEditable={isEditing}
      />
    </div>
  );
}