import type { DeadlineStatus } from '@/lib/formatting';

/** "Closing soon" / "Deadline passed" chip. Renders nothing when there is no label. */
export default function DeadlineBadge({ status, label }: {
  status: DeadlineStatus;
  label: string | null;
}) {
  if (!label) return null;
  const tone =
    status === 'closing-soon'
      ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
      : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800';
  return (
    <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ${tone}`}>
      {label}
    </span>
  );
}
