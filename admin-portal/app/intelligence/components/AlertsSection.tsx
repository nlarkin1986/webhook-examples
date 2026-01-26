'use client';

import { useState } from 'react';
import { useIntelligenceAlerts, useAlertMutation } from '@/lib/hooks/useIntelligence';
import EmptyState from './EmptyState';
import type { TimeRange, Alert } from '@/types/intelligence';

interface AlertsSectionProps {
  timeRange: TimeRange;
  isAdmin: boolean;
}

export default function AlertsSection({ timeRange, isAdmin }: AlertsSectionProps) {
  const [statusFilter, setStatusFilter] = useState('open');
  const [severityFilter, setSeverityFilter] = useState('');

  const { data, error, isLoading, mutate } = useIntelligenceAlerts({
    status: statusFilter || undefined,
    severity: severityFilter || undefined,
    limit: 50,
  });

  const { updateAlert } = useAlertMutation();

  const handleUpdateStatus = async (alertId: string, status: string) => {
    if (!isAdmin) return;

    // Optimistic update
    mutate(
      (current) => current ? ({
        ...current,
        alerts: current.alerts.map((a) =>
          a.id === alertId ? { ...a, status: status as Alert['status'] } : a
        ),
      }) : current,
      false
    );

    try {
      await updateAlert(alertId, status);
    } catch (err) {
      // Revalidate on error to restore correct state
      mutate();
      console.error('Failed to update alert:', err);
    }
  };

  if (isLoading) return <AlertsSkeleton />;
  if (error) return <EmptyState variant="error" message={error.message} />;

  if (!data?.alerts?.length) {
    return (
      <EmptyState
        message="No alerts to display"
        variant="positive"
        description="All systems operating normally"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4" role="group" aria-label="Alert filters">
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="block rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by severity</span>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="block rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>

      {/* Alert List */}
      <div className="space-y-4" role="list" aria-label="Alerts">
        {data.alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            isAdmin={isAdmin}
            onUpdateStatus={handleUpdateStatus}
          />
        ))}
      </div>
    </div>
  );
}

interface AlertCardProps {
  alert: Alert;
  isAdmin: boolean;
  onUpdateStatus: (alertId: string, status: string) => void;
}

function AlertCard({ alert, isAdmin, onUpdateStatus }: AlertCardProps) {
  const severityColors: Record<string, string> = {
    critical: 'border-l-red-500 bg-red-50',
    high: 'border-l-orange-500 bg-orange-50',
    medium: 'border-l-yellow-500 bg-yellow-50',
    low: 'border-l-gray-500 bg-gray-50',
  };

  return (
    <article
      className={`bg-white shadow rounded-lg p-6 border-l-4 ${severityColors[alert.severity] || severityColors.low}`}
      role="listitem"
      aria-labelledby={`alert-title-${alert.id}`}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={alert.severity} />
            <h4 id={`alert-title-${alert.id}`} className="text-lg font-medium text-gray-900">
              {alert.title}
            </h4>
          </div>
          {alert.description && (
            <p className="mt-1 text-sm text-gray-600">{alert.description}</p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            <time dateTime={alert.createdAt}>
              {formatRelativeTime(alert.createdAt)}
            </time>
          </p>
        </div>
        {isAdmin && alert.status === 'open' && (
          <div className="flex gap-2">
            <button
              onClick={() => onUpdateStatus(alert.id, 'acknowledged')}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-describedby={`alert-title-${alert.id}`}
            >
              Acknowledge
            </button>
            <button
              onClick={() => onUpdateStatus(alert.id, 'resolved')}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-describedby={`alert-title-${alert.id}`}
            >
              Resolve
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[severity] || colors.low}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function AlertsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white shadow rounded-lg h-24" />
      ))}
    </div>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}
