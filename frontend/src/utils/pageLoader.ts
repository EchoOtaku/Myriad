class PageLoader {
  private loader: HTMLElement | null
  private appRoot: HTMLElement | null
  private isShowing: boolean = true
  private hideTimeout: number | null = null
  private isAppReady: boolean = false

  constructor() {
    this.loader = document.getElementById('page-loader')
    this.appRoot = null
  }

  show(): void {
    if (!this.loader) return

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
      this.hideTimeout = null
    }

    this.loader.classList.remove('hidden')
    this.loader.setAttribute('aria-busy', 'true')
    this.isShowing = true
    this.isAppReady = false

    if (this.appRoot) {
      this.appRoot.classList.remove('app-ready')
    }
  }

  markAppReady(): void {
    if (this.isAppReady) return
    this.isAppReady = true

    this.appRoot = document.getElementById('app-root')

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.appRoot) {
          this.appRoot.classList.add('app-ready')
          /* 过渡完去掉 opacity/transition，避免 Safari 合成层导致 fixed 子元素画不出。用 setTimeout，transitionend 可能被其他属性先触发。 */
          const appRootRef = this.appRoot
          setTimeout(() => {
            if (appRootRef) {
              appRootRef.style.opacity = '1'
              appRootRef.style.transition = 'none'
            }
          }, 600)
        }

        this.hide(50)
      })
    })
  }

  hide(delay: number = 200): void {
    if (!this.loader) return

    this.hideTimeout = window.setTimeout(() => {
      if (this.loader) {
        this.loader.classList.add('hidden')
        this.loader.setAttribute('aria-busy', 'false')
        this.isShowing = false
      }
    }, delay)
  }

  isActive(): boolean {
    return this.isShowing
  }

  isReady(): boolean {
    return this.isAppReady
  }
}

export function initPageLoader() {
  ;(window as any).pageLoader = new PageLoader()
}
