'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { shopifyApi, customer360Api } from '@/lib/api';

interface ShopifyConnection {
  connected: boolean;
  storeUrl?: string;
  status?: string;
  lastVerifiedAt?: string;
  scopes?: string[];
}

interface TierConfig {
  top_min_ltv: number;
  vip_min_ltv: number;
  at_risk_max_sentiment: number;
}

export default function ShopifySettingsPage() {
  const { token } = useAuth();
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [tierConfig, setTierConfig] = useState<TierConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    storeUrl: '',
    accessToken: '',
  });
  const [tierFormData, setTierFormData] = useState({
    topMinLtv: 5000,
    vipMinLtv: 2000,
    atRiskMaxSentiment: -0.3,
  });

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [connectionData, tierData] = await Promise.all([
        shopifyApi.getConnection(token!),
        customer360Api.getTierConfig(token!),
      ]);

      setConnection(connectionData);
      if (connectionData.storeUrl) {
        setFormData(prev => ({ ...prev, storeUrl: connectionData.storeUrl || '' }));
      }

      if (tierData.thresholds) {
        const t = tierData.thresholds as TierConfig;
        setTierConfig(t);
        setTierFormData({
          topMinLtv: t.top_min_ltv || 5000,
          vipMinLtv: t.vip_min_ltv || 2000,
          atRiskMaxSentiment: t.at_risk_max_sentiment || -0.3,
        });
      }
    } catch (error) {
      console.error('Failed to load Shopify settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await shopifyApi.saveConnection(token, {
        storeUrl: formData.storeUrl,
        accessToken: formData.accessToken,
      });
      setMessage({ type: 'success', text: 'Shopify credentials saved successfully' });
      setFormData(prev => ({ ...prev, accessToken: '' })); // Clear token from form
      await loadData(); // Reload connection status
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to save credentials' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!token) return;

    setIsTesting(true);
    setMessage(null);
    try {
      const result = await shopifyApi.testConnection(token);
      if (result.success) {
        setMessage({ type: 'success', text: `Connected to ${(result.shop as { name: string })?.name || 'Shopify'}` });
        await loadData(); // Reload to get updated status
      } else {
        setMessage({ type: 'error', text: result.error || 'Connection test failed' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDeleteConnection = async () => {
    if (!token) return;
    if (!confirm('Are you sure you want to remove your Shopify connection?')) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await shopifyApi.deleteConnection(token);
      setMessage({ type: 'success', text: 'Shopify connection removed' });
      setFormData({ storeUrl: '', accessToken: '' });
      await loadData();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to remove connection' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveTierConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await customer360Api.updateTierConfig(token, {
        topMinLtv: tierFormData.topMinLtv,
        vipMinLtv: tierFormData.vipMinLtv,
        atRiskMaxSentiment: tierFormData.atRiskMaxSentiment,
      });
      setMessage({ type: 'success', text: 'Tier thresholds updated successfully' });
      await loadData();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to update tier config' });
    } finally {
      setIsSaving(false);
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
        <h1 className="text-2xl font-semibold text-gray-900">Shopify Integration</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connect your Shopify store to enrich customer profiles with order history and LTV
        </p>
      </div>

      {message && (
        <div
          className={`mt-4 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Connection Status */}
      <div className="mt-6 card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Connection Status</h3>
          {connection?.connected && (
            <span
              className={`status-badge ${
                connection.status === 'verified' ? 'status-success' : 'status-warning'
              }`}
            >
              {connection.status === 'verified' ? 'Connected' : 'Pending Verification'}
            </span>
          )}
        </div>

        {connection?.connected ? (
          <div>
            <dl className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <dt className="text-sm text-gray-500">Store URL</dt>
                <dd className="text-sm font-medium text-gray-900">{connection.storeUrl}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Last Verified</dt>
                <dd className="text-sm text-gray-900">
                  {connection.lastVerifiedAt
                    ? new Date(connection.lastVerifiedAt).toLocaleString()
                    : 'Never'}
                </dd>
              </div>
              {connection.scopes && (
                <div className="col-span-2">
                  <dt className="text-sm text-gray-500">Scopes</dt>
                  <dd className="text-sm text-gray-900">{connection.scopes.join(', ')}</dd>
                </div>
              )}
            </dl>
            <div className="flex gap-3">
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="btn btn-secondary"
              >
                {isTesting ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleDeleteConnection}
                disabled={isSaving}
                className="btn text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Remove Connection
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No Shopify store connected. Add your credentials below.
          </p>
        )}
      </div>

      {/* Connection Form */}
      <div className="mt-6 card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          {connection?.connected ? 'Update Credentials' : 'Connect Shopify Store'}
        </h3>
        <form onSubmit={handleSaveConnection} className="space-y-4">
          <div>
            <label htmlFor="storeUrl" className="block text-sm font-medium text-gray-700">
              Store URL
            </label>
            <input
              type="text"
              id="storeUrl"
              value={formData.storeUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, storeUrl: e.target.value }))}
              placeholder="yourstore.myshopify.com"
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be in format: yourstore.myshopify.com
            </p>
          </div>

          <div>
            <label htmlFor="accessToken" className="block text-sm font-medium text-gray-700">
              Admin API Access Token
            </label>
            <input
              type="password"
              id="accessToken"
              value={formData.accessToken}
              onChange={(e) => setFormData(prev => ({ ...prev, accessToken: e.target.value }))}
              placeholder={connection?.connected ? '••••••••' : 'shpat_xxxxx'}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              required={!connection?.connected}
            />
            <p className="mt-1 text-xs text-gray-500">
              Create a custom app in Shopify Admin → Apps → Develop apps. Required scopes: read_customers, read_orders
            </p>
          </div>

          <button type="submit" disabled={isSaving} className="btn btn-primary">
            {isSaving ? 'Saving...' : connection?.connected ? 'Update Credentials' : 'Connect Store'}
          </button>
        </form>
      </div>

      {/* Tier Configuration */}
      <div className="mt-6 card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Customer Tier Thresholds</h3>
        <p className="text-sm text-gray-500 mb-4">
          Configure the thresholds used to assign customer tiers based on LTV and sentiment.
        </p>
        <form onSubmit={handleSaveTierConfig} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="topMinLtv" className="block text-sm font-medium text-gray-700">
                Top Customer Min LTV ($)
              </label>
              <input
                type="number"
                id="topMinLtv"
                value={tierFormData.topMinLtv}
                onChange={(e) => setTierFormData(prev => ({ ...prev, topMinLtv: parseInt(e.target.value) }))}
                min={0}
                step={100}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Customers with LTV at or above this are "Top"</p>
            </div>

            <div>
              <label htmlFor="vipMinLtv" className="block text-sm font-medium text-gray-700">
                VIP Min LTV ($)
              </label>
              <input
                type="number"
                id="vipMinLtv"
                value={tierFormData.vipMinLtv}
                onChange={(e) => setTierFormData(prev => ({ ...prev, vipMinLtv: parseInt(e.target.value) }))}
                min={0}
                step={100}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Customers with LTV at or above this are "VIP"</p>
            </div>

            <div>
              <label htmlFor="atRiskMaxSentiment" className="block text-sm font-medium text-gray-700">
                At Risk Max Sentiment
              </label>
              <input
                type="number"
                id="atRiskMaxSentiment"
                value={tierFormData.atRiskMaxSentiment}
                onChange={(e) => setTierFormData(prev => ({ ...prev, atRiskMaxSentiment: parseFloat(e.target.value) }))}
                min={-1}
                max={0}
                step={0.1}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Customers below this sentiment score are "At Risk"</p>
            </div>
          </div>

          <div className="pt-4">
            <button type="submit" disabled={isSaving} className="btn btn-primary">
              {isSaving ? 'Saving...' : 'Save Tier Thresholds'}
            </button>
          </div>
        </form>
      </div>

      {/* Setup Instructions */}
      <div className="mt-6 card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Setup Instructions</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
          <li>
            Go to your Shopify Admin → Settings → Apps and sales channels → Develop apps
          </li>
          <li>Click "Create an app" and give it a name (e.g., "Conversation Analysis")</li>
          <li>
            Configure Admin API scopes:
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><code className="bg-gray-100 px-1 rounded">read_customers</code> - To fetch customer profiles</li>
              <li><code className="bg-gray-100 px-1 rounded">read_orders</code> - To calculate LTV and order history</li>
            </ul>
          </li>
          <li>Install the app and copy the Admin API access token</li>
          <li>Paste the token above along with your store URL</li>
          <li>Click "Test Connection" to verify everything works</li>
        </ol>
      </div>
    </DashboardLayout>
  );
}
