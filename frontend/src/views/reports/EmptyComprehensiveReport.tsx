/**
 * 综合报告空状态占位组件
 */

import { FaMagic } from '@lib/icons'
import { motionShim as motion } from '@lib/motionShim'
import { useI18n } from '../../contexts/I18nContext'

interface EmptyComprehensiveReportProps {
  isAdmin: boolean
  isPageReady: boolean
}

export function EmptyComprehensiveReport({
  isAdmin,
  isPageReady,
}: EmptyComprehensiveReportProps) {
  const { t } = useI18n()
  const description = isAdmin
    ? t.reportsPage.useInputToGenerate
    : t.reportsPage.adminNotGenerated

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden min-h-55"
      initial={{ opacity: 0, y: 12 }}
      animate={
        isPageReady ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }
      }
      transition={{
        duration: 0.3,
        delay: isPageReady ? 0.15 : 0,
      }}
    >
      <div className="absolute inset-0 bg-white/70 dark:bg-black/80 backdrop-blur-xl" />
      <div
        className="absolute -right-20 -top-20 w-48 h-48 rounded-full blur-3xl opacity-20"
        style={{ background: 'var(--color-accent)' }}
      />
      <div
        className="absolute -left-16 -bottom-16 w-32 h-32 rounded-full blur-2xl opacity-15"
        style={{ background: 'var(--color-accent)' }}
      />

      <div className="relative z-10 h-full p-8 md:p-12 text-center flex flex-col items-center justify-center">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-linear-to-br from-gray-100 to-gray-200 dark:from-white/10 dark:to-white/5 flex items-center justify-center shadow-lg">
          <FaMagic className="w-10 h-10 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
          {t.reportsPage.noComprehensiveReport}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm mx-auto leading-6">
          {description}
        </p>
      </div>

      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-black/5 dark:ring-white/10 pointer-events-none" />
    </motion.div>
  )
}
