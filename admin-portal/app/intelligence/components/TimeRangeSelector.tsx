import type { TimeRange } from '@/types/intelligence';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

const OPTIONS: { value: TimeRange; label: string }[] = [
  { value: 'last_24h', label: 'Last 24 Hours' },
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
];

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Select time range</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TimeRange)}
        className="block rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
