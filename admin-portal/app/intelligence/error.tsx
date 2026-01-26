'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Intelligence dashboard error:', error);
  }, [error]);

  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <h2 className="text-lg font-semibold text-red-800">
        Failed to load Intelligence Dashboard
      </h2>
      <p className="mt-2 text-sm text-red-600">{error.message}</p>
      <button
        onClick={reset}
        className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Try again
      </button>
    </div>
  );
}
