import type { OnboardingHeaderChrome, OnboardingStep } from './onboardingTypes'
import { LuChevronLeft, LuRefreshCw } from '@lib/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../contexts/I18nContext'
import { agentService } from '../../../services/agent'
import { ApiError } from '../../../services/api'
import {
  SettingSection,
  SettingsButton,
  useSettingGuide,
} from '../../settings'
import OnboardingWizard from './OnboardingWizard'
import '../PersonaOnboarding.css'

interface Props {
  onBack: () => void
  liteEnabled: boolean
  agentLifeEnabled: boolean
}

export default function PersonaOnboardingPage({
  onBack,
  liteEnabled,
  agentLifeEnabled,
}: Props) {
  const { t } = useI18n()
  const { catalog: g, bindGuide } = useSettingGuide()
  const o = t.life.onboarding
  const { user } = useAuth()
  const isOwner = user?.is_owner === true
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<OnboardingStep>(1)
  const [wizardBusy, setWizardBusy] = useState(false)
  const [header, setHeader] = useState<OnboardingHeaderChrome>({
    description: '',
  })
  const actionClickRef = useRef<(() => void) | undefined>(undefined)
  const lifeOn = agentLifeEnabled && liteEnabled
  const stepTitles = [o.step1Title, o.step2Title, o.step3Title]
  const stepLeads = [o.step1Lead, o.step2Lead, o.step3Lead]
  const stepNames = [o.step1Short, o.step2Short, o.step3Short]
  const wizardOpen = lifeOn && ready && !error
  const pageTitle = lifeOn ? stepTitles[step - 1] : t.config.agentLife
  const pageLead =
    header.description ||
    (lifeOn ? stepLeads[step - 1] : t.config.agentLifeHint)

  const loadSaved = useCallback(async () => {
    if (!isOwner || !lifeOn) {
      setReady(false)
      return
    }
    setReady(false)
    try {
      const persona = await agentService.getPersona()
      setName(persona?.name ?? '')
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'agent_life_disabled') {
        setError(o.saveFirst)
      }
    } finally {
      setReady(true)
    }
  }, [isOwner, lifeOn, o.saveFirst])

  useEffect(() => {
    void loadSaved()
  }, [loadSaved])

  const handleHeaderChange = useCallback((next: OnboardingHeaderChrome) => {
    actionClickRef.current = next.action?.onClick
    setHeader((prev) => {
      const sameVisual =
        prev.description === next.description &&
        (prev.tone ?? 'default') === (next.tone ?? 'default') &&
        Boolean(prev.action) === Boolean(next.action) &&
        prev.action?.label === next.action?.label &&
        prev.action?.busy === next.action?.busy &&
        prev.action?.disabled === next.action?.disabled
      if (sameVisual) return prev
      return {
        description: next.description,
        tone: next.tone,
        action: next.action
          ? {
              label: next.action.label,
              busy: next.action.busy,
              disabled: next.action.disabled,
              onClick: () => actionClickRef.current?.(),
            }
          : undefined,
      }
    })
  }, [])

  const handleBack = useCallback(() => {
    if (wizardOpen && step > 1) {
      if (!wizardBusy) setStep((current) => (current - 1) as OnboardingStep)
      return
    }
    onBack()
  }, [onBack, step, wizardBusy, wizardOpen])

  if (!isOwner) return null

  return (
    <SettingSection
      sectionId="persona"
      className="setting-section--persona"
      title={pageTitle}
      description={pageLead}
      detail={pageLead}
      descriptionVisible
      detailTone={header.tone === 'warning' ? 'warning' : 'default'}
      {...bindGuide('ai.agentLife', g.ai.agentLife)}
      showResetPage={false}
      headerActions={
        wizardOpen && header.action ? (
          <SettingsButton
            variant="secondary"
            size="sm"
            icon={<LuRefreshCw size={14} />}
            loading={header.action.busy}
            disabled={header.action.disabled}
            onClick={() => actionClickRef.current?.()}
          >
            {header.action.label}
          </SettingsButton>
        ) : null
      }
      headerLeading={
        <button
          type="button"
          className="section-header-back"
          onClick={handleBack}
          disabled={wizardBusy && step > 1}
          aria-label={
            wizardOpen && step > 1
              ? o.backTo.replace('{step}', stepNames[step - 2] || '')
              : t.common.back
          }
        >
          <LuChevronLeft size={18} aria-hidden />
          <span>{t.common.back}</span>
        </button>
      }
    >
      {error ? <p className="life-error life-ob-error">{error}</p> : null}
      {wizardOpen ? (
        <OnboardingWizard
          initialName={name}
          step={step}
          onStepChange={setStep}
          onBusyChange={setWizardBusy}
          onHeaderChange={handleHeaderChange}
          onFinished={onBack}
        />
      ) : null}
    </SettingSection>
  )
}
