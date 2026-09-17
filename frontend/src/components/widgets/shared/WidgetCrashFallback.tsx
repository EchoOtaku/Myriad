export function WidgetCrashFallback({
  message,
  retryLabel,
  onRetry,
  detail,
}: {
  message: string
  retryLabel?: string
  onRetry?: () => void
  detail?: string
}) {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl bg-black/5 px-2 text-center dark:bg-white/10"
    >
      <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
        {message}
      </p>
      {detail ? (
        <p className="max-w-full truncate text-[10px] text-gray-400 dark:text-gray-500">
          {detail}
        </p>
      ) : null}
      {onRetry && retryLabel ? (
        <button
          type="button"
          className="text-[10px] font-medium text-gray-700 dark:text-gray-200"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}

export function widgetCrashDetail(error: Error | null): string | undefined {
  return import.meta.env.DEV ? (error?.message ?? undefined) : undefined
}
