import type { LifeOnboardingTag, OnboardingHeaderChrome } from '../onboardingTypes'
import { useEffect, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { agentService } from '../../../../services/agent'
import { ApiError } from '../../../../services/api'
import { uniqPersonaTags } from '../../personaTags'
import {
  generationCacheKey,
  getGenerationCache,
  setGenerationCache,
} from '../generationCache'
import BubbleCanvas from '../ui/BubbleCanvas'
import { ActionBar, GhostButton, PrimaryButton } from '../ui/Chrome'
import { ErrorNote, Working } from '../ui/Feedback'

interface SignalsCache {
  tags: LifeOnboardingTag[]
  reportCount: number
  aiDistilled: boolean
  derivedFromReports: boolean
}

interface Props {
  selected: string[]
  onChange: (tags: string[]) => void
  onNext: () => void
  busy?: boolean
  onHeaderChange?: (chrome: OnboardingHeaderChrome) => void
}

const SIGNALS_KEY = generationCacheKey('signals', ['default'])

function toTags(labels: string[], aiDistilled: boolean): LifeOnboardingTag[] {
  const stamp = Date.now().toString(36)
  return uniqPersonaTags(labels).map((label, index) => ({
    id: `${stamp}-${index}`,
    label,
    weight: Math.max(0.35, 1 - index * 0.08),
    source: aiDistilled ? 'report' : 'fallback',
  }))
}

export default function TagBubblesStep({
  selected,
  onChange,
  onNext,
  busy = false,
  onHeaderChange,
}: Props) {
  const { t, locale } = useI18n()
  const o = t.life.onboarding
  const cached = getGenerationCache<SignalsCache>(SIGNALS_KEY)
  const [tags, setTags] = useState<LifeOnboardingTag[]>(() => cached?.tags || [])
  const [reportCount, setReportCount] = useState(() => cached?.reportCount || 0)
  const [derivedFromReports, setDerivedFromReports] = useState(
    () => cached?.derivedFromReports ?? Boolean(cached?.tags?.length),
  )
  const [aiDistilled, setAiDistilled] = useState(
    () => Boolean(cached?.aiDistilled),
  )
  const [loading, setLoading] = useState(() => !cached)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [canPan, setCanPan] = useState(false)

  useEffect(() => {
    let cancelled = false
    const force = reloadToken > 0
    if (force) setRegenerating(true)
    else if (!getGenerationCache(SIGNALS_KEY)) setLoading(true)

    void agentService
      .getPersonaSignals({ language: locale, regenerate: force })
      .then((signals) => {
        if (cancelled) return
        const nextTags = toTags(signals?.tags ?? [], signals?.aiDistilled === true)
        const next: SignalsCache = {
          tags: nextTags,
          reportCount: signals?.reportCount ?? 0,
          aiDistilled: signals?.aiDistilled === true,
          derivedFromReports: (signals?.reportCount ?? 0) > 0,
        }
        setTags(next.tags)
        setReportCount(next.reportCount)
        setAiDistilled(next.aiDistilled)
        setDerivedFromReports(next.derivedFromReports)
        setGenerationCache(SIGNALS_KEY, next)
        setError('')
        if (nextTags.length > 0) {
          const labels = new Set(nextTags.map((tag) => tag.label))
          const kept = selected.filter((label) => labels.has(label))
          if (kept.length !== selected.length) onChange(kept)
        }
      })
      .catch((reason) => {
        if (cancelled) return
        if (reason instanceof ApiError && reason.code === 'agent_life_disabled') {
          setError(o.saveFirst)
          return
        }
        setError(reason instanceof Error ? reason.message : o.loadSignalsFailed)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setRegenerating(false)
        }
      })
    return () => {
      cancelled = true
    }
    // selected/onChange intentionally omitted — only prune after a fresh deck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, o.loadSignalsFailed, o.saveFirst, reloadToken])

  const toggle = (label: string) => {
    if (selected.includes(label)) {
      onChange(selected.filter((item) => item !== label))
    } else {
      onChange([...selected, label])
    }
  }

  const tagLabels = new Set(tags.map((tag) => tag.label))
  const selectedCount = selected.reduce(
    (count, label) => count + (tagLabels.has(label) ? 1 : 0),
    0,
  )
  const canContinue = selectedCount > 0 || reportCount === 0
  const blocked = busy || loading || regenerating
  const sourceNote = aiDistilled
    ? o.aiDistilledMeta.replace('{count}', String(reportCount))
    : derivedFromReports
      ? o.reportCount.replace('{count}', String(reportCount))
      : reportCount > 0
        ? o.reportsButFallback.replace('{count}', String(reportCount))
        : o.noReports

  useEffect(() => {
    onHeaderChange?.({
      description: loading ? o.step1Lead : sourceNote,
      action: {
        label: regenerating ? o.regeneratingSeeds : o.regenerateSeeds,
        busy: loading || regenerating,
        disabled: blocked,
        onClick: () => setReloadToken((token) => token + 1),
      },
    })
  }, [
    blocked,
    loading,
    o.regenerateSeeds,
    o.regeneratingSeeds,
    o.step1Lead,
    onHeaderChange,
    regenerating,
    reportCount,
    sourceNote,
  ])

  return (
    <section className="life-ob-tags" aria-label={o.step1Title}>
      <div className="life-ob-tags__board">
        {loading || regenerating ? (
          <Working>
            {regenerating ? o.regeneratingSeeds : o.loadingAiSignals}
          </Working>
        ) : tags.length === 0 ? (
          <Working>{o.loadingAiSignals}</Working>
        ) : (
          <BubbleCanvas
            key={tags.map((tag) => tag.id).join('|') || 'empty'}
            label={o.step1Title}
            items={tags.map((tag) => ({
              id: tag.id,
              label: tag.label,
              weight: Math.min(Math.max(tag.weight, 0), 1),
              selected: selected.includes(tag.label),
              disabled: blocked,
            }))}
            onPannableChange={setCanPan}
            onToggle={(id) => {
              const hit = tags.find((tag) => tag.id === id)
              if (hit) toggle(hit.label)
            }}
          />
        )}
        <div
          className="life-ob-tags__fade life-ob-tags__fade--bottom"
          aria-hidden
        />
      </div>
      {error && (
        <div className="life-ob-tags__error">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!loading && !regenerating && !error && tags.length === 0 && (
        <div className="life-ob-tags__error">
          <ErrorNote>{o.signalsEmpty}</ErrorNote>
        </div>
      )}
      {!loading && (
        <p className="life-ob-tags__status" aria-live="polite">
          <span>
            {selectedCount > 0
              ? o.selectedCount.replace('{count}', String(selectedCount))
              : o.selectNothingYet}
          </span>
          {canPan && (
            <>
              <span className="life-ob-tags__status-sep" aria-hidden>
                ·
              </span>
              <span className="life-ob-tags__status-pan">{o.dragCanvas}</span>
            </>
          )}
        </p>
      )}
      <ActionBar>
        {reportCount === 0 && (
          <GhostButton
            label={o.skipTags}
            plain
            disabled={blocked}
            onClick={onNext}
          />
        )}
        <PrimaryButton
          label={o.next}
          disabled={!canContinue || blocked}
          onClick={onNext}
        />
      </ActionBar>
    </section>
  )
}
