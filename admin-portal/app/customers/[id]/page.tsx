'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { customer360Api, Customer360, CustomerEvent } from '@/lib/api';

const TIER_COLORS: Record<string, string> = {
  top: 'bg-purple-100 text-purple-800 border-purple-200',
  vip: 'bg-blue-100 text-blue-800 border-blue-200',
  standard: 'bg-gray-100 text-gray-800 border-gray-200',
  new: 'bg-green-100 text-green-800 border-green-200',
  at_risk: 'bg-red-100 text-red-800 border-red-200',
};

const TIER_LABELS: Record<string, string> = {
  top: 'Top Customer',
  vip: 'VIP',
  standard: 'Standard',
  new: 'New Customer',
  at_risk: 'At Risk',
};

function formatCurrency(amount: string | number, currency = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(date: string | null | undefined): string {
  if (!date) return 'Never';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSentiment(score: number | null | undefined): { label: string; color: string } {
  if (score === null || score === undefined) {
    return { label: 'Unknown', color: 'text-gray-400' };
  }
  if (score >= 0.3) return { label: 'Positive', color: 'text-green-600' };
  if (score <= -0.3) return { label: 'Negative', color: 'text-red-600' };
  return { label: 'Neutral', color: 'text-gray-600' };
}

export default function CustomerDetailPage() {
  const { token } = useAuth();
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer360 | null>(null);
  const [events, setEvents] = useState<CustomerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'events'>('overview');

  const loadData = useCallback(async () => {
    if (!token || !customerId) return;

    setIsLoading(true);
    try {
      const [customerData, eventsData] = await Promise.all([
        customer360Api.get(token, customerId),
        customer360Api.getEvents(token, customerId, { limit: 50 }),
      ]);

      setCustomer(customerData.customer);
      setEvents(eventsData.events);
    } catch (error) {
      console.error('Failed to load customer:', error);
    } finally {
      setIsLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    if (!token || !customerId) return;

    setIsSyncing(true);
    setSyncError(null);
    try {
      const result = await customer360Api.syncCustomer(token, customerId, true);
      if (result.synced) {
        await loadData(); // Reload customer data
      } else {
        setSyncError(result.tier || 'Sync completed but no data found');
      }
    } catch (error: unknown) {
      setSyncError((error as Error).message || 'Failed to sync');
    } finally {
      setIsSyncing(false);
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

  if (!customer) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h2 className="text-lg font-medium text-gray-900">Customer not found</h2>
          <Link href="/customers" className="text-blue-600 hover:text-blue-500 mt-2 inline-block">
            ← Back to customers
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const sentiment = formatSentiment(customer.avg_sentiment_score);

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="px-4 sm:px-0 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-gray-600"
          >
            ← Back
          </button>
          <div className="flex items-center">
            {customer.photo_url ? (
              <img className="h-16 w-16 rounded-full" src={customer.photo_url} alt="" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-gray-500 text-xl font-medium">
                  {customer.display_name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <div className="ml-4">
              <h1 className="text-2xl font-semibold text-gray-900">
                {customer.display_name || 'Unknown Customer'}
              </h1>
              <p className="text-sm text-gray-500">{customer.email}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${TIER_COLORS[customer.tier]}`}>
            {TIER_LABELS[customer.tier]}
          </span>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="btn btn-secondary"
          >
            {isSyncing ? 'Syncing...' : 'Sync Shopify'}
          </button>
        </div>
      </div>

      {syncError && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">{syncError}</p>
        </div>
      )}

      {/* Tier Reason */}
      {customer.tier_reason && (
        <div className="mt-4 px-4 sm:px-0">
          <p className="text-sm text-gray-500">Tier reason: {customer.tier_reason}</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="mt-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`${
              activeTab === 'events'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Activity ({events.length})
          </button>
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Financial Metrics */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Financial Metrics</h3>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500">Lifetime Value</dt>
                <dd className="text-2xl font-semibold text-gray-900">
                  {formatCurrency(customer.ltv, customer.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Gross Revenue</dt>
                <dd className="text-2xl font-semibold text-gray-900">
                  {formatCurrency(customer.gross_revenue, customer.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Net Revenue</dt>
                <dd className="text-lg font-medium text-gray-700">
                  {formatCurrency(customer.net_revenue, customer.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Avg Order Value</dt>
                <dd className="text-lg font-medium text-gray-700">
                  {formatCurrency(customer.aov, customer.currency)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Order Stats */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Order History</h3>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500">Total Orders</dt>
                <dd className="text-2xl font-semibold text-gray-900">{customer.total_orders}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Total Returns</dt>
                <dd className="text-2xl font-semibold text-gray-900">{customer.total_returns}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Last Order</dt>
                <dd className="text-lg font-medium text-gray-700">
                  {formatDate(customer.last_transaction_at)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Shopify Synced</dt>
                <dd className="text-sm text-gray-500">
                  {formatDate(customer.shopify_synced_at)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Conversation Stats */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Conversation Analysis</h3>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500">Total Conversations</dt>
                <dd className="text-2xl font-semibold text-gray-900">
                  {customer.total_conversations}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Avg Sentiment</dt>
                <dd className={`text-2xl font-semibold ${sentiment.color}`}>
                  {customer.avg_sentiment_score?.toFixed(2) || 'N/A'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Sentiment</dt>
                <dd className={`text-lg font-medium ${sentiment.color}`}>
                  {sentiment.label}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Latest Sentiment</dt>
                <dd className="text-lg font-medium text-gray-700">
                  {customer.latest_sentiment_label || 'N/A'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Contact Info */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">Email</dt>
                <dd className="text-sm text-gray-900">{customer.email || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Phone</dt>
                <dd className="text-sm text-gray-900">{customer.phone || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Gladly Customer ID</dt>
                <dd className="text-sm font-mono text-gray-500">{customer.gladly_customer_id}</dd>
              </div>
              {customer.shopify_customer_id && (
                <div>
                  <dt className="text-sm text-gray-500">Shopify Customer ID</dt>
                  <dd className="text-sm font-mono text-gray-500">{customer.shopify_customer_id}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="mt-6">
          <div className="flow-root">
            <ul className="-mb-8">
              {events.map((event, idx) => (
                <li key={idx}>
                  <div className="relative pb-8">
                    {idx !== events.length - 1 && (
                      <span
                        className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                        aria-hidden="true"
                      />
                    )}
                    <div className="relative flex space-x-3">
                      <div>
                        <span
                          className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${
                            event.type === 'order'
                              ? 'bg-green-500'
                              : event.type === 'refund'
                              ? 'bg-red-500'
                              : 'bg-blue-500'
                          }`}
                        >
                          {event.type === 'order' && (
                            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                          )}
                          {event.type === 'refund' && (
                            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          )}
                          {event.type === 'analysis' && (
                            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                          )}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                        <div>
                          <p className="text-sm text-gray-900 font-medium">
                            {event.type === 'order' && 'Order placed'}
                            {event.type === 'refund' && 'Refund processed'}
                            {event.type === 'analysis' && 'Conversation analyzed'}
                          </p>
                          <p className="mt-1 text-sm text-gray-500">
                            {JSON.stringify(event.data).substring(0, 100)}...
                          </p>
                        </div>
                        <div className="whitespace-nowrap text-right text-sm text-gray-500">
                          {formatDateTime(event.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {events.length === 0 && (
                <li className="text-center py-8 text-sm text-gray-500">
                  No activity recorded yet
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
