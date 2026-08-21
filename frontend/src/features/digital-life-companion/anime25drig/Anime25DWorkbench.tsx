import type { ReactNode, RefObject } from 'react'
import type { TranslationKeys } from '../../../i18n'
import type {
  RigAssetCompileEvent,
  RigAssetPreflight,
} from '../assets/pipeline'
import type { RigCharacterHandle } from '../rig/RigCharacter'
import type { Anime25DDebugSnapshot, Anime25DDriver } from './player'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ButtonItem,
  InfoActionCard,
  InputItem,
  SettingGroup,
  SettingsButton,
  SliderItem,
  SwitchItem,
} from '../../../components/settings'
import { useI18n } from '../../../contexts/I18nContext'
import { IDENTITY_DRIVER } from './player'

interface Props {
  reviewMode: boolean
  onReviewModeChange: (reviewing: boolean) => void
  characterRef: RefObject<RigCharacterHandle | null>
  sourceMasterAssetId: string
  sourceGenerationFingerprint?: string
  seeThroughTokenConfigured: boolean
  onSaveSeeThroughToken: (token: string) => Promise<void>
  onDecomposeRigPsd: () => Promise<File>
  onPreflightRigPsd: (
    file: File,
    onStage: (event: RigAssetCompileEvent) => void,
  ) => Promise<RigAssetPreflight>
  onCommitRigPsd: (
    preflight: RigAssetPreflight,
    onStage: (event: RigAssetCompileEvent) => void,
  ) => Promise<{ partCount: number; score: number }>
  reviewDock?: HTMLElement | null
  essentialsLead?: ReactNode
}

const PRESETS: Array<{ id: string; driver: Anime25DDriver }> = [
  { id: 'idle', driver: { ...IDENTITY_DRIVER } },
  {
    id: 'smile',
    driver: { ...IDENTITY_DRIVER, mouth: 0.18, bust: 0.22, angleY: -0.06 },
  },
  {
    id: 'talk',
    driver: { ...IDENTITY_DRIVER, talking: true, mouth: 0.5 },
  },
  { id: 'lookLeft', driver: { ...IDENTITY_DRIVER, angleX: -0.48 } },
  { id: 'lookRight', driver: { ...IDENTITY_DRIVER, angleX: 0.48 } },
  { id: 'winkLeft', driver: { ...IDENTITY_DRIVER, eyeL: 0 } },
  { id: 'winkRight', driver: { ...IDENTITY_DRIVER, eyeR: 0 } },
]

