/** 不进口 pageData / manager。 */

import type { ReactNode } from 'react'
import { AnimatePresenceShim as AnimatePresence } from '@lib/motionShim'
import AnimatedView from '../../AnimatedView'
import { Spinner } from '../../Spinner'

export function BrewPage({
  lock,
  loading,
  children,
}: {
  lock: boolean
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <AnimatedView
      className={lock && !loading ? 'h-dvh overflow-hidden' : 'min-h-screen'}
    >
      <div
        className={
          loading
            ? 'h-full flex flex-col pt-20 pb-28 sm:pb-24 md:pb-12 px-3 xs:px-4 sm:px-6'
            : lock
              ? 'flex h-full min-h-0 flex-col overflow-visible px-3 pt-20 xs:px-4 sm:px-6'
              : 'h-full flex flex-col pt-20 pb-12 px-3 xs:px-4 sm:px-6'
        }
      >
        <div className="flex-1 max-w-7xl mx-auto w-full flex flex-col relative min-h-0">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </AnimatedView>
  )
}

export { AnimatePresence }
