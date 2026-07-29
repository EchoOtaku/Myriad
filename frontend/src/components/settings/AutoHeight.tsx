import type { Key, ReactNode, TransitionEvent } from 'react'

import React from 'react'
import { prefersReducedMotion, SETTINGS_DURATION_MS } from './motion'
import './settings-motion.css'

export interface AutoHeightProps {
  /** 内容身份变化时，从更新前的实际高度过渡到新高度。 */
  contentKey: Key
  children: ReactNode
  className?: string
}

interface AutoHeightState {
  height?: number
  animating: boolean
}

/**
 * 在 DOM 更新前记录旧高度，再在新内容挂载后测量目标高度。
 * 动画结束会恢复 height: auto，后续异步内容仍可自然撑开。
 */
export class AutoHeight extends React.PureComponent<
  AutoHeightProps,
  AutoHeightState
> {
  state: AutoHeightState = {
    height: undefined,
    animating: false,
  }

  private wrapperRef = React.createRef<HTMLDivElement>()
  private contentRef = React.createRef<HTMLDivElement>()
  private frameId?: number
  private measureTimerId?: number
  private timerId?: number

  getSnapshotBeforeUpdate(previousProps: AutoHeightProps): number | null {
    if (previousProps.contentKey === this.props.contentKey) return null
    return this.wrapperRef.current?.getBoundingClientRect().height ?? null
  }

  componentDidUpdate(
    previousProps: AutoHeightProps,
    _previousState: AutoHeightState,
    previousHeight: number | null,
  ) {
    if (
      previousProps.contentKey === this.props.contentKey ||
      previousHeight == null
    ) {
      return
    }

    if (prefersReducedMotion()) {
      this.finish()
      return
    }

    this.clearSchedule()
    this.setState(
      {
        height: previousHeight,
        animating: false,
      },
      () => {
        /*
         * 新面板挂载后先留一个短暂稳定窗口，让同步 effect、缓存读取和
         * 本地接口响应有机会把首屏内容撑开，避免测到半成品高度。
         */
        this.measureTimerId = window.setTimeout(() => {
          this.frameId = window.requestAnimationFrame(() => {
            const targetHeight =
              this.contentRef.current?.getBoundingClientRect().height
            if (
              targetHeight == null ||
              Math.abs(targetHeight - previousHeight) < 1
            ) {
              this.finish()
              return
            }

            this.setState({
              height: targetHeight,
              animating: true,
            })
            this.timerId = window.setTimeout(
              this.finish,
              SETTINGS_DURATION_MS.slow + 80,
            )
          })
        }, SETTINGS_DURATION_MS.fast)
      },
    )
  }

  componentWillUnmount() {
    this.clearSchedule()
  }

  private clearSchedule = () => {
    window.cancelAnimationFrame(this.frameId ?? 0)
    window.clearTimeout(this.measureTimerId)
    window.clearTimeout(this.timerId)
  }

  private finish = () => {
    this.clearSchedule()
    this.setState({
      height: undefined,
      animating: false,
    })
  }

  private handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.propertyName !== 'height') return
    this.finish()
  }

  render() {
    const { children, className = '' } = this.props
    const { height, animating } = this.state

    return (
      <div
        ref={this.wrapperRef}
        className={`sm-auto-height ${className}`.trim()}
        data-height={
          height == null ? undefined : animating ? 'animating' : 'measuring'
        }
        style={height == null ? undefined : { height: `${height}px` }}
        onTransitionEnd={this.handleTransitionEnd}
      >
        <div ref={this.contentRef} className="sm-auto-height-content">
          {children}
        </div>
      </div>
    )
  }
}

export default AutoHeight
