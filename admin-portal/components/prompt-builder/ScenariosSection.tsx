'use client';

import { useFormContext, Controller } from 'react-hook-form';
import { GuidedConfig, SCENARIO_OPTIONS, Scenarios } from '@/lib/schemas/guided-config';

export function ScenariosSection() {
  const { control, watch } = useFormContext<GuidedConfig>();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Scenarios</h2>
      <p className="text-sm text-gray-500 mb-4">
        Enable the scenarios your AI assistant should handle. Disabled scenarios will be escalated to human agents.
      </p>

      <div className="space-y-3">
        {SCENARIO_OPTIONS.map((scenario) => {
          const isEnabled = watch(`scenarios.${scenario.key}.enabled`);

          return (
            <div
              key={scenario.key}
              className={`flex items-start gap-4 p-4 rounded-lg border transition-all ${
                isEnabled
                  ? 'border-gray-200 bg-white'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              <Controller
                name={`scenarios.${scenario.key}.enabled`}
                control={control}
                render={({ field }) => (
                  <label className="relative inline-flex items-center cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                )}
              />

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{scenario.name}</h3>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                    intent: {scenario.intentCategory}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">{scenario.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
