import type { RefObject } from 'react'
import type { RigCharacterHandle } from '../rig/RigCharacter'
import type { Anime25DDriver } from './driver'
import type { PoseCorrectionRegion } from './poseAuthoring'
import type { PoseCorrection } from './poseCorrections'
import type { Anime25DPlayback } from './types'
import { useEffect, useRef, useState } from 'react'
import { SettingGroup, SettingsButton, SliderItem, SwitchItem } from '../../../components/settings'
import { useI18n } from '../../../contexts/I18nContext'
import { appendPoseCorrectionPatch, capturePoseCorrection, POSE_CORRECTION_REGIONS, poseCorrectionPreviewDriver } from './poseAuthoring'

interface Props {
  playback: Anime25DPlayback
  characterRef: RefObject<RigCharacterHandle | null>
  driver: Anime25DDriver
  onDriver: (driver: Anime25DDriver) => void
  onSave: (corrections: PoseCorrection[]) => Promise<void>
}

/** Mounted per immutable asset id; drafts never mutate the shared live package. */
export function PoseCorrectionEditor({ playback, characterRef, driver, onDriver, onSave }: Props) {
  const { t } = useI18n()
  const copy = t.merope.poseCorrection
  const baseline = playback.shellProfile.poseCorrections ?? []
  const [draft, setDraft] = useState<PoseCorrection[]>(() => structuredClone(baseline))
  const [region, setRegion] = useState<PoseCorrectionRegion>('leftEye')
  const [index, setIndex] = useState(0)
  const [patchIndex, setPatchIndex] = useState(0)
  const [original, setOriginal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const selected = draft[index]
  const patch = selected?.patches[patchIndex]
  useEffect(() => {
    characterRef.current?.previewPoseCorrections(original ? null : draft)
  }, [characterRef, draft, original])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; characterRef.current?.previewPoseCorrections(null) }
  }, [characterRef])
  const select = (next: number) => {
    setIndex(next); setPatchIndex(0); setOriginal(false)
    if (draft[next]) onDriver(poseCorrectionPreviewDriver(draft[next], driver))
  }
  const add = () => {
    const candidate = capturePoseCorrection(playback, driver, region)
    if (!candidate) { setError(copy.invalidPose); return }
    const result = appendPoseCorrectionPatch(draft, candidate)
    if (!result) { setError(copy.limit); return }
    setDraft(result.corrections); setIndex(result.index); setPatchIndex(result.patch); setOriginal(false); setError('')
    onDriver(poseCorrectionPreviewDriver(result.corrections[result.index], driver))
  }
  const edit = (field: keyof NonNullable<typeof patch>, value: number) => {
    setOriginal(false)
    setDraft(current => current.map((c, i) => i === index ? { ...c, patches: c.patches.map((p, k) => k === patchIndex ? { ...p, [field]: value } : p) } : c))
  }
  const remove = () => {
    setDraft(current => current.map((c, i) => i === index ? { ...c, patches: c.patches.filter((_, k) => k !== patchIndex) } : c).filter(c => c.patches.length))
    setIndex(0); setPatchIndex(0); setOriginal(false)
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await onSave(structuredClone(draft)) }
    catch (reason) { if (alive.current) setError(reason instanceof Error && reason.message ? reason.message : copy.failed) }
    finally { if (alive.current) setSaving(false) }
  }
  return <SettingGroup title={copy.title} description={copy.description} id="merope-pose-corrections">
    <div className="merope-motion-home__chips">
      <label>{copy.region} <select value={region} disabled={saving} onChange={event => setRegion(event.target.value as PoseCorrectionRegion)}>
        {POSE_CORRECTION_REGIONS.map(r => <option key={r} value={r}>{copy[r]}</option>)}
      </select></label>
      <SettingsButton type="button" size="sm" disabled={saving} onClick={add}>{copy.add}</SettingsButton>
      <div>{draft.map((c, i) => <SettingsButton key={i} type="button" size="sm" disabled={saving} aria-pressed={index === i} onClick={() => select(i)}>
        {i + 1} · {Object.entries(c.at).map(([axis, v]) => `${axis} ${v}`).join(' / ')}
      </SettingsButton>)}</div>
    </div>
    {selected ? <label>{copy.patch} <select value={patchIndex} disabled={saving} onChange={event => setPatchIndex(Number(event.target.value))}>
      {selected.patches.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
    </select></label> : null}
    {patch ? <>
      {(['x', 'y', 'radiusX', 'radiusY', 'dx', 'dy'] as const).map(field => <SliderItem key={field}
        itemKey={`pose-correction-${field}`} label={copy[field]} value={patch[field]} disabled={saving}
        min={field.startsWith('radius') ? 0.1 : field.startsWith('d') ? -0.25 : -2}
        max={field.startsWith('d') ? 0.25 : 2} step={0.01} onChange={value => edit(field, value)} />)}
      <SettingsButton type="button" size="sm" disabled={saving} onClick={remove}>{copy.remove}</SettingsButton>
    </> : null}
    <SwitchItem itemKey="pose-correction-original" label={copy.compare} value={original} disabled={saving} onChange={setOriginal} />
    <div className="merope-motion-home__chips">
      <SettingsButton type="button" size="sm" disabled={saving || !dirty} loading={saving} onClick={() => void save()}>{copy.save}</SettingsButton>
      <SettingsButton type="button" size="sm" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(baseline)); setIndex(0); setPatchIndex(0); setOriginal(false); setError('') }}>{copy.discard}</SettingsButton>
    </div>
    {error ? <p role="alert" className="merope-motion-home__help">{error}</p> : null}
  </SettingGroup>
}
