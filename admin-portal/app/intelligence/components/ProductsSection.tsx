'use client';

import { useState } from 'react';
import { useIntelligenceProducts } from '@/lib/hooks/useIntelligence';
import EmptyState from './EmptyState';
import type { TimeRange, Product } from '@/types/intelligence';

interface ProductsSectionProps {
  timeRange: TimeRange;
}

export default function ProductsSection({ timeRange }: ProductsSectionProps) {
  const [sortBy, setSortBy] = useState<'complaints' | 'mentions' | 'sentiment'>('complaints');

  const { data, error, isLoading } = useIntelligenceProducts({
    timeRange,
    sortBy,
    limit: 20,
  });

  if (isLoading) return <TableSkeleton rows={10} />;
  if (error) return <EmptyState variant="error" message={error.message} />;
  if (!data?.products?.length) return <EmptyState message="No product feedback data" />;

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Header with Sort */}
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">
          Product Feedback
        </h3>
        <label className="flex items-center gap-2">
          <span className="sr-only">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="block rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="complaints">Most Complaints</option>
            <option value="mentions">Most Mentions</option>
            <option value="sentiment">Lowest Sentiment</option>
          </select>
        </label>
      </div>

      {/* Products Table - Accessible */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200" role="table">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Product
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Mentions
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Complaints
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Praise
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sentiment
              </th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.products.map((product) => (
              <ProductRow key={product.shopifyProductId} product={product} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: Product }) {
  const sentiment = typeof product.avgSentiment === 'string'
    ? parseFloat(product.avgSentiment)
    : product.avgSentiment;

  return (
    <tr className={`hover:bg-gray-50 ${product.isAnomalous ? 'bg-amber-50' : ''}`}>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {product.isAnomalous && (
            <span title="Anomaly detected" aria-label="Anomaly detected">
              <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
            </span>
          )}
          <span className="text-sm font-medium text-gray-900">
            {product.productTitle}
          </span>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
        {product.totalMentions.toLocaleString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-red-600">
        {product.complaintCount.toLocaleString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-green-600">
        {product.praiseCount.toLocaleString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <SentimentBadge value={sentiment} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-center">
        {product.isAnomalous ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            Anomaly
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Normal
          </span>
        )}
      </td>
    </tr>
  );
}

function SentimentBadge({ value }: { value: number }) {
  const isPositive = value >= 0.6;
  const isNegative = value <= 0.4;

  return (
    <span
      className={`text-sm font-medium ${
        isPositive ? 'text-green-600' :
        isNegative ? 'text-red-600' :
        'text-gray-600'
      }`}
      aria-label={`Sentiment: ${(value * 100).toFixed(0)}% - ${isPositive ? 'positive' : isNegative ? 'negative' : 'neutral'}`}
    >
      {(value * 100).toFixed(0)}%
    </span>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="bg-white shadow rounded-lg animate-pulse" aria-busy="true">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="h-6 w-32 bg-gray-200 rounded" />
      </div>
      <div className="p-6 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded" />
        ))}
      </div>
    </div>
  );
}

function ExclamationTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}
