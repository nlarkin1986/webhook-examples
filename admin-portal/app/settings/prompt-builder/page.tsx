'use client';

import { useState, useEffect } from 'react';
import { useForm, useWatch, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/lib/auth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { BrandVoiceSection } from '@/components/prompt-builder/BrandVoiceSection';
import { ScenariosSection } from '@/components/prompt-builder/ScenariosSection';
import { LivePreview } from '@/components/prompt-builder/LivePreview';
import { guidedConfigSchema, type GuidedConfig } from '@/lib/schemas/guided-config';

const DEFAULT_CONFIG: GuidedConfig = {
  brand: { name: '', tone: 'friendly' },
  scenarios: {
    order_tracking: { enabled: true },
    returns: { enabled: true },
    product_questions: { enabled: true },
    complaints: { enabled: true },
  },
};

export default function PromptBuilderPage() {
  const { token } = useAuth();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const form = useForm<GuidedConfig>({
    resolver: zodResolver(guidedConfigSchema),
    defaultValues: DEFAULT_CONFIG,
  });

  useEffect(() => {
    if (!token) return;

    const loadConfig = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
        const response = await fetch(`${apiUrl}/api/admin/config`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.guidedConfig && Object.keys(data.guidedConfig).length > 0) {
            form.reset({
              brand: {
                name: data.guidedConfig.brand?.name || '',
                tone: data.guidedConfig.brand?.tone || 'friendly',
              },
              scenarios: {
                order_tracking: { enabled: data.guidedConfig.scenarios?.order_tracking?.enabled ?? true },
                returns: { enabled: data.guidedConfig.scenarios?.returns?.enabled ?? true },
                product_questions: { enabled: data.guidedConfig.scenarios?.product_questions?.enabled ?? true },
                complaints: { enabled: data.guidedConfig.scenarios?.complaints?.enabled ?? true },
              },
            });
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [token, form]);

  const watchedValues = useWatch({ control: form.control });
  const debouncedValues = useDebouncedValue(watchedValues as GuidedConfig, 300);

  const onSubmit = async (data: GuidedConfig) => {
    setSaving(true);
    setSaveStatus('idle');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
      const response = await fetch(`${apiUrl}/api/admin/config/guided`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ guidedConfig: data }),
      });

      if (!response.ok) {
        throw new Error('Failed to save configuration');
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <nav className="text-sm text-gray-500 mb-2">
            <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
            <span className="mx-2">/</span>
            <a href="/settings/config" className="hover:text-gray-700">Settings</a>
            <span className="mx-2">/</span>
            <span className="text-gray-900">Prompt Builder</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">AI Prompt Builder</h1>
          <p className="mt-1 text-gray-500">
            Configure how your AI assistant communicates with customers.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Configuration Panel (2 cols) */}
              <div className="lg:col-span-2 space-y-6">
                <BrandVoiceSection />
                <ScenariosSection />

                {/* Save Button */}
                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={saving || !form.formState.isValid}
                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save Configuration'}
                  </button>

                  {saveStatus === 'success' && (
                    <span className="text-green-600 text-sm">Configuration saved successfully!</span>
                  )}
                  {saveStatus === 'error' && (
                    <span className="text-red-600 text-sm">Failed to save. Please try again.</span>
                  )}
                </div>
              </div>

              {/* Live Preview Panel (1 col, sticky) */}
              <div className="lg:col-span-1">
                <LivePreview config={debouncedValues as GuidedConfig} />
              </div>
            </div>
          </form>
        </FormProvider>
        )}
      </div>
    </div>
  );
}
