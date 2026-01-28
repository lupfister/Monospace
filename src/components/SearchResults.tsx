import { YouTubeVideo, Article, ImageResult } from '../lib/webSearch';
import { ExternalLink, Play, Image as ImageIcon, FileText } from 'lucide-react';

interface SearchResultsProps {
  videos: YouTubeVideo[];
  images: ImageResult[];
  articles: Article[];
  onClose?: () => void;
}

export const SearchResults = ({ videos, images, articles, onClose }: SearchResultsProps) => {
  const hasResults = videos.length > 0 || images.length > 0 || articles.length > 0;

  if (!hasResults) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No results found. Try a different search query.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* YouTube Videos */}
      {videos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Play className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-lg">YouTube Videos</h3>
            <span className="text-sm text-gray-500">({videos.length})</span>
          </div>
          <div className="space-y-3">
            {videos.map((video, index) => (
              <a
                key={index}
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all group"
              >
                <div className="flex gap-3">
                  {video.thumbnail && (
                    <img
                      src={video.thumbnail}
                      alt={video.title}
                      className="w-32 h-24 object-cover rounded flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                      {video.title}
                    </h4>
                    {video.channel && (
                      <p className="text-sm text-gray-500 mt-1">{video.channel}</p>
                    )}
                    {video.snippet && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {video.snippet}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500 truncate">{video.url}</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Articles */}
      {articles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-lg">Articles</h3>
            <span className="text-sm text-gray-500">({articles.length})</span>
          </div>
          <div className="space-y-3">
            {articles.map((article, index) => (
              <a
                key={index}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all group"
              >
                <div className="flex gap-3">
                  {article.thumbnail && (
                    <img
                      src={article.thumbnail}
                      alt={article.title}
                      className="w-24 h-24 object-cover rounded flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                      {article.title}
                    </h4>
                    {article.source && (
                      <p className="text-sm text-gray-500 mt-1">{article.source}</p>
                    )}
                    {article.snippet && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {article.snippet}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500 truncate">{article.url}</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Images */}
      {images.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-lg">Images</h3>
            <span className="text-sm text-gray-500">({images.length})</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {images.map((image, index) => (
              <a
                key={index}
                href={image.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
              >
                <div className="relative aspect-video overflow-hidden rounded-lg border border-gray-200 hover:border-gray-300 transition-all">
                  <img
                    src={image.thumbnail || image.url}
                    alt={image.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
                {image.title && (
                  <p className="text-xs text-gray-600 mt-1 line-clamp-1">{image.title}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
