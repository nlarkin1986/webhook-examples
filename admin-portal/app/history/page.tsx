'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { analysisApi } from '@/lib/api';

export default function HistoryPage() {
  const { token } = useAuth();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAnalysis, setSelectedAnalysis] = useState<any>(null);
  const limit = 20;

  useEffect(() => {
    if (token) {
      loadAnalyses();
    }
  }, [token, offset]);

  const loadAnalyses = async () => {
    setIsLoading(true);
    try {
      const data: any = await analysisApi.list(token!, { limit, offset });
      setAnalyses(data.analyses);
      setTotal(data.total);
    } catch (error) {
      console.error('Failed to load analyses:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getSentimentColor = (label: string) => {
    switch (label?.toLowerCase()) {
      case 'positive': return 'status-success';
      case 'negative': return 'status-error';
      default: return 'status-pending';
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-0">
        <h1 className="text-2xl font-semibold text-gray-900">Analysis History</h1>
        <p className="mt-1 text-sm text-gray-600">
          Browse past conversation analysis results
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mt-6 text-sm text-gray-500">
            Showing {analyses.length} of {total} analyses
          </div>

          {/* Table */}
          <div className="mt-4 card p-0 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sentiment
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Intent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {analyses.map((analysis) => (
                  <tr
                    key={analysis.id}
                    onClick={() => setSelectedAnalysis(analysis)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(analysis.analyzed_at || analysis.analyzedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {analysis.event_type || analysis.eventType}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {analysis.sentiment && (
                        <span className={`status-badge ${getSentimentColor(analysis.sentiment.label)}`}>
                          {analysis.sentiment.label} ({analysis.sentiment.score?.toFixed(2)})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {analysis.intent?.primary_intent || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`status-badge ${analysis.success ? 'status-success' : 'status-error'}`}>
                        {analysis.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {analysis.processing_time_ms || analysis.processingTimeMs
                        ? `${((analysis.processing_time_ms || analysis.processingTimeMs) / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="btn btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="btn btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Analysis Detail Modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Analysis Details</h3>
                <button
                  onClick={() => setSelectedAnalysis(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Conversation ID</label>
                  <p className="font-mono text-sm">{selectedAnalysis.gladly_conversation_id || selectedAnalysis.conversationId}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Customer ID</label>
                  <p className="font-mono text-sm">{selectedAnalysis.gladly_customer_id || selectedAnalysis.customerId}</p>
                </div>

                {selectedAnalysis.summary && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Summary</label>
                    <p className="text-sm">{selectedAnalysis.summary}</p>
                  </div>
                )}

                {selectedAnalysis.sentiment && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Sentiment Analysis</label>
                    <pre className="mt-1 bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                      {JSON.stringify(selectedAnalysis.sentiment, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedAnalysis.intent && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Intent Analysis</label>
                    <pre className="mt-1 bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                      {JSON.stringify(selectedAnalysis.intent, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedAnalysis.topics_applied?.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Topics Applied</label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selectedAnalysis.topics_applied.map((topic: string) => (
                        <span key={topic} className="status-badge status-success">{topic}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedAnalysis.error_message && (
                  <div>
                    <label className="text-sm font-medium text-red-500">Error</label>
                    <p className="text-sm text-red-600">{selectedAnalysis.error_message}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
