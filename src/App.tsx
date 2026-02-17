import { useMemo, useState } from 'react';
import { DocumentEditor } from './components/DocumentEditor';
import { useLocalDocuments } from './hooks/useLocalDocuments';

export default function App() {
  const { documents, createDocument, updateDocument } = useLocalDocuments();
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  const handleCreateDocument = () => {
    const doc = createDocument();
    setActiveDocId(doc.id);
  };

  const handleSaveDocument = (docId: string, content: string, title: string) => {
    updateDocument(docId, {
      content,
      title,
      updatedAt: new Date().toISOString(),
    });
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-white min-h-screen">
      {activeDocument ? (
        <DocumentEditor
          key={activeDocument.id}
          doc={activeDocument}
          onSave={handleSaveDocument}
          onBack={() => setActiveDocId(null)}
        />
      ) : (
        <div className="max-w-xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleCreateDocument}
              className="text-sm text-gray-800 hover:text-gray-500 hover:underline underline-offset-4 transition-colors"
            >
              new document
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {documents.length === 0 ? (
              <div className="text-sm text-gray-400">No documents yet.</div>
            ) : (
              documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setActiveDocId(doc.id)}
                  className="w-full text-left"
                >
                  <div className="text-lg text-gray-900 hover:text-gray-500 hover:underline underline-offset-4 transition-colors">
                    {doc.title || 'Untitled'}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(doc.updatedAt)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
