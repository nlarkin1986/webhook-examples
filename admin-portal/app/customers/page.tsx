'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { customer360Api, Customer360, Customer360Stats } from '@/lib/api';

const TIER_COLORS: Record<string, string> = {
  top: 'bg-purple-100 text-purple-800',
  vip: 'bg-blue-100 text-blue-800',
  standard: 'bg-gray-100 text-gray-800',
  new: 'bg-green-100 text-green-800',
  at_risk: 'bg-red-100 text-red-800',
};

const TIER_LABELS: Record<string, string> = {
  top: 'Top',
  vip: 'VIP',
  standard: 'Standard',
  new: 'New',
  at_risk: 'At Risk',
};

function formatCurrency(amount: string | number, currency = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatSentiment(score: number | null | undefined): { label: string; color: string } {
  if (score === null || score === undefined) {
    return { label: 'N/A', color: 'text-gray-400' };
  }
  if (score >= 0.3) return { label: 'Positive', color: 'text-green-600' };
  if (score <= -0.3) return { label: 'Negative', color: 'text-red-600' };
  return { label: 'Neutral', color: 'text-gray-600' };
}

export default function CustomersPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Customer360Stats | null>(null);
  const [customers, setCustomers] = useState<Customer360[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    tier: '',
    search: '',
    sortBy: 'ltv',
    sortOrder: 'desc',
  });

  const loadData = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const [statsData, customersData] = await Promise.all([
        customer360Api.getStats(token),
        customer360Api.list(token, {
          tier: filters.tier || undefined,
          search: filters.search || undefined,
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
          page: pagination.page,
          pageSize: pagination.pageSize,
        }),
      ]);

      setStats(statsData);
      setCustomers(customersData.data);
      setPagination(customersData.pagination);
    } catch (error) {
      console.error('Failed to load customers:', error);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, pagination.page, pagination.pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  if (isLoading && !customers.length) {
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
        <h1 className="text-2xl font-semibold text-gray-900">Customer 360</h1>
        <p className="mt-1 text-sm text-gray-600">
          Unified view of customer profiles with Shopify metrics and conversation analysis
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="card">
            <dt className="text-sm font-medium text-gray-500">Total Customers</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">
              {stats.totalCustomers.toLocaleString()}
            </dd>
          </div>
          <div className="card">
            <dt className="text-sm font-medium text-gray-500">Top + VIP</dt>
            <dd className="mt-1 text-2xl font-semibold text-purple-600">
              {(stats.tierBreakdown.top + stats.tierBreakdown.vip).toLocaleString()}
            </dd>
          </div>
          <div className="card">
            <dt className="text-sm font-medium text-gray-500">At Risk</dt>
            <dd className="mt-1 text-2xl font-semibold text-red-600">
              {stats.tierBreakdown.at_risk.toLocaleString()}
            </dd>
          </div>
          <div className="card">
            <dt className="text-sm font-medium text-gray-500">Avg LTV</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">
              {formatCurrency(stats.avgLtv)}
            </dd>
          </div>
          <div className="card">
            <dt className="text-sm font-medium text-gray-500">Avg Sentiment</dt>
            <dd className={`mt-1 text-2xl font-semibold ${formatSentiment(stats.avgSentiment).color}`}>
              {stats.avgSentiment?.toFixed(2) || 'N/A'}
            </dd>
          </div>
        </div>
      )}

      {/* Shopify Status Banner */}
      {stats && !stats.shopifyConnected && (
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            Connect your Shopify store to see LTV, order history, and tier assignments.
          </p>
          <Link href="/settings/shopify" className="text-sm font-medium text-yellow-600 hover:text-yellow-500 mt-2 inline-block">
            Connect Shopify →
          </Link>
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-4">
        <div>
          <label htmlFor="tier-filter" className="sr-only">Filter by tier</label>
          <select
            id="tier-filter"
            value={filters.tier}
            onChange={(e) => handleFilterChange('tier', e.target.value)}
            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="">All Tiers</option>
            <option value="top">Top</option>
            <option value="vip">VIP</option>
            <option value="standard">Standard</option>
            <option value="new">New</option>
            <option value="at_risk">At Risk</option>
          </select>
        </div>

        <div>
          <label htmlFor="sort-filter" className="sr-only">Sort by</label>
          <select
            id="sort-filter"
            value={filters.sortBy}
            onChange={(e) => handleFilterChange('sortBy', e.target.value)}
            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="ltv">LTV</option>
            <option value="gross_revenue">Revenue</option>
            <option value="total_orders">Orders</option>
            <option value="avg_sentiment_score">Sentiment</option>
            <option value="last_transaction_at">Last Order</option>
          </select>
        </div>

        <div className="flex-1">
          <label htmlFor="search" className="sr-only">Search</label>
          <input
            type="text"
            id="search"
            placeholder="Search by name or email..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          />
        </div>
      </div>

      {/* Customer Table */}
      <div className="mt-6 overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Customer</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Tier</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">LTV</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Orders</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Sentiment</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Conversations</th>
              <th className="relative py-3.5 pl-3 pr-4">
                <span className="sr-only">View</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {customers.map((customer) => {
              const sentiment = formatSentiment(customer.avg_sentiment_score);
              return (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                    <div className="flex items-center">
                      <div className="h-10 w-10 flex-shrink-0">
                        {customer.photo_url ? (
                          <img className="h-10 w-10 rounded-full" src={customer.photo_url} alt="" />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                            <span className="text-gray-500 text-sm font-medium">
                              {customer.display_name?.charAt(0)?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="ml-4">
                        <div className="font-medium text-gray-900">{customer.display_name || 'Unknown'}</div>
                        <div className="text-gray-500">{customer.email || 'No email'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${TIER_COLORS[customer.tier]}`}>
                      {TIER_LABELS[customer.tier]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                    {formatCurrency(customer.ltv, customer.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {customer.total_orders}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-4 text-sm ${sentiment.color}`}>
                    {sentiment.label}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {customer.total_conversations}
                  </td>
                  <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                  No customers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} customers
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="btn btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="btn btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
