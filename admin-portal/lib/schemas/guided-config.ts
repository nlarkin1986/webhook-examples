import { z } from 'zod';

export const toneSchema = z.enum([
  'professional',
  'friendly',
  'casual',
  'empathetic',
  'efficient',
]);

export const scenarioConfigSchema = z.object({
  enabled: z.boolean(),
});

export const scenariosSchema = z.object({
  order_tracking: scenarioConfigSchema,
  returns: scenarioConfigSchema,
  product_questions: scenarioConfigSchema,
  complaints: scenarioConfigSchema,
});

export const brandSchema = z.object({
  name: z.string().min(1, 'Brand name is required').max(100, 'Brand name must be 100 characters or less'),
  tone: toneSchema,
});

export const guidedConfigSchema = z.object({
  brand: brandSchema,
  scenarios: scenariosSchema,
});

export type Tone = z.infer<typeof toneSchema>;
export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>;
export type Scenarios = z.infer<typeof scenariosSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type GuidedConfig = z.infer<typeof guidedConfigSchema>;

export const TONE_OPTIONS: { value: Tone; label: string; icon: string; description: string }[] = [
  { value: 'professional', label: 'Professional', icon: '👔', description: 'Formal & authoritative' },
  { value: 'friendly', label: 'Friendly', icon: '😊', description: 'Warm & approachable' },
  { value: 'casual', label: 'Casual', icon: '🤙', description: 'Relaxed & informal' },
  { value: 'empathetic', label: 'Empathetic', icon: '💚', description: 'Understanding first' },
  { value: 'efficient', label: 'Efficient', icon: '⚡', description: 'Direct & solution-focused' },
];

export const SCENARIO_OPTIONS: { key: keyof Scenarios; name: string; description: string; intentCategory: string }[] = [
  {
    key: 'order_tracking',
    name: 'Order Tracking',
    description: 'Help customers locate and understand their order status.',
    intentCategory: 'order',
  },
  {
    key: 'returns',
    name: 'Returns & Exchanges',
    description: 'Guide customers through the return process.',
    intentCategory: 'returns',
  },
  {
    key: 'product_questions',
    name: 'Product Questions',
    description: 'Answer product inquiries with accurate information.',
    intentCategory: 'question',
  },
  {
    key: 'complaints',
    name: 'Complaints',
    description: 'Acknowledge concerns and work toward resolution.',
    intentCategory: 'complaint',
  },
];
