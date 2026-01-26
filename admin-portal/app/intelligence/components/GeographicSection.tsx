'use client';

import { useState } from 'react';
import { useIntelligenceGeographic } from '@/lib/hooks/useIntelligence';
import EmptyState from './EmptyState';
import type { TimeRange, Region } from '@/types/intelligence';

interface GeographicSectionProps {
  timeRange: TimeRange;
}

export default function GeographicSection({ timeRange }: GeographicSectionProps) {
  const [geoLevel, setGeoLevel] = useState<'state' | 'city' | 'zip'>('state');
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);

  const { data, error, isLoading } = useIntelligenceGeographic({
    timeRange,
    geoLevel,
    onlyAnomalies: onlyAnomalies ? 'true' : undefined,
  });

  if (isLoading) return <TableSkeleton rows={10} />;
  if (error) return <EmptyState variant="error" message={error.message} />;
  if (!data?.regions?.length) return <EmptyState message="No geographic data available" />;

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Header with Filters */}
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">
          Geographic Patterns
        </h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <span className="sr-only">Group by</span>
            <select
              value={geoLevel}
              onChange={(e) => setGeoLevel(e.target.value as typeof geoLevel)}
              className="block rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="state">By State</option>
              <option value="city">By City</option>
              <option value="zip">By ZIP Prefix</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={onlyAnomalies}
              onChange={(e) => setOnlyAnomalies(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Anomalies only
          </label>
        </div>
      </div>

      {/* Regions Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200" role="table">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {geoLevel === 'state' ? 'State' : geoLevel === 'city' ? 'City' : 'ZIP Prefix'}
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Issues
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Avg Sentiment
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Z-Score
              </th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.regions.map((region, idx) => (
              <RegionRow key={idx} region={region} geoLevel={geoLevel} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegionRow({ region, geoLevel }: { region: Region; geoLevel: string }) {
  const sentiment = typeof region.avgSentiment === 'string'
    ? parseFloat(region.avgSentiment)
    : region.avgSentiment;

  const locationName = geoLevel === 'state' ? region.stateCode
    : geoLevel === 'city' ? region.cityName
    : region.zipPrefix;

  return (
    <tr className={`hover:bg-gray-50 ${region.hasAnomaly ? 'bg-amber-50' : ''}`}>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {locationName || 'Unknown'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
        {region.totalIssues.toLocaleString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <SentimentBadge value={sentiment} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
        {region.zScore?.toFixed(2) || '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-center">
        {region.hasAnomaly ? (
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
    >
      {(value * 100).toFixed(0)}%
    </span>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="bg-white shadow rounded-lg animate-pulse" aria-busy="true">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="h-6 w-40 bg-gray-200 rounded" />
      </div>
      <div className="p-6 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded" />
        ))}
      </div>
    </div>
  );
}
