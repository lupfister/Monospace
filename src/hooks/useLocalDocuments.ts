import { useCallback, useEffect, useState } from 'react';
import { createLocalDocument, loadDocuments, persistDocuments, LocalDocument } from '../lib/localDocuments';

const sortDocuments = (documents: LocalDocument[]) =>
  [...documents].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

export const useLocalDocuments = () => {
  const [documents, setDocuments] = useState<LocalDocument[]>(() => sortDocuments(loadDocuments()));

  useEffect(() => {
    persistDocuments(documents);
  }, [documents]);

  const createDocument = useCallback((content: string = '') => {
    const doc = createLocalDocument(content);
    setDocuments((prev) => sortDocuments([doc, ...prev]));
    return doc;
  }, []);

  const insertDocument = useCallback((doc: LocalDocument) => {
    setDocuments((prev) => {
      const exists = prev.some((item) => item.id === doc.id);
      if (exists) {
        const next = prev.map((item) => (item.id === doc.id ? { ...item, ...doc } : item));
        return sortDocuments(next);
      }
      return sortDocuments([doc, ...prev]);
    });
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<LocalDocument>) => {
    setDocuments((prev) => {
      const next = prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc));
      return sortDocuments(next);
    });
  }, []);

  const deleteDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }, []);

  return { documents, createDocument, insertDocument, updateDocument, deleteDocument };
};
