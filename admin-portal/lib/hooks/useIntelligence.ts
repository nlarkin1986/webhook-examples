import useSWR, { mutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { intelligenceApi } from '@/lib/api';
import type {
  IntelligenceSummary,
  TrendsResponse,
  ProductsResponse,
  ProductParams,
  GeographicResponse,
  GeoParams,
  AlertsResponse,
  AlertParams,
  TimeRange,
} from '@/types/intelligence';

// Custom hook for intelligence summary
export function useIntelligenceSummary(timeRange: TimeRange) {
  const { token } = useAuth();

  return useSWR<IntelligenceSummary>(
    token ? ['intelligence-summary', token, timeRange] : null,
    () => intelligenceApi.getSummary(token!, timeRange),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute deduplication
    }
  );
}

// Custom hook for trends
export function useIntelligenceTrends(timeRange: TimeRange) {
  const { token } = useAuth();

  return useSWR<TrendsResponse>(
    token ? ['intelligence-trends', token, timeRange] : null,
    () => intelligenceApi.getTrends(token!, timeRange),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );
}

// Custom hook for products
export function useIntelligenceProducts(params: ProductParams) {
  const { token } = useAuth();
  const key = JSON.stringify({ ...params, token: !!token });

  return useSWR<ProductsResponse>(
    token ? ['intelligence-products', key] : null,
    () => intelligenceApi.getProducts(token!, params),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );
}

// Custom hook for geographic data
export function useIntelligenceGeographic(params: GeoParams) {
  const { token } = useAuth();
  const key = JSON.stringify({ ...params, token: !!token });

  return useSWR<GeographicResponse>(
    token ? ['intelligence-geographic', key] : null,
    () => intelligenceApi.getGeographic(token!, params),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );
}

// Custom hook for alerts
export function useIntelligenceAlerts(params: AlertParams) {
  const { token } = useAuth();
  const key = JSON.stringify({ ...params, token: !!token });

  return useSWR<AlertsResponse>(
    token ? ['intelligence-alerts', key] : null,
    () => intelligenceApi.getAlerts(token!, params),
    {
      revalidateOnFocus: true, // Alerts should refresh on focus
      dedupingInterval: 10000, // More frequent updates for alerts
    }
  );
}

// Mutation helper for alert updates
export function useAlertMutation() {
  const { token } = useAuth();

  const updateAlert = async (alertId: string, status: string, note?: string) => {
    if (!token) throw new Error('No auth token');

    const result = await intelligenceApi.updateAlert(token, alertId, { status, note });

    // Revalidate all alert queries
    mutate((key) => Array.isArray(key) && key[0] === 'intelligence-alerts');

    return result;
  };

  return { updateAlert };
}
