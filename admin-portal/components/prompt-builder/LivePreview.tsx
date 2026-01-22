'use client';

import { useMemo } from 'react';
import { GuidedConfig, TONE_OPTIONS, SCENARIO_OPTIONS } from '@/lib/schemas/guided-config';

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: 'Maintain a professional, authoritative tone. Use formal language and industry-standard terminology.',
  friendly: 'Be warm, approachable, and conversational. Use positive language and show genuine care.',
  casual: 'Use a relaxed, informal style. Feel free to use contractions and everyday language.',
  empathetic: 'Lead with understanding and validation. Acknowledge feelings before problem-solving.',
  efficient: 'Be direct and solution-focused. Minimize small talk while remaining polite.',
};

interface LivePreviewProps {
  config: GuidedConfig | undefined;
}

export function LivePreview({ config }: LivePreviewProps) {
  const compiled = useMemo(() => {
    if (!config?.brand?.name) {
      return '# Preview\n\nEnter your brand name to see the generated prompt.';
    }

    const { brand, scenarios } = config;
    const parts: string[] = [];

    parts.push(`You are an AI customer service assistant for ${brand.name}, a retail company.`);
    parts.push('');
    parts.push('## Communication Style');
    parts.push(TONE_DESCRIPTIONS[brand.tone] || TONE_DESCRIPTIONS.friendly);
    parts.push('');
    parts.push('## Industry Context');
    parts.push('Focus on product availability, pricing, promotions, and in-store/online shopping experience.');
    parts.push('');
    parts.push('## Scenario Handling');

    if (scenarios) {
      for (const scenario of SCENARIO_OPTIONS) {
        const scenarioConfig = scenarios[scenario.key];
        if (scenarioConfig?.enabled !== false) {
          parts.push('');
          parts.push(`### ${scenario.name}`);
          parts.push(scenario.description);
        }
      }
    }

    return parts.join('\n');
  }, [config]);

  const charCount = compiled.length;

  return (
    <div className="sticky top-4">
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-white font-medium">Live Preview</h3>
          <span className="text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded">
            {charCount} chars
          </span>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <pre className="text-green-400 text-sm font-mono whitespace-pre-wrap leading-relaxed">
            {compiled}
          </pre>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500 text-center">
        This prompt will be used by your AI assistant to handle customer conversations.
      </p>
    </div>
  );
}
