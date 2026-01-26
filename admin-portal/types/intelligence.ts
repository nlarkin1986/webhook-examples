// Intelligence API Response Types
// Based on backend: conversation-analysis/admin-api/controllers/intelligence.js

export interface IntelligenceSummary {
  metrics: {
    totalFeedback: number;
    avgSentiment: number;
    complaintCount: number;
    productsMentioned: number;
  };
  alerts: {
    openCount: number;
    criticalCount: number;
    highCount: number;
  };
  topConcern: string | null;
  period: {
    start: string;
    end: string;
  };
}

export interface Topic {
  topic: string;
  name?: string; // Alternative field name in some responses
  count: number;
  changePercent?: number;
  sentiment?: number;
}

export interface TrendsResponse {
  trending: Topic[];
  emerging: Topic[];
  declining: Topic[];
  summary?: {
    timeline: Array<{
      date: string;
      volume: number;
    }>;
  };
}

export interface Product {
  shopifyProductId: string;
  productTitle: string;
  totalMentions: number;
  complaintCount: number;
  praiseCount: number;
  avgSentiment: number;
  isAnomalous: boolean;
}

export interface ProductsResponse {
  products: Product[];
  total: number;
}

export interface ProductParams {
  timeRange?: string;
  sortBy?: 'complaints' | 'mentions' | 'sentiment';
  limit?: number;
}

export interface Region {
  stateCode?: string;
  cityName?: string;
  zipPrefix?: string;
  totalIssues: number;
  avgSentiment: number;
  zScore?: number;
  hasAnomaly: boolean;
}

export interface GeographicResponse {
  regions: Region[];
  total: number;
}

export interface GeoParams {
  timeRange?: string;
  geoLevel?: 'state' | 'city' | 'zip';
  onlyAnomalies?: string;
}

export interface Alert {
  id: string;
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface AlertsResponse {
  alerts: Alert[];
  total: number;
}

export interface AlertParams {
  status?: string;
  severity?: string;
  limit?: number;
}

export type TimeRange = 'last_24h' | 'last_7d' | 'last_30d';
export type TabId = 'overview' | 'trends' | 'products' | 'geographic' | 'alerts';
