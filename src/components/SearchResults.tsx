import { YouTubeVideo, Article, ImageResult } from '../lib/webSearch';
import {
  getCitationText,
  getResultSections,
  normalizeSearchResults,
  resultCardClasses,
  type ResultItem,
} from '../lib/searchResultItems';

interface SearchResultsProps {
  videos: YouTubeVideo[];
  images: ImageResult[];
  articles: Article[];
  onClose?: () => void;
}

export const SearchResults = ({ videos, images, articles, onClose }: SearchResultsProps) => {
  const items = normalizeSearchResults({ videos, images, articles });
  const sections = getResultSections(items);
  const hasResults = sections.length > 0;

  const handleLinkKeyDown = (event: React.KeyboardEvent, url: string | undefined) => {
    if (!url) return;
    if (event.key !== ' ') return;
    event.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const ResultCard = ({ item }: { item: ResultItem }) => {
    const citation = getCitationText(item);
    const isLink = Boolean(item.url);
    const Container = isLink ? 'a' : 'div';
    const containerProps = isLink
      ? {
          href: item.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          tabIndex: 0,
          'aria-label': item.title,
          onKeyDown: (event: React.KeyboardEvent) => handleLinkKeyDown(event, item.url),
        }
      : {};

    return (
      <Container
        {...containerProps}
        className={`${resultCardClasses.item} ${isLink ? resultCardClasses.itemInteractive : ''}`}
        data-result-type={item.type}
        data-url={item.url}
      >
        {item.type === 'snippet' && (
          <>
            <div className={resultCardClasses.quote}>{item.snippet}</div>
          </>
        )}

        {item.type === 'image' && (
          <figure className="space-y-2">
            {(item.thumbnail || item.url) && (
              <img
                src={`/api/ai/image?url=${encodeURIComponent(item.thumbnail || item.url || '')}`}
                alt={item.title}
                className={resultCardClasses.image}
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <figcaption className="text-[12px] text-gray-500">
              {item.snippet || item.title}
            </figcaption>
          </figure>
        )}

        {(item.type === 'video' || item.type === 'article') && (
          <div className={resultCardClasses.itemRow}>
            {item.thumbnail && (
              <img
                src={item.thumbnail}
                alt={item.title}
                className={resultCardClasses.thumbnail}
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className={resultCardClasses.itemContent}>
              <p className={resultCardClasses.itemTitle}>{item.title}</p>
              {item.snippet && <p className={resultCardClasses.itemSnippet}>{item.snippet}</p>}
            </div>
          </div>
        )}

        {citation && (
          <div>
            <span className="mt-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600">
              {citation}
            </span>
          </div>
        )}
      </Container>
    );
  };

  if (!hasResults) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No results found. Try a different search query.
      </div>
    );
  }

  const flattenedItems = sections.flatMap((section) => section.items);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-3">
      {flattenedItems.map((item) => (
        <ResultCard key={item.id} item={item} />
      ))}
    </div>
  );
};
