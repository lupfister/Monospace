import React from 'react';
import { createRoot } from 'react-dom/client';

interface VisualExperienceProps {
    code: string;
    description?: string;
}

export const VisualExperience: React.FC<VisualExperienceProps> = ({ code, description }) => {
    // Construct the full HTML document string
    // We inject basic styles to ensure the visualization looks good in the sandboxed frame
    const srcDoc = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    margin: 0; 
                    padding: 0; 
                    font-family: system-ui, sans-serif; 
                    overflow: hidden; 
                    background: transparent;
                    width: 100%;
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                * { box-sizing: border-box; }
                /* Ensure canvas or other elements take up space */
                canvas, svg { display: block; max-width: 100%; max-height: 100%; }
            </style>
        </head>
        <body>
            ${code}
        </body>
        </html>
    `;

    return (
        <div className="visual-experience-container my-6 rounded-lg overflow-hidden border border-gray-100 bg-gray-50/50 relative">
            {description && (
                <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur text-xs text-gray-500 px-2 py-1 rounded shadow-sm pointer-events-none">
                    {description}
                </div>
            )}

            <iframe
                title="Visual Experience"
                className="w-full h-[400px] border-none block"
                sandbox="allow-scripts"
                loading="lazy"
                srcDoc={srcDoc}
            />
        </div>
    );
};

// Standalone mount function for usage outside of React tree (in vanilla DOM)
export function mountVisualExperience(container: HTMLElement, code: string, description?: string) {
    const root = createRoot(container);
    root.render(<VisualExperience code={code} description={description} />);
    return () => root.unmount();
}
