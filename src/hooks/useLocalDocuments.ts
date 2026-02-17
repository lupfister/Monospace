import { useCallback, useEffect, useState } from 'react';
import { createLocalDocument, loadDocuments, persistDocuments, LocalDocument } from '../lib/localDocuments';

const sortDocuments = (documents: LocalDocument[]) =>
  [...documents].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

export const useLocalDocuments = () => {
  const [documents, setDocuments] = useState<LocalDocument[]>(() => sortDocuments(loadDocuments()));

  useEffect(() => {
    persistDocuments(documents);
  }, [documents]);

  const createDocument = useCallback(() => {
    const doc = createLocalDocument();
    setDocuments((prev) => sortDocuments([doc, ...prev]));
    return doc;
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<LocalDocument>) => {
    setDocuments((prev) => {
      const next = prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc));
      return sortDocuments(next);
    });
  }, []);

  return { documents, createDocument, updateDocument };
};
