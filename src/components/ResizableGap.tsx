import { useState, useRef } from 'react';
import { GripVertical } from 'lucide-react';

interface ResizableGapProps {
  initialHeight: number;
  onDelete: () => void;
  onResize?: (newHeight: number) => void;
}

export function ResizableGap({ initialHeight, onDelete, onResize }: ResizableGapProps) {
  const [height, setHeight] = useState(initialHeight);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startY.current = e.clientY;
    startHeight.current = height;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY.current;
      const newHeight = Math.max(8, startHeight.current + delta);
      setHeight(newHeight);
      if (onResize) {
        onResize(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      className="relative group"
      style={{ height: `${height}px` }}
      contentEditable={false}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Resize handle */}
      <div
        className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-row-resize transition-opacity z-10 ${
          isHovered || isResizing ? 'opacity-100' : 'opacity-0'
        }`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1 bg-gray-200 px-2 py-1 rounded text-xs text-gray-600">
          <GripVertical className="w-3 h-3" />
          <span>{Math.round(height)}px</span>
        </div>
      </div>
      
      {/* Visual indicator line */}
      <div
        className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px transition-opacity ${
          isHovered || isResizing ? 'opacity-20 bg-gray-400' : 'opacity-0'
        }`}
      />
    </div>
  );
}