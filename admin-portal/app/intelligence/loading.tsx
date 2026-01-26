export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading intelligence dashboard">
      {/* Header Skeleton */}
      <div className="flex justify-between items-start">
        <div>
          <div className="h-8 w-64 bg-gray-200 rounded" />
          <div className="mt-2 h-4 w-96 bg-gray-200 rounded" />
        </div>
        <div className="h-10 w-32 bg-gray-200 rounded" />
      </div>

      {/* Tabs Skeleton */}
      <div className="border-b border-gray-200 pb-4">
        <div className="flex gap-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 w-20 bg-gray-200 rounded" />
          ))}
        </div>
      </div>

      {/* KPI Cards Skeleton */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white shadow rounded-lg p-6">
            <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-8 w-20 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
