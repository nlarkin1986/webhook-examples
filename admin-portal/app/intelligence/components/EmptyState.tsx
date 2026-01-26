import Link from 'next/link';

interface EmptyStateProps {
  message: string;
  description?: string;
  variant?: 'default' | 'error' | 'positive';
  action?: {
    label: string;
    href: string;
  };
}

export default function EmptyState({
  message,
  description,
  variant = 'default',
  action,
}: EmptyStateProps) {
  const styles = {
    default: 'bg-gray-50 border-gray-200',
    error: 'bg-red-50 border-red-200',
    positive: 'bg-green-50 border-green-200',
  };

  const textStyles = {
    default: 'text-gray-500',
    error: 'text-red-600',
    positive: 'text-green-600',
  };

  return (
    <div
      className={`rounded-lg border p-8 text-center ${styles[variant]}`}
      role="status"
      aria-live="polite"
    >
      <p className={`text-lg font-medium ${textStyles[variant]}`}>
        {message}
      </p>
      {description && (
        <p className="mt-2 text-sm text-gray-500">{description}</p>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
