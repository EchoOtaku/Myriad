import { LuCheck as Check } from '@lib/icons'
import { useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import * as phantasiApi from '../../../../services/phantasiApi'
import { userFacingError } from '../../../../utils/userFacingError'
import { InputItem } from '../../../settings/items/InputItem'
import { SettingsButton } from '../../../settings/items/SettingsButton'
import { SettingTitleTag } from '../../../settings/SettingTitleTag'
import { FormBlock } from './FormBlock'
import './AddMode.css'

export function ApplyFriendMode() {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [applicantName, setApplicantName] = useState('')
  const [applicantEmail, setApplicantEmail] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reset = () => {
    setSiteName('')
    setSiteUrl('')
    setFeedUrl('')
    setDescription('')
    setMessage('')
    setApplicantName('')
    setApplicantEmail('')
    setNameError(null)
    setUrlError(null)
    setError(null)
    setDone(false)
  }

  const submit = async () => {
    const name = siteName.trim()
    const url = siteUrl.trim()
    const nextNameError = name ? null : phantasi.applyFriendSiteNameRequired
    const nextUrlError = url ? null : phantasi.applyFriendSiteUrlRequired
    setNameError(nextNameError)
    setUrlError(nextUrlError)
    if (nextNameError || nextUrlError) {
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await phantasiApi.applySourceApplication({
        site_name: name,
        site_url: url,
        feed_url: feedUrl.trim() || undefined,
        description: description.trim() || undefined,
        message: message.trim() || undefined,
        applicant_name: applicantName.trim() || undefined,
        applicant_email: applicantEmail.trim() || undefined,
      })
      setDone(true)
    } catch (err) {
      setError(userFacingError(err, phantasi.applyFriendFailed))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="phantasi-add-form phantasi-add-form--apply is-done">
        <p className="phantasi-add-form__done-copy">
          <span className="phantasi-add-form__done-icon" aria-hidden>
            <Check />
          </span>
          {phantasi.applyFriendSubmitted}
        </p>
        <SettingsButton size="sm" block onClick={reset}>
          {phantasi.applyFriendAgain}
        </SettingsButton>
      </div>
    )
  }

  return (
    <form
      className="phantasi-add-form phantasi-add-form--apply"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="phantasi-add-form__stack">
        <FormBlock hint={phantasi.applyFriendLinkHint}>
          <div className="phantasi-add-form__pair">
            <InputItem
              itemKey="apply-friend-name"
              size="sm"
              label={phantasi.applyFriendSiteName}
              required
              error={nameError ?? undefined}
              value={siteName}
              onChange={(value) => {
                setSiteName(value)
                if (nameError) setNameError(null)
              }}
              placeholder={phantasi.enterName}
              autoComplete="organization"
              disabled={busy}
            />
            <InputItem
              itemKey="apply-friend-url"
              size="sm"
              label={phantasi.applyFriendSiteUrl}
              required
              error={urlError ?? undefined}
              value={siteUrl}
              onChange={(value) => {
                setSiteUrl(value)
                if (urlError) setUrlError(null)
              }}
              placeholder="https://"
              inputType="url"
              autoComplete="url"
              disabled={busy}
            />
          </div>
          <InputItem
            itemKey="apply-friend-desc"
            size="sm"
            label={phantasi.applyFriendDescription}
            value={description}
            onChange={setDescription}
            multiline
            rows={2}
            disabled={busy}
          />
          <InputItem
            itemKey="apply-friend-feed"
            size="sm"
            label={phantasi.applyFriendFeedUrl}
            hint={phantasi.applyFriendFeedUrlHint}
            value={feedUrl}
            onChange={setFeedUrl}
            placeholder="https://"
            inputType="url"
            disabled={busy}
          />
          <InputItem
            itemKey="apply-friend-message"
            size="sm"
            label={phantasi.applyFriendMessage}
            value={message}
            onChange={setMessage}
            multiline
            rows={3}
            disabled={busy}
          />
          <div className="phantasi-add-form__pair">
            <InputItem
              itemKey="apply-friend-applicant"
              size="sm"
              label={phantasi.applyFriendApplicantName}
              value={applicantName}
              onChange={setApplicantName}
              autoComplete="name"
              disabled={busy}
            />
            <InputItem
              itemKey="apply-friend-email"
              size="sm"
              label={phantasi.applyFriendApplicantEmail}
              value={applicantEmail}
              onChange={setApplicantEmail}
              inputType="email"
              autoComplete="email"
              disabled={busy}
            />
          </div>
        </FormBlock>

        {error ? (
          <SettingTitleTag variant="danger">{error}</SettingTitleTag>
        ) : null}
        <SettingsButton
          type="submit"
          variant="primary"
          size="sm"
          block
          loading={busy}
          disabled={busy}
        >
          {phantasi.applyFriendSubmit}
        </SettingsButton>
      </div>
    </form>
  )
}
