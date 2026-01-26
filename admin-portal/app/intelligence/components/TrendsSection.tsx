'use client';

import dynamic from 'next/dynamic';
import { useIntelligenceTrends } from '@/lib/hooks/useIntelligence';
import EmptyState from './EmptyState';
import type { TimeRange, Topic } from '@/types/intelligence';

// Lazy load Recharts to reduce initial bundle (~200KB savings)
const TrendLineChart = dynamic(() => import('./charts/TrendLineChart'), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

interface TrendsSectionProps {
  timeRange: TimeRange;
}

export default function TrendsSection({ timeRange }: TrendsSectionProps) {
  const { data: trends, error, isLoading } = useIntelligenceTrends(timeRange);

  if (isLoading) return <TrendsSkeleton />;
  if (error) return <EmptyState variant="error" message={error.message} />;
  if (!trends) return <EmptyState message="No trend data available" />;

  return (
    <div className="space-y-6">
      {/* Trend Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TopicCard
          title="Trending"
          icon={<TrendingUpIcon className="text-green-500" />}
          topics={trends.trending}
          variant="trending"
        />
        <TopicCard
          title="Emerging"
          icon={<SparklesIcon className="text-blue-500" />}
          topics={trends.emerging}
          variant="emerging"
        />
        <TopicCard
          title="Declining"
          icon={<TrendingDownIcon className="text-amber-500" />}
          topics={trends.declining}
          variant="declining"
        />
      </div>

      {/* Trend Timeline Chart */}
      {trends.summary?.timeline && trends.summary.timeline.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Topic Volume Over Time
          </h3>
          <div className="h-80">
            <TrendLineChart data={trends.summary.timeline} />
          </div>
        </div>
      )}
    </div>
  );
}

interface TopicCardProps {
  title: string;
  icon: React.ReactNode;
  topics: Topic[];
  variant: 'trending' | 'emerging' | 'declining';
}

function TopicCard({ title, icon, topics, variant }: TopicCardProps) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <TopicList topics={topics} variant={variant} />
    </div>
  );
}

function TopicList({ topics, variant }: { topics: Topic[]; variant: string }) {
  if (!topics?.length) {
    return <p className="text-gray-500 text-sm">No topics to display</p>;
  }

  const colors: Record<string, string> = {
    trending: 'text-green-600',
    emerging: 'text-blue-600',
    declining: 'text-amber-600',
  };

  return (
    <ul className="space-y-3" role="list">
      {topics.slice(0, 5).map((topic, idx) => (
        <li key={idx} className="flex items-center justify-between">
          <span className="text-gray-700">{topic.topic || topic.name}</span>
          <span className={`text-sm font-medium ${colors[variant]}`}>
            {topic.changePercent != null
              ? `${topic.changePercent > 0 ? '+' : ''}${topic.changePercent}%`
              : topic.count?.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white shadow rounded-lg p-6">
            <div className="h-6 w-32 bg-gray-200 rounded mb-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((j) => (
                <div key={j} className="flex justify-between">
                  <div className="h-4 w-24 bg-gray-200 rounded" />
                  <div className="h-4 w-12 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-full w-full bg-gray-100 rounded animate-pulse flex items-center justify-center">
      <span className="text-gray-400">Loading chart...</span>
    </div>
  );
}

// Icon components
function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function TrendingDownIcon({ className }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}
