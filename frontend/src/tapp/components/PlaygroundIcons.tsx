/**
 * Tapp Playground 专用线性图标（stroke = currentColor）
 * 语义化设计，替代通用的 sparkles/magic 图标
 */

interface IconProps {
  className?: string
  style?: React.CSSProperties
}

/** 应用窗口 + 生成火花：「用 AI 构建 Tapp」 */
export function TappPlaygroundIcon({ className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* 应用窗口（带标题栏） */}
      <rect x="3" y="6" width="13" height="13" rx="3" />
      <path d="M3 10.5h13" />
      {/* 右上角的生成火花 */}
      <path
        d="M18.5 2.5l.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  )
}

/** 时间线列表：「生成过程 / Agent 工作轨迹」 */
export function PlaygroundTraceIcon({ className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="5.5" cy="5" r="1.75" />
      <circle cx="5.5" cy="12" r="1.75" />
      <circle cx="5.5" cy="19" r="1.75" />
      <path d="M5.5 6.75v3.5M5.5 13.75v3.5" />
      <path d="M10.5 5H20M10.5 12H20M10.5 19H20" />
    </svg>
  )
}
