'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  date: string;
  volume: number;
}

interface TrendLineChartProps {
  data: DataPoint[];
}

export default function TrendLineChart({ data }: TrendLineChartProps) {
  // Memoize gradient ID to prevent re-renders
  const gradientId = useMemo(() => `gradient-${Math.random().toString(36).substr(2, 9)}`, []);

  // Check for reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        role="img"
        aria-label={`Topic volume chart showing ${data.length} data points`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={{ fill: '#6b7280', fontSize: 12 }}
          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: '#6b7280', fontSize: 12 }}
          tickFormatter={(value) => value.toLocaleString()}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1f2937',
            border: 'none',
            borderRadius: '8px',
            color: '#f9fafb',
          }}
          labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          formatter={(value) => [typeof value === 'number' ? value.toLocaleString() : value, 'Volume']}
        />
        <Area
          type="monotone"
          dataKey="volume"
          stroke="#6366f1"
          strokeWidth={2}
          fillOpacity={1}
          fill={`url(#${gradientId})`}
          isAnimationActive={!prefersReducedMotion}
          animationDuration={750}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
