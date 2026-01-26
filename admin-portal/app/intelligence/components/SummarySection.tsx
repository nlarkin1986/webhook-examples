'use client';

import { useIntelligenceSummary } from '@/lib/hooks/useIntelligence';
import EmptyState from './EmptyState';
import type { TimeRange } from '@/types/intelligence';

interface SummarySectionProps {
  timeRange: TimeRange;
}

export default function SummarySection({ timeRange }: SummarySectionProps) {
  const { data: summary, error, isLoading } = useIntelligenceSummary(timeRange);

  if (isLoading) return <SummarySkeleton />;
  if (error) return <EmptyState variant="error" message={error.message} />;
  if (!summary) return <EmptyState message="No intelligence data available yet" action={{ label: 'Process conversations', href: '/history' }} />;

  const { metrics, alerts, topConcern } = summary;

  return (
    <div className="space-y-6">
      {/* KPI Grid - Accessible with proper semantics */}
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Feedback"
          value={metrics.totalFeedback.toLocaleString()}
          icon={<ChatBubbleIcon />}
        />
        <KpiCard
          title="Avg Sentiment"
          value={formatSentiment(metrics.avgSentiment)}
          sentiment={getSentimentLevel(metrics.avgSentiment)}
          description={`${metrics.avgSentiment >= 0.6 ? 'Positive' : metrics.avgSentiment <= 0.4 ? 'Negative' : 'Neutral'} customer sentiment`}
        />
        <KpiCard
          title="Complaints"
          value={metrics.complaintCount.toLocaleString()}
          icon={<ExclamationIcon />}
          variant="warning"
        />
        <KpiCard
          title="Products Mentioned"
          value={metrics.productsMentioned.toLocaleString()}
          icon={<CubeIcon />}
        />
      </dl>

      {/* Alerts Summary */}
      {alerts.openCount > 0 && (
        <div className="bg-white shadow rounded-lg p-6" role="region" aria-label="Alert summary">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Open Alerts
          </h3>
          <div className="flex gap-4">
            {alerts.criticalCount > 0 && (
              <AlertBadge severity="critical" count={alerts.criticalCount} />
            )}
            {alerts.highCount > 0 && (
              <AlertBadge severity="high" count={alerts.highCount} />
            )}
          </div>
        </div>
      )}

      {/* Top Concern */}
      {topConcern && (
        <div className="bg-white shadow rounded-lg p-6" role="region" aria-label="Top concern">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Top Concern
          </h3>
          <p className="text-gray-600">{topConcern}</p>
        </div>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string;
  icon?: React.ReactNode;
  sentiment?: 'positive' | 'negative' | 'neutral';
  variant?: 'warning';
  description?: string;
}

function KpiCard({ title, value, icon, sentiment, variant, description }: KpiCardProps) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <dt className="text-sm font-medium text-gray-500 flex items-center gap-2">
        {icon}
        {title}
      </dt>
      <dd
        className={`mt-2 text-3xl font-semibold ${
          variant === 'warning' ? 'text-amber-600' :
          sentiment === 'positive' ? 'text-green-600' :
          sentiment === 'negative' ? 'text-red-600' : 'text-gray-900'
        }`}
        aria-describedby={description ? `${title.replace(/\s+/g, '-').toLowerCase()}-desc` : undefined}
      >
        {value}
      </dd>
      {description && (
        <span id={`${title.replace(/\s+/g, '-').toLowerCase()}-desc`} className="sr-only">{description}</span>
      )}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading summary">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white shadow rounded-lg p-6">
            <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-8 w-20 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSentiment(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function getSentimentLevel(value: number): 'positive' | 'negative' | 'neutral' {
  if (value >= 0.6) return 'positive';
  if (value <= 0.4) return 'negative';
  return 'neutral';
}

function AlertBadge({ severity, count }: { severity: string; count: number }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
  };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[severity] || 'bg-gray-100 text-gray-800'}`}>
      {count} {severity}
    </span>
  );
}

// Icon components
function ChatBubbleIcon() {
  return (
    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function ExclamationIcon() {
  return (
    <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}
