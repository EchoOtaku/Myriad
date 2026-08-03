/**
 * Tapp (and shared page) route animation metadata.
 * Single table for App.tsx AnimatedPage — avoid path-string if-forests.
 */

export type PageAnimationStyle = 'normal' | 'fixed'

/** Which motion variant set AnimatedPage applies */
export type PageAnimationVariant = 'page' | 'fixed' | 'detail'

export interface PageRouteAnimationMeta {
  /** AnimatePresence key (shared key = no remount between siblings) */
  key: string
  style: PageAnimationStyle
  variant: PageAnimationVariant
  /** Skip window.scrollTo on enter (overlay / stacked transitions) */
  skipScroll: boolean
}

/**
 * Resolve enter/exit policy for a pathname.
 * Behavior must stay stable — only the lookup is centralized.
 */
export function resolvePageRouteAnimation(
  pathname: string,
): PageRouteAnimationMeta {
  // Brew siblings share one shell
  if (pathname.startsWith('/brew')) {
    return {
      key: '/brew',
      style: 'normal',
      variant: 'page',
      skipScroll: false,
    }
  }

  // Full-screen Tapp shells (iframe / store panel): fixed wrapper, page enter off
  if (pathname.startsWith('/tapp/run')) {
    return {
      key: pathname,
      style: 'fixed',
      variant: 'fixed',
      skipScroll: true,
    }
  }
  if (pathname === '/tapp/store') {
    return {
      key: pathname,
      style: 'fixed',
      variant: 'fixed',
      skipScroll: true,
    }
  }

  // Detail: fixed overlay (sync under list/run) + shell presence enter/exit.
  // overflow:auto on wrapper so settings page still scrolls.
  if (pathname.startsWith('/tapp/detail')) {
    return {
      key: pathname,
      style: 'fixed',
      variant: 'detail',
      skipScroll: true,
    }
  }

  // List / playground — document scroll; allow scrollTo on enter (not under overlay)
  if (pathname === '/tapp') {
    return {
      key: '/tapp',
      style: 'normal',
      variant: 'page',
      skipScroll: false,
    }
  }
  if (pathname === '/tapp/playground') {
    return {
      key: pathname,
      style: 'normal',
      variant: 'page',
      skipScroll: false,
    }
  }
  if (pathname.startsWith('/tapp/')) {
    return {
      key: pathname,
      style: 'normal',
      variant: 'page',
      skipScroll: false,
    }
  }

  return {
    key: pathname,
    style: 'normal',
    variant: 'page',
    skipScroll: false,
  }
}
