'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { analysisApi, gladlyApi, tenantApi } from '@/lib/api';

interface Stats {
  totalAnalyses: number;
  successRate: string;
  avgProcessingTime: number;
  uniqueCustomers: number;
  uniqueConversations: number;
}

interface ConnectionStatus {
  connected: boolean;
  status?: string;
  gladlyHost?: string;
}

export default function DashboardPage() {
  const { token, tenant } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    try {
      const [statsData, connectionData, webhookData]: any[] = await Promise.all([
        analysisApi.getStats(token!, '7d'),
        gladlyApi.getConnection(token!),
        tenantApi.getWebhookUrl(token!)
      ]);

      setStats(statsData.stats);
      setConnection(connectionData);
      setWebhookUrl(webhookData.webhookUrl);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-0">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Overview of your conversation analysis system
        </p>
      </div>

      {/* Connection Status */}
      <div className="mt-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Gladly Connection</h3>
              <p className="text-sm text-gray-500">
                {connection?.gladlyHost || 'Not configured'}
              </p>
            </div>
            <div>
              {connection?.connected ? (
                <span className={`status-badge ${connection.status === 'verified' ? 'status-success' : 'status-warning'}`}>
                  {connection.status === 'verified' ? 'Connected' : 'Pending Verification'}
                </span>
              ) : (
                <span className="status-badge status-error">Not Connected</span>
              )}
            </div>
          </div>

          {!connection?.connected && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                Connect your Gladly workspace to start analyzing conversations.
              </p>
              <a href="/settings/gladly" className="text-sm font-medium text-blue-600 hover:text-blue-500 mt-2 inline-block">
                Set up connection →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Webhook URL */}
      {webhookUrl && (
        <div className="mt-6">
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900">Webhook URL</h3>
            <p className="mt-1 text-sm text-gray-500">
              Configure this URL in Gladly to receive conversation events
            </p>
            <div className="mt-3 flex items-center space-x-2">
              <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono truncate">
                {webhookUrl}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
                className="btn btn-secondary"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {stats && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Analyses"
            value={stats.totalAnalyses.toLocaleString()}
            subtitle="Last 7 days"
          />
          <StatCard
            title="Success Rate"
            value={`${stats.successRate}%`}
            subtitle="Successful analyses"
          />
          <StatCard
            title="Avg Processing Time"
            value={`${(stats.avgProcessingTime / 1000).toFixed(1)}s`}
            subtitle="Per analysis"
          />
          <StatCard
            title="Unique Customers"
            value={stats.uniqueCustomers.toLocaleString()}
            subtitle="Analyzed"
          />
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ActionCard
            title="Configure Agent"
            description="Customize AI behavior, prompts, and tools"
            href="/settings/config"
          />
          <ActionCard
            title="View History"
            description="Browse past analysis results"
            href="/history"
          />
          <ActionCard
            title="Manage Connection"
            description="Update Gladly credentials"
            href="/settings/gladly"
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="card">
      <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
      <dd className="mt-1 text-3xl font-semibold text-gray-900">{value}</dd>
      <dd className="mt-1 text-sm text-gray-500">{subtitle}</dd>
    </div>
  );
}

function ActionCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a href={href} className="card hover:shadow-lg transition-shadow">
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </a>
  );
}