export default function Anime25DWorkbench({
  reviewMode,
  onReviewModeChange,
  characterRef,
  sourceMasterAssetId,
  sourceGenerationFingerprint,
  seeThroughTokenConfigured,
  onSaveSeeThroughToken,
  onDecomposeRigPsd,
  onPreflightRigPsd,
  onCommitRigPsd,
  reviewDock = null,
  essentialsLead = null,
}: Props) {
  const { t } = useI18n()
  const labels = t.companion
  const [driver, setDriver] = useState<Anime25DDriver>({ ...IDENTITY_DRIVER })
  const [snapshot, setSnapshot] = useState<Anime25DDebugSnapshot | null>(null)
  const rigPsdInputRef = useRef<HTMLInputElement>(null)
  const [rigImportStage, setRigImportStage] =
    useState<RigAssetCompileEvent | null>(null)
  const [rigImportResult, setRigImportResult] = useState<string | null>(null)
  const [rigImportError, setRigImportError] = useState<string | null>(null)
  const [rigPreflight, setRigPreflight] = useState<RigAssetPreflight | null>(
    null,
  )
  const [seeThroughTokenDraft, setSeeThroughTokenDraft] = useState('')
  const [seeThroughTokenError, setSeeThroughTokenError] = useState<
    string | undefined
  >()
  const [rigImportOperation, setRigImportOperation] = useState<
    'decompose' | 'manual' | 'commit' | null
  >(null)
  const importingRig = rigImportOperation !== null

  useEffect(() => {
    setRigPreflight(null)
    setRigImportResult(null)
    setRigImportError(null)
  }, [sourceGenerationFingerprint, sourceMasterAssetId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSnapshot(characterRef.current?.debugSnapshot() ?? null)
    }, 200)
    return () => window.clearInterval(timer)
  }, [characterRef])

  const applyDriver = (next: Anime25DDriver) => {
    setDriver(next)
    characterRef.current?.replaceDriver(next)
  }

  const patchDriver = (partial: Partial<Anime25DDriver>) => {
    const next = { ...driver, ...partial }
    setDriver(next)
    characterRef.current?.setDriver(partial)
  }

  const resetPose = () => {
    setDriver({ ...IDENTITY_DRIVER })
    characterRef.current?.resetDriver()
  }

  const saveSeeThroughToken = async (token: string) => {
    if (!token || token.includes('•') || token.includes('*')) return
    setSeeThroughTokenError(undefined)
    try {
      await onSaveSeeThroughToken(token)
      setSeeThroughTokenDraft('')
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : labels.motionSeeThroughTokenFailed
      setSeeThroughTokenError(message)
      throw reason
    }
  }

  const preflightRigPsd = async (file: File) => {
    if (importingRig || !sourceMasterAssetId) return
    setRigImportOperation('manual')
    setRigImportStage(null)
    setRigImportResult(null)
    setRigImportError(null)
    try {
      setRigPreflight(null)
      const imported = await onPreflightRigPsd(file, setRigImportStage)
      setRigPreflight(imported)
      setRigImportResult(
        `${imported.partCount} · ${imported.report.score}/100`,
      )
    } catch (reason) {
      setRigImportError(
        reason instanceof Error ? reason.message : 'Rig PSD import failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const decomposeRigPsd = async () => {
    if (importingRig || !sourceMasterAssetId || !seeThroughTokenConfigured) {
      return
    }
    setRigImportOperation('decompose')
    setRigImportStage(null)
    setRigImportResult(null)
    setRigImportError(null)
    try {
      setRigPreflight(null)
      const file = await onDecomposeRigPsd()
      const imported = await onPreflightRigPsd(file, setRigImportStage)
      setRigPreflight(imported)
      setRigImportResult(
        `${imported.partCount} · ${imported.report.score}/100`,
      )
    } catch (reason) {
      setRigImportError(
        reason instanceof Error
          ? reason.message
          : 'See-through decomposition failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const commitRigPsd = async () => {
    if (importingRig || !rigPreflight) return
    setRigImportOperation('commit')
    setRigImportStage(null)
    setRigImportError(null)
    try {
      const imported = await onCommitRigPsd(rigPreflight, setRigImportStage)
      setRigImportResult(`${imported.partCount} · ${imported.score}/100`)
      setRigPreflight(null)
    } catch (reason) {
      setRigImportError(
        reason instanceof Error ? reason.message : 'Rig PSD commit failed',
      )
    } finally {
      setRigImportOperation(null)
    }
  }

  const sliders = useMemo(
    () => [
      {
        key: 'angleX',
        label: labels.anime25dHeadX,
        min: -1,
        max: 1,
        step: 0.01,
        value: driver.angleX,
      },
      {
        key: 'angleY',
        label: labels.anime25dHeadY,
        min: -1,
        max: 1,
        step: 0.01,
        value: driver.angleY,
      },
      {
        key: 'eyeL',
        label: labels.anime25dEyeL,
        min: 0,
        max: 1,
        step: 0.01,
        value: driver.eyeL,
      },
      {
        key: 'eyeR',
        label: labels.anime25dEyeR,
        min: 0,
        max: 1,
        step: 0.01,
        value: driver.eyeR,
      },
      {
        key: 'mouth',
        label: labels.anime25dMouth,
        min: 0,
        max: 1,
        step: 0.01,
        value: driver.mouth,
      },
      {
        key: 'armY',
        label: labels.anime25dArmY,
        min: -1,
        max: 1,
        step: 0.01,
        value: driver.armY,
      },
      {
        key: 'armPos',
        label: labels.anime25dArmPos,
        min: -1,
        max: 1,
        step: 0.01,
        value: driver.armPos,
      },
      {
        key: 'bust',
        label: labels.anime25dBust,
        min: 0,
        max: 1,
        step: 0.01,
        value: driver.bust,
      },
      {
        key: 'lean',
        label: labels.anime25dLean,
        min: -1,
        max: 1,
        step: 0.01,
        value: driver.lean,
      },
    ],
    [driver, labels],
  )

  const reviewBar =
    reviewMode && reviewDock
      ? createPortal(
          <div className="life-motion-home__dock-bar">
            <SettingsButton
              type="button"
              size="sm"
              onClick={() => characterRef.current?.blinkNow()}
            >
              {labels.anime25dBlinkNow}
            </SettingsButton>
            <SettingsButton
              type="button"
              size="sm"
              onClick={() => applyDriver(PRESETS[2].driver)}
            >
              {labels.anime25dPresetTalk}
            </SettingsButton>
            <SettingsButton type="button" size="sm" onClick={resetPose}>
              {labels.anime25dResetPose}
            </SettingsButton>
            <SettingsButton
              type="button"
              size="sm"
              onClick={() => onReviewModeChange(false)}
            >
              {labels.motionReviewExit}
            </SettingsButton>
          </div>,
          reviewDock,
        )
      : null

  return (
    <>
      <SettingGroup
        title={labels.essentials}
        description={labels.essentialsDescription}
        id="life-motion-essentials"
      >
        {essentialsLead}
        <ButtonItem
          itemKey="motion-review"
          label={labels.motionReviewEnter}
          description={labels.motionReviewDescription}
          buttonText={labels.motionReviewEnter}
          onClick={() => onReviewModeChange(true)}
          layout="horizontal"
        />
        <InputItem
          itemKey="see-through-hf-token"
          label={labels.motionSeeThroughToken}
          labelAccessory={
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              {labels.motionSeeThroughTokenCreate}
            </a>
          }
          description={labels.motionSeeThroughTokenDescription}
          value={
            seeThroughTokenDraft ||
            (seeThroughTokenConfigured ? '••••••••' : '')
          }
          onChange={(value) => {
            setSeeThroughTokenDraft(value)
            setSeeThroughTokenError(undefined)
          }}
          inputType="password"
          autoComplete="off"
          placeholder="hf_…"
          variant="clickToEdit"
          emptyLabel={labels.motionSeeThroughTokenMissing}
          editLabel={labels.motionSeeThroughTokenEdit}
          saveLabel={labels.motionSeeThroughTokenSave}
          cancelLabel={labels.motionSeeThroughTokenCancel}
          onCommit={saveSeeThroughToken}
          error={seeThroughTokenError}
          clearable={false}
        />
        <InfoActionCard
          copyable={false}
          tone={rigImportError ? 'danger' : rigPreflight ? 'info' : 'default'}
          title={labels.motionPsd}
          empty={!rigPreflight && !rigImportResult}
          emptyText={labels.motionPsdDescription}
          actions={[
            {
              key: 'see-through',
              label:
                rigImportOperation === 'decompose'
                  ? labels.motionSeeThroughGenerating
                  : labels.motionSeeThroughGenerate,
              disabled:
                importingRig ||
                !sourceMasterAssetId ||
                !seeThroughTokenConfigured,
              loading: rigImportOperation === 'decompose',
              onClick: () => void decomposeRigPsd(),
            },
            {
              key: 'preflight',
              label:
                rigImportOperation === 'manual'
                  ? labels.motionPsdValidating
                  : labels.motionPsdPreflight,
              disabled: importingRig || !sourceMasterAssetId,
              loading: rigImportOperation === 'manual',
              onClick: () => rigPsdInputRef.current?.click(),
            },
            ...(rigPreflight
              ? [
                  {
                    key: 'commit',
                    label: labels.motionPsdCommit,
                    disabled:
                      importingRig ||
                      rigPreflight.report.issues.some(
                        (item) => item.severity === 'error',
                      ),
                    loading: rigImportOperation === 'commit',
                    onClick: () => void commitRigPsd(),
                  },
                ]
              : []),
          ]}
          footer={
            <>
              <input
                ref={rigPsdInputRef}
                type="file"
                accept=".psd,image/vnd.adobe.photoshop"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) void preflightRigPsd(file)
                }}
              />
              {rigImportStage && !rigImportResult && !rigImportError ? (
                <p className="life-motion-home__help" role="status">
                  {rigImportStage.stage} · {rigImportStage.status}
                </p>
              ) : null}
              {rigImportResult ? (
                <p className="life-motion-home__help" role="status">
                  {rigImportResult}
                </p>
              ) : null}
              {rigPreflight && rigPreflight.report.issues.length > 0 ? (
                <ul>
                  {rigPreflight.report.issues.slice(0, 6).map((item) => (
                    <li
                      key={`${item.code}:${item.clipId || item.boneId || ''}`}
                    >
                      {item.severity}: {item.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {rigImportError ? (
                <p className="life-motion-home__help" role="alert">
                  {rigImportError}
                </p>
              ) : null}
            </>
          }
        />
      </SettingGroup>
      <SettingGroup
        title={labels.anime25dDebug}
        description={labels.anime25dDebugDescription}
        id="life-motion-details"
        collapsible
        defaultExpanded
      >
        <div className="life-motion-home__chips">
          <div>
            {PRESETS.map((preset) => (
              <SettingsButton
                key={preset.id}
                type="button"
                size="sm"
                onClick={() => applyDriver(preset.driver)}
              >
                {presetLabel(labels, preset.id)}
              </SettingsButton>
            ))}
            <SettingsButton
              type="button"
              size="sm"
              onClick={() => characterRef.current?.blinkNow()}
            >
              {labels.anime25dBlinkNow}
            </SettingsButton>
            <SettingsButton type="button" size="sm" onClick={resetPose}>
              {labels.anime25dResetPose}
            </SettingsButton>
          </div>
        </div>
        <SwitchItem
          itemKey="anime25d-talking"
          label={labels.anime25dTalking}
          value={driver.talking}
          onChange={(talking) => patchDriver({ talking })}
        />
        {sliders.map((slider) => (
          <SliderItem
            key={slider.key}
            itemKey={slider.key}
            label={slider.label}
            value={slider.value}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            formatValue={(value) => value.toFixed(2)}
            onChange={(value) =>
              patchDriver({ [slider.key]: value } as Partial<Anime25DDriver>)
            }
            layout="vertical"
          />
        ))}
        <InfoActionCard
          copyable={false}
          title={labels.anime25dInspect}
          fields={
            snapshot
              ? [
                  {
                    key: 'layers',
                    label: labels.anime25dInspectLayers,
                    value: String(snapshot.layerCount),
                    copyable: false,
                  },
                  {
                    key: 'strands',
                    label: labels.anime25dInspectStrands,
                    value: `${snapshot.strandCount} / ${snapshot.hairLayerCount}`,
                    copyable: false,
                  },
                  {
                    key: 'eyes',
                    label: labels.anime25dInspectEyes,
                    value: `${snapshot.eyeOpenLayers} / ${snapshot.eyeCloseLayers}`,
                    copyable: false,
                  },
                  {
                    key: 'mouth',
                    label: labels.anime25dInspectMouth,
                    value: `${snapshot.mouthOpenLayers} / ${snapshot.mouthCloseLayers}`,
                    copyable: false,
                  },
                  {
                    key: 'canvas',
                    label: labels.anime25dInspectCanvas,
                    value: `${Math.round(snapshot.canvas.width)}×${Math.round(snapshot.canvas.height)}`,
                    copyable: false,
                  },
                ]
              : undefined
          }
          empty={!snapshot}
          emptyText={labels.anime25dInspectEmpty}
        />
      </SettingGroup>
      {reviewBar}
    </>
  )
}

function presetLabel(
  labels: TranslationKeys['companion'],
  id: string,
): string {
  if (id === 'idle') return labels.anime25dPresetIdle
  if (id === 'smile') return labels.anime25dPresetSmile
  if (id === 'talk') return labels.anime25dPresetTalk
  if (id === 'lookLeft') return labels.anime25dPresetLookLeft
  if (id === 'lookRight') return labels.anime25dPresetLookRight
  if (id === 'winkLeft') return labels.anime25dPresetWinkLeft
  if (id === 'winkRight') return labels.anime25dPresetWinkRight
  return id
}
