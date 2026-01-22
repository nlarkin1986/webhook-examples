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

export { ApiError };
