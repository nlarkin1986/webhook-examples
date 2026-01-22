'use client';

import { useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import DashboardLayout from '@/components/DashboardLayout';
import SummarySection from './components/SummarySection';
import TrendsSection from './components/TrendsSection';
import ProductsSection from './components/ProductsSection';
import GeographicSection from './components/GeographicSection';
import AlertsSection from './components/AlertsSection';
import TimeRangeSelector from './components/TimeRangeSelector';
import type { TabId, TimeRange } from '@/types/intelligence';

const TABS: { id: TabId; name: string }[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'trends', name: 'Trends' },
  { id: 'products', name: 'Products' },
  { id: 'geographic', name: 'Geographic' },
  { id: 'alerts', name: 'Alerts' },
];

function IntelligenceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  // URL-driven state for shareability
  const activeTab = (searchParams.get('tab') as TabId) || 'overview';
  const timeRange = (searchParams.get('range') as TimeRange) || 'last_7d';
  const isAdmin = user?.role === 'admin';

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value) params.set(key, value);
        else params.delete(key);
      });
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setActiveTab = (tab: TabId) => updateParams({ tab });
  const setTimeRange = (range: TimeRange) => updateParams({ range });

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="px-4 sm:px-0 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Customer Intelligence
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Analyze trends, patterns, and insights from customer conversations
          </p>
        </div>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {/* Tab Navigation - WCAG compliant */}
      <div className="mt-6 border-b border-gray-200">
        <nav
          className="-mb-px flex space-x-8"
          role="tablist"
          aria-label="Intelligence dashboard sections"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              className={`${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content - WCAG panel structure */}
      <div className="mt-6">
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 'overview' && <SummarySection timeRange={timeRange} />}
          {activeTab === 'trends' && <TrendsSection timeRange={timeRange} />}
          {activeTab === 'products' && <ProductsSection timeRange={timeRange} />}
          {activeTab === 'geographic' && <GeographicSection timeRange={timeRange} />}
          {activeTab === 'alerts' && <AlertsSection timeRange={timeRange} isAdmin={isAdmin} />}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={<div className="animate-pulse p-8">Loading...</div>}>
      <IntelligenceContent />
    </Suspense>
  );
}
