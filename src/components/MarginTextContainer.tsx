import React from 'react';
import { MarginText } from './MarginText';

export interface MarginTextData {
    id: string;
    content: string;
    htmlContent: string;
    x: number;
    y: number;
}

interface MarginTextContainerProps {
    texts: MarginTextData[];
    onPositionChange: (id: string, x: number, y: number) => void;
    onDelete: (id: string) => void;
    onContentChange: (id: string, htmlContent: string) => void;
    onExpand: (id: string) => void;
}

export function MarginTextContainer({
    texts,
    onPositionChange,
    onDelete,
    onContentChange,
    onExpand
}: MarginTextContainerProps) {
    if (texts.length === 0) return null;

    return (
        <>
            {texts.map((text) => (
                <MarginText
                    key={text.id}
                    id={text.id}
                    content={text.content}
                    htmlContent={text.htmlContent}
                    x={text.x}
                    y={text.y}
                    onPositionChange={onPositionChange}
                    onDelete={() => onDelete(text.id)}
                    onContentChange={onContentChange}
                    onExpand={onExpand}
                />
            ))}
        </>
    );
}
