'use client';

import { useFormContext } from 'react-hook-form';
import { GuidedConfig, TONE_OPTIONS, Tone } from '@/lib/schemas/guided-config';

export function BrandVoiceSection() {
  const { register, watch, setValue, formState: { errors } } = useFormContext<GuidedConfig>();
  const currentTone = watch('brand.tone');

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Brand & Voice</h2>

      {/* Brand Name */}
      <div className="mb-6">
        <label htmlFor="brandName" className="block text-sm font-medium text-gray-700 mb-2">
          Brand Name
        </label>
        <input
          id="brandName"
          type="text"
          {...register('brand.name')}
          placeholder="e.g., Acme Retail"
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          maxLength={100}
        />
        {errors.brand?.name && (
          <p className="mt-1 text-sm text-red-600">{errors.brand.name.message}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Your brand name will appear in the AI assistant's introduction.
        </p>
      </div>

      {/* Tone Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          How should your AI assistant communicate?
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {TONE_OPTIONS.map((tone) => (
            <button
              key={tone.value}
              type="button"
              onClick={() => setValue('brand.tone', tone.value)}
              className={`flex flex-col items-center p-4 rounded-lg border-2 cursor-pointer transition-all ${
                currentTone === tone.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <span className="text-2xl mb-2">{tone.icon}</span>
              <span className="font-medium text-sm text-gray-900">{tone.label}</span>
              <span className="text-xs text-gray-500 text-center mt-1">{tone.description}</span>
            </button>
          ))}
        </div>
        {errors.brand?.tone && (
          <p className="mt-2 text-sm text-red-600">{errors.brand.tone.message}</p>
        )}
      </div>
    </div>
  );
}
