'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/lib/auth';
import { configApi, gladlyApi } from '@/lib/api';

export default function AgentConfigPage() {
  const { token } = useAuth();
  const [config, setConfig] = useState<any>(null);
  const [models, setModels] = useState<any>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [gladlyTopics, setGladlyTopics] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'tools' | 'prompts'>('general');

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    try {
      const [configData, modelsData, toolsData]: any[] = await Promise.all([
        configApi.get(token!),
        configApi.getModels(token!),
        configApi.getTools(token!)
      ]);

      setConfig(configData);
      setModels(modelsData);
      setTools(toolsData.tools);

      // Try to load Gladly topics for mapping
      try {
        const topicsData = await gladlyApi.listTopics(token!);
        setGladlyTopics(topicsData.topics);
      } catch {
        // Connection might not be set up yet
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (updates: object) => {
    setMessage(null);
    setIsSaving(true);

    try {
      const updatedConfig = await configApi.update(token!, updates);
      setConfig(updatedConfig);
      setMessage({ type: 'success', text: 'Configuration saved' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all configuration to defaults?')) return;

    setMessage(null);
    setIsSaving(true);

    try {
      const result: any = await configApi.reset(token!);
      setConfig(result.config);
      setMessage({ type: 'success', text: 'Configuration reset to defaults' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToolToggle = (toolName: string, enabled: boolean) => {
    const newTools = enabled
      ? [...config.enabledTools, toolName]
      : config.enabledTools.filter((t: string) => t !== toolName);
    handleSave({ enabledTools: newTools });
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Agent Configuration</h1>
            <p className="mt-1 text-sm text-gray-600">
              Customize how the AI analyzes your conversations
            </p>
          </div>
          <button onClick={handleReset} className="btn btn-secondary">
            Reset to Defaults
          </button>
        </div>
      </div>

      {message && (
        <div className={`mt-6 p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {(['general', 'tools', 'prompts'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <div className="mt-6 space-y-6">
          {/* Model Selection */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Model Selection</h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="form-label">Orchestrator Model</label>
                <select
                  value={config?.orchestratorModel}
                  onChange={(e) => handleSave({ orchestratorModel: e.target.value })}
                  className="form-input"
                  disabled={isSaving}
                >
                  {models?.orchestrator.map((model: string) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">Main agent coordinating the analysis</p>
              </div>

              <div>
                <label className="form-label">Specialist Model</label>
                <select
                  value={config?.specialistModel}
                  onChange={(e) => handleSave({ specialistModel: e.target.value })}
                  className="form-input"
                  disabled={isSaving}
                >
                  {models?.specialist.map((model: string) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">Sentiment and intent analysis</p>
              </div>
            </div>
          </div>

          {/* Behavior Settings */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Behavior Settings</h3>

            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config?.autoApplyTopics}
                  onChange={(e) => handleSave({ autoApplyTopics: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  disabled={isSaving}
                />
                <span className="ml-2 text-sm text-gray-700">
                  Automatically apply detected topics to conversations
                </span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config?.addAnalysisNote}
                  onChange={(e) => handleSave({ addAnalysisNote: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  disabled={isSaving}
                />
                <span className="ml-2 text-sm text-gray-700">
                  Add analysis summary as a note to the conversation
                </span>
              </label>
            </div>
          </div>

          {/* Sentiment Thresholds */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Sentiment Thresholds</h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="form-label">Negative Threshold</label>
                <input
                  type="range"
                  min="-1"
                  max="0"
                  step="0.1"
                  value={config?.sentimentThresholdNegative || -0.3}
                  onChange={(e) => handleSave({ sentimentThresholdNegative: parseFloat(e.target.value) })}
                  className="w-full"
                  disabled={isSaving}
                />
                <p className="text-sm text-gray-500">
                  Below {config?.sentimentThresholdNegative} = Negative
                </p>
              </div>

              <div>
                <label className="form-label">Positive Threshold</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config?.sentimentThresholdPositive || 0.3}
                  onChange={(e) => handleSave({ sentimentThresholdPositive: parseFloat(e.target.value) })}
                  className="w-full"
                  disabled={isSaving}
                />
                <p className="text-sm text-gray-500">
                  Above {config?.sentimentThresholdPositive} = Positive
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools Tab */}
      {activeTab === 'tools' && (
        <div className="mt-6 card">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Enabled Tools</h3>
          <p className="text-sm text-gray-500 mb-4">
            Select which tools the AI agent can use during analysis
          </p>

          <div className="space-y-3">
            {tools.map((tool) => (
              <label key={tool.name} className="flex items-start">
                <input
                  type="checkbox"
                  checked={config?.enabledTools?.includes(tool.name)}
                  onChange={(e) => handleToolToggle(tool.name, e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-0.5"
                  disabled={isSaving}
                />
                <div className="ml-3">
                  <span className="text-sm font-medium text-gray-700">{tool.name}</span>
                  <p className="text-sm text-gray-500">{tool.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Prompts Tab */}
      {activeTab === 'prompts' && (
        <div className="mt-6 space-y-6">
          {/* Prompt Builder CTA */}
          <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">AI Prompt Builder</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Configure your AI assistant with an easy-to-use visual builder. No prompt engineering required.
                </p>
              </div>
              <a
                href="/settings/prompt-builder"
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                Open Prompt Builder
              </a>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Custom System Prompts (Advanced)</h3>
            <p className="text-sm text-gray-500 mb-4">
              Leave blank to use default prompts. Custom prompts override the Prompt Builder configuration.
            </p>

            <div className="space-y-4">
              <div>
                <label className="form-label">Orchestrator System Prompt</label>
                <textarea
                  value={config?.orchestratorSystemPrompt || ''}
                  onChange={(e) => handleSave({ orchestratorSystemPrompt: e.target.value || null })}
                  className="form-input h-32 font-mono text-sm"
                  placeholder="Enter custom orchestrator prompt..."
                  disabled={isSaving}
                />
              </div>

              <div>
                <label className="form-label">Sentiment Analysis Prompt</label>
                <textarea
                  value={config?.sentimentSystemPrompt || ''}
                  onChange={(e) => handleSave({ sentimentSystemPrompt: e.target.value || null })}
                  className="form-input h-32 font-mono text-sm"
                  placeholder="Enter custom sentiment analysis prompt..."
                  disabled={isSaving}
                />
              </div>

              <div>
                <label className="form-label">Intent Classification Prompt</label>
                <textarea
                  value={config?.intentSystemPrompt || ''}
                  onChange={(e) => handleSave({ intentSystemPrompt: e.target.value || null })}
                  className="form-input h-32 font-mono text-sm"
                  placeholder="Enter custom intent classification prompt..."
                  disabled={isSaving}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
