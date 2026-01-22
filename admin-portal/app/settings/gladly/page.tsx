'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { gladlyApi, tenantApi } from '@/lib/api';

export default function GladlyConnectionPage() {
  const { token } = useAuth();
  const [connection, setConnection] = useState<any>(null);
  const [webhookData, setWebhookData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [gladlyHost, setGladlyHost] = useState('');
  const [gladlyUsername, setGladlyUsername] = useState('');
  const [gladlyApiToken, setGladlyApiToken] = useState('');

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    try {
      const [connectionData, webhookInfo]: any[] = await Promise.all([
        gladlyApi.getConnection(token!),
        tenantApi.getWebhookUrl(token!)
      ]);

      setConnection(connectionData);
      setWebhookData(webhookInfo);

      if (connectionData.connected) {
        setGladlyHost(connectionData.gladlyHost || '');
        setGladlyUsername(connectionData.gladlyUsername || '');
      }
    } catch (error) {
      console.error('Failed to load connection:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsSaving(true);

    try {
      const result: any = await gladlyApi.saveConnection(token!, {
        gladlyHost,
        gladlyUsername,
        gladlyApiToken
      });

      setConnection({
        connected: true,
        gladlyHost: result.gladlyHost,
        gladlyUsername: result.gladlyUsername,
        status: result.status
      });

      setGladlyApiToken(''); // Clear token from form

      if (result.testResult?.success) {
        setMessage({ type: 'success', text: `Connected to ${result.testResult.organization || 'Gladly'}!` });
      } else {
        setMessage({ type: 'error', text: result.testResult?.error || 'Connection saved but verification failed' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setMessage(null);
    setIsTesting(true);

    try {
      const result = await gladlyApi.testConnection(token!);

      if (result.success) {
        setMessage({ type: 'success', text: `Connection verified! Organization: ${result.organization}` });
        setConnection((prev: any) => ({ ...prev, status: 'verified' }));
      } else {
        setMessage({ type: 'error', text: result.error || 'Connection test failed' });
        setConnection((prev: any) => ({ ...prev, status: 'failed' }));
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove the Gladly connection?')) {
      return;
    }

    try {
      await gladlyApi.deleteConnection(token!);
      setConnection({ connected: false });
      setGladlyHost('');
      setGladlyUsername('');
      setMessage({ type: 'success', text: 'Connection removed' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
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
        <h1 className="text-2xl font-semibold text-gray-900">Gladly Connection</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connect your Gladly workspace to enable conversation analysis
        </p>
      </div>

      {message && (
        <div className={`mt-6 p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Connection Status */}
      {connection?.connected && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Current Connection</h3>
              <p className="text-sm text-gray-500">{connection.gladlyHost}</p>
              <p className="text-sm text-gray-500">User: {connection.gladlyUsername}</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className={`status-badge ${connection.status === 'verified' ? 'status-success' : connection.status === 'failed' ? 'status-error' : 'status-warning'}`}>
                {connection.status || 'Unknown'}
              </span>
              <button onClick={handleTest} disabled={isTesting} className="btn btn-secondary">
                {isTesting ? 'Testing...' : 'Test'}
              </button>
              <button onClick={handleDelete} className="btn btn-danger">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Form */}
      <div className="mt-6 card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          {connection?.connected ? 'Update Credentials' : 'Connect to Gladly'}
        </h3>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="gladlyHost" className="form-label">
              Gladly Host
            </label>
            <input
              id="gladlyHost"
              type="text"
              value={gladlyHost}
              onChange={(e) => setGladlyHost(e.target.value)}
              className="form-input"
              placeholder="company.gladly.com"
              required
            />
            <p className="mt-1 text-sm text-gray-500">Your Gladly workspace URL</p>
          </div>

          <div>
            <label htmlFor="gladlyUsername" className="form-label">
              API Username
            </label>
            <input
              id="gladlyUsername"
              type="email"
              value={gladlyUsername}
              onChange={(e) => setGladlyUsername(e.target.value)}
              className="form-input"
              placeholder="api-user@company.com"
              required
            />
            <p className="mt-1 text-sm text-gray-500">The email of an API user in Gladly</p>
          </div>

          <div>
            <label htmlFor="gladlyApiToken" className="form-label">
              API Token
            </label>
            <input
              id="gladlyApiToken"
              type="password"
              value={gladlyApiToken}
              onChange={(e) => setGladlyApiToken(e.target.value)}
              className="form-input"
              placeholder={connection?.connected ? '••••••••••••••••' : 'Enter API token'}
              required={!connection?.connected}
            />
            <p className="mt-1 text-sm text-gray-500">
              {connection?.connected
                ? 'Leave blank to keep existing token'
                : 'Generate from Gladly Settings → API Tokens'}
            </p>
          </div>

          <div className="pt-4">
            <button type="submit" disabled={isSaving} className="btn btn-primary">
              {isSaving ? 'Saving...' : 'Save & Test Connection'}
            </button>
          </div>
        </form>
      </div>

      {/* Webhook Setup */}
      {webhookData && (
        <div className="mt-6 card">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Webhook Setup</h3>

          <div className="mb-4">
            <label className="form-label">Your Webhook URL</label>
            <div className="flex items-center space-x-2">
              <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono">
                {webhookData.webhookUrl}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(webhookData.webhookUrl)}
                className="btn btn-secondary"
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-gray-900 mb-2">Setup Instructions</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
              {webhookData.instructions?.map((instruction: string, index: number) => (
                <li key={index}>{instruction}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
