/** One timeline for the whole card; transform stays eligible for native animation. */
export const widgetEntranceMotion = {
  hidden: { opacity: 0, transform: 'translateY(14px) scale(0.9)' },
  visible: { opacity: 1, transform: 'translateY(0px) scale(1)' },
  exit: { opacity: 0, transform: 'translateY(0px) scale(0.9)' },
  transition: {
    type: 'tween',
    duration: 0.56,
    ease: [0.25, 0.1, 0.25, 1],
  },
} as const
