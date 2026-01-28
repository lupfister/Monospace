import { useRef, useState } from 'react';

interface MarginTextProps {
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
        contentEditable={isEditing}
      />
    </div>
  );
}