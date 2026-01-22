/**
 * API Client for Admin Portal
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: object;
  token?: string;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/api/admin${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'Request failed', response.status);
  }

  return data;
}

// Auth API
export const authApi = {
  signup: (data: { companyName: string; email: string; password: string }) =>
    apiRequest<{ token: string; user: object; tenant: object }>('/auth/signup', {
      method: 'POST',
      body: data,
    }),

  login: (data: { email: string; password: string }) =>
    apiRequest<{ token: string; user: object; tenant: object }>('/auth/login', {
      method: 'POST',
      body: data,
    }),

  me: (token: string) =>
    apiRequest<{ user: object; tenant: object }>('/auth/me', { token }),

  changePassword: (token: string, data: { currentPassword: string; newPassword: string }) =>
    apiRequest('/auth/change-password', { method: 'POST', body: data, token }),
};

// Tenant API
export const tenantApi = {
  get: (token: string) => apiRequest<object>('/tenant', { token }),

  update: (token: string, data: { name: string }) =>
    apiRequest('/tenant', { method: 'PATCH', body: data, token }),

  getWebhookUrl: (token: string) =>
    apiRequest<{ webhookUrl: string; instructions: string[] }>('/tenant/webhook-url', { token }),
};

// Gladly API
export const gladlyApi = {
  getConnection: (token: string) =>
    apiRequest<object>('/gladly/connection', { token }),

  saveConnection: (
    token: string,
    data: { gladlyHost: string; gladlyUsername: string; gladlyApiToken: string; webhookSecret?: string }
  ) => apiRequest('/gladly/connection', { method: 'POST', body: data, token }),

  testConnection: (token: string) =>
    apiRequest<{ success: boolean; organization?: string; error?: string }>(
      '/gladly/test',
      { method: 'POST', token }
    ),

  deleteConnection: (token: string) =>
    apiRequest('/gladly/connection', { method: 'DELETE', token }),

  listTopics: (token: string) =>
    apiRequest<{ topics: Array<{ id: string; name: string }> }>('/gladly/topics', { token }),
};

// Config API
export const configApi = {
  get: (token: string) => apiRequest<object>('/config', { token }),

  update: (token: string, data: object) =>
    apiRequest('/config', { method: 'PATCH', body: data, token }),

  reset: (token: string) =>
    apiRequest('/config/reset', { method: 'POST', token }),

  getModels: (token: string) =>
    apiRequest<{ orchestrator: string[]; specialist: string[] }>('/config/models', { token }),

  getTools: (token: string) =>
    apiRequest<{ tools: Array<{ name: string; description: string }> }>('/config/tools', { token }),

  updateTopicMappings: (token: string, mappings: object) =>
    apiRequest('/config/topic-mappings', { method: 'PATCH', body: { mappings }, token }),
};

// Analysis API
export const analysisApi = {
  list: (token: string, params?: { limit?: number; offset?: number; since?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return apiRequest<{ analyses: object[]; total: number }>(
      `/analysis${query ? `?${query}` : ''}`,
      { token }
    );
  },

  getStats: (token: string, period?: string) =>
    apiRequest<object>(`/analysis/stats${period ? `?period=${period}` : ''}`, { token }),

  get: (token: string, id: string) => apiRequest<object>(`/analysis/${id}`, { token }),
};

// Customer 360 API
export interface Customer360 {
  id: string;
  gladly_customer_id: string;
  shopify_customer_id?: string;
  display_name: string;
  email?: string;
  phone?: string;
  photo_url?: string;
  tier: 'top' | 'vip' | 'standard' | 'new' | 'at_risk';
  tier_reason?: string;
  gross_revenue: string;
  net_revenue: string;
  ltv: string;
  aov: string;
  currency: string;
  total_orders: number;
  total_returns: number;
  last_transaction_at?: string;
  total_conversations: number;
  avg_sentiment_score?: number;
  latest_sentiment_label?: string;
  shopify_synced_at?: string;
  gladly_synced_at?: string;
}

export interface Customer360Stats {
  totalCustomers: number;
  tierBreakdown: {
    top: number;
    vip: number;
    standard: number;
    new: number;
    at_risk: number;
  };
  avgLtv: number;
  avgSentiment: number;
  shopifyConnected: boolean;
}

export interface CustomerEvent {
  type: 'order' | 'refund' | 'analysis';
  timestamp: string;
  data: object;
}

export const customer360Api = {
  // Stats
  getStats: (token: string) =>
    apiRequest<Customer360Stats>('/customers/stats', { token }),

  // Customer list
  list: (
    token: string,
    params?: {
      tier?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
      page?: number;
      pageSize?: number;
    }
  ) => {
    const query = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params || {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return apiRequest<{
      data: Customer360[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/customers${query ? `?${query}` : ''}`, { token });
  },

  // Customer detail
  get: (token: string, id: string) =>
    apiRequest<{ customer: Customer360 }>(`/customers/${id}`, { token }),

  getByGladlyId: (token: string, gladlyCustomerId: string) =>
    apiRequest<{ customer: Customer360 }>(`/customers/gladly/${gladlyCustomerId}`, { token }),

  // Customer events
  getEvents: (token: string, id: string, params?: { eventTypes?: string; limit?: number }) => {
    const query = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params || {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return apiRequest<{ events: CustomerEvent[] }>(
      `/customers/${id}/events${query ? `?${query}` : ''}`,
      { token }
    );
  },

  // Sync
  syncCustomer: (token: string, id: string, force?: boolean) =>
    apiRequest<{ synced: boolean; metrics?: object; tier?: string; tierReason?: string }>(
      `/customers/${id}/sync`,
      { method: 'POST', body: { force }, token }
    ),

  // Tier config
  getTierConfig: (token: string) =>
    apiRequest<{ thresholds: object }>('/customers/tiers/config', { token }),

  updateTierConfig: (
    token: string,
    data: { topMinLtv?: number; vipMinLtv?: number; atRiskMaxSentiment?: number }
  ) => apiRequest('/customers/tiers/config', { method: 'PATCH', body: data, token }),
};

// Shopify API
export const shopifyApi = {
  getConnection: (token: string) =>
    apiRequest<{
      connected: boolean;
      storeUrl?: string;
      status?: string;
      lastVerifiedAt?: string;
      scopes?: string[];
    }>('/shopify/connection', { token }),

  saveConnection: (
    token: string,
    data: { storeUrl: string; accessToken: string; scopes?: string[] }
  ) => apiRequest('/shopify/connection', { method: 'POST', body: data, token }),

  testConnection: (token: string) =>
    apiRequest<{ success: boolean; shop?: object; error?: string }>(
      '/shopify/test',
      { method: 'POST', token }
    ),

  deleteConnection: (token: string) =>
    apiRequest('/shopify/connection', { method: 'DELETE', token }),
};

// Intelligence API
import type {
  IntelligenceSummary,
  TrendsResponse,
  ProductsResponse,
  ProductParams,
  GeographicResponse,
  GeoParams,
  AlertsResponse,
  AlertParams,
  Alert,
} from '@/types/intelligence';

export const intelligenceApi = {
  getSummary: (token: string, timeRange = 'last_7d') =>
    apiRequest<IntelligenceSummary>(`/intelligence/summary?timeRange=${timeRange}`, { token }),

  getTrends: (token: string, timeRange = 'last_7d') =>
    apiRequest<TrendsResponse>(`/intelligence/trends?timeRange=${timeRange}`, { token }),

  getProducts: (token: string, params?: ProductParams) => {
    const query = new URLSearchParams(
      Object.entries(params || {}).filter(([, v]) => v != null) as [string, string][]
    ).toString();
    return apiRequest<ProductsResponse>(`/intelligence/products${query ? `?${query}` : ''}`, { token });
  },

  getGeographic: (token: string, params?: GeoParams) => {
    const query = new URLSearchParams(
      Object.entries(params || {}).filter(([, v]) => v != null) as [string, string][]
    ).toString();
    return apiRequest<GeographicResponse>(`/intelligence/geographic${query ? `?${query}` : ''}`, { token });
  },

  getAlerts: (token: string, params?: AlertParams) => {
    const query = new URLSearchParams(
      Object.entries(params || {}).filter(([, v]) => v != null) as [string, string][]
    ).toString();
    return apiRequest<AlertsResponse>(`/intelligence/alerts${query ? `?${query}` : ''}`, { token });
  },

  updateAlert: (token: string, alertId: string, data: { status: string; note?: string }) =>
    apiRequest<{ alert: Alert }>(`/intelligence/alerts/${alertId}`, { method: 'PATCH', body: data, token }),
};

export { ApiError };
