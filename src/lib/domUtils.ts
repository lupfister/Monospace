import { createAiTextSpan } from './textStyles';

export const createAiTextBlock = (text: string, className?: string): HTMLDivElement => {
    const el = document.createElement('div');
    if (className) el.className = className;
    el.appendChild(createAiTextSpan(text));
    return el;
};
