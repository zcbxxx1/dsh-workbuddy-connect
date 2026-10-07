/**
 * The account pool's settings page.
 *
 * Registered on `settings.section`, so it is its own page in Settings — the
 * same seat the remote-access plugin uses — rather than a card that has to be
 * found by opening the Plugins page and expanding a bundle.
 *
 * Data flow: one GET of the pool route renders everything, and each control
 * POSTs an action and adopts the document the answer carries. There is no local
 * mirror of the membership list: the host owns it, and a control that changed
 * something the host did not confirm would be a lie the next read exposes.
 *
 * Styling follows the plugin card's language: `--dsw-alias-*` theme tokens
 * rather than invented variable names. An unknown custom property resolves to
 * nothing, so a made-up name is not a fallback — it is a missing colour that
 * silently renders as the browser default.
 *
 * @module dsh-workbuddy-connect/client/WorkBuddyPoolPage
 */

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkBuddyPoolDocument, WorkBuddyWebImportedCredential, WorkBuddyWebPoolAccount } from '../status-paths.ts'
import { WORKBUDDY_POOL_PATH } from '../status-paths.ts'

/** Props the settings shell delivers to a `settings.section` entry. */
export type WorkBuddyPoolPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.workbuddy'>

// --- design tokens ---------------------------------------------------------
// Only names the live theme actually defines (`Theme.listTokens`). An unknown
// custom property does not fall back — it resolves to nothing, so the colour
// silently disappears. The card's own `bg-module-platform`, `label-tertiary`,
// `button-primary-fill` and `state-success-subtle` are NOT in that list, which
// is why this page does not borrow them.

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxWidth: 820,
  color: 'var(--dsw-alias-label-primary)',
}
const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-1)',
  overflow: 'hidden',
}
const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: '12px 14px',
}
const cardBodyStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  padding: '14px',
}
const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}
const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '19px',
  color: 'var(--dsw-alias-label-secondary)',
}
const dangerTextStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' }

/** A pill button, matching the card's own controls. */
const buttonStyle: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 30,
  padding: '4px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 15,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
/** The brand accent, used for the one primary action on the page. */
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid var(--dsw-alias-brand-primary)',
  background: 'var(--dsw-alias-brand-primary)',
  color: 'var(--dsw-alias-label-primary)',
}

/** One account row: a grid so every column lines up across rows. */
const accountRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(140px, 1fr) auto',
  alignItems: 'center',
  gap: '4px 12px',
  padding: '9px 10px',
  borderRadius: 8,
}
const accountNameStyle: CSSProperties = { fontSize: 14, lineHeight: '20px', fontWeight: 500 }
const accountMetaStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  gridColumn: '2 / -1',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
}
/** A small status chip. */
const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 9,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2)',
  fontSize: 11,
  lineHeight: '17px',
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}
const chipLiveStyle: CSSProperties = {
  ...chipStyle,
  color: 'var(--dsw-alias-state-success-primary)',
}
const chipWarnStyle: CSSProperties = {
  ...chipStyle,
  color: 'var(--dsw-alias-state-error-primary)',
}
const chipIdleStyle: CSSProperties = {
  ...chipStyle,
  color: 'var(--dsw-alias-state-idle-primary)',
}
/** A labelled switch row. */
const switchRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '7px 0',
  cursor: 'pointer',
}
const switchCopyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
const switchLabelStyle: CSSProperties = { fontSize: 14, lineHeight: '20px' }
const emptyStyle: CSSProperties = {
  margin: 0,
  padding: '14px 10px',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
  textAlign: 'center',
}
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  lineHeight: '19px',
  padding: 9,
  resize: 'vertical',
}

/** How often the page re-reads the document. */
const POLL_MS = 15_000

/**
 * A small status chip.
 *
 * `style` accepts `undefined` explicitly because callers pass a conditional
 * override (`row.status === 'failed' ? warn : undefined`) and the repo compiles
 * with `exactOptionalPropertyTypes`, which rejects that against a plain
 * optional property.
 */
function Chip({ children, style }: { children: ReactNode, style?: CSSProperties | undefined }): ReactNode {
  return <span style={{ ...chipStyle, ...style }}>{children}</span>
}

/** One account row. */
function AccountRow({ account, t, disabled, onToggle }: {
  account: WorkBuddyWebPoolAccount
  t: WorkBuddyPoolPageProps['t']
  disabled: boolean
  onToggle: (id: string, member: boolean) => void
}): ReactNode {
  const expiry = account.expiresAtMs > 0
    ? new Date(account.expiresAtMs).toLocaleDateString()
    : t('poolNoExpiry')
  const excluded = account.excludedBy !== undefined
  return (
    <div style={accountRowStyle}>
      <input
        type="checkbox"
        checked={account.member}
        disabled={disabled}
        aria-label={account.name === '' ? account.id : account.name}
        onChange={event => { onToggle(account.id, event.target.checked) }}
      />
      <span style={accountNameStyle}>{account.name === '' ? t('poolUnnamed') : account.name}</span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {account.live ? <Chip style={chipLiveStyle}>{t('poolLive')}</Chip> : null}
        {excluded
          ? (
              <Chip style={chipWarnStyle}>
                {t('poolExcluded')}
                {account.excludedUntilMs === undefined
                  ? ` · ${t('poolRecoversUnknown')}`
                  : ` · ${t('poolRecoversAt')} ${new Date(account.excludedUntilMs).toLocaleString()}`}
              </Chip>
            )
          : null}
      </span>
      <span style={accountMetaStyle}>
        <span title={account.id}>{account.id.slice(0, 24)}</span>
        <span>· {t('poolVariant')}: {account.variant}</span>
        <span>· {t('poolExpires')}: {expiry}</span>
        <span title={account.creditsError ?? ''}>
          · {t('poolCredits')}:{' '}
          {account.creditsUnlimited === true
            ? t('poolCreditsUnlimited')
            : account.credits ?? t('poolCreditsUnknown')}
        </span>
        {excluded && account.excludedReason !== undefined
          ? <span style={dangerTextStyle} title={account.excludedReason}>· {account.excludedReason.slice(0, 80)}</span>
          : null}
      </span>
    </div>
  )
}

/**
 * A textarea for pasting a credential, with an explicit import button.
 *
 * Kept local state: the text is a draft, not pool state, and clearing it after
 * a successful import is the one thing a user expects. The parent owns whether
 * the import succeeded, so it hands down `disabled` and the callback.
 */
function ImportPasteBox({ t, disabled, onImport }: {
  t: WorkBuddyPoolPageProps['t']
  disabled: boolean
  /** Resolves true when the credential was accepted. */
  onImport: (text: string) => Promise<boolean>
}): ReactNode {
  const [text, setText] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <textarea
        value={text}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        aria-label={t('poolImportPaste')}
        placeholder={t('poolImportPastePlaceholder')}
        style={inputStyle}
        onChange={event => { setText(event.target.value) }}
      />
      <span>
        <button
          type="button"
          style={text.trim() === '' ? buttonStyle : primaryButtonStyle}
          disabled={disabled || text.trim() === ''}
          onClick={() => {
            // Clear only on success: a rejected credential must stay on screen
            // so the user can see what was refused and fix it.
            void onImport(text).then(ok => { if (ok) setText('') })
          }}
        >
          {t('poolImportRun')}
        </button>
      </span>
    </div>
  )
}

/**
 * One imported credential.
 *
 * An entry that no longer opens stays visible with a Remove button: hiding it
 * would leave an undeletable file on disk that the user can see no reason for.
 */
function ImportedRow({ entry, t, disabled, onRemove }: {
  entry: WorkBuddyWebImportedCredential
  t: WorkBuddyPoolPageProps['t']
  disabled: boolean
  onRemove: (accountId: string) => void
}): ReactNode {
  const label = entry.accountName
    ?? (entry.accountId === '' ? t('poolImportUnreadable') : entry.accountId)
  return (
    <div style={accountRowStyle}>
      <span style={{ width: 1 }} />
      <span style={accountNameStyle}>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
        {entry.readable
          ? <Chip style={chipLiveStyle}>{t('poolImportReadable')}</Chip>
          : <Chip style={chipWarnStyle}>{t('poolImportBroken')}</Chip>}
        <button
          type="button"
          style={buttonStyle}
          disabled={disabled || entry.accountId === ''}
          title={entry.reason ?? ''}
          onClick={() => { onRemove(entry.accountId) }}
        >
          {t('poolImportRemove')}
        </button>
      </span>
      <span style={accountMetaStyle}>
        {entry.accountId === ''
          ? <span style={dangerTextStyle}>{entry.reason ?? t('poolImportBroken')}</span>
          : <span title={entry.accountId}>{entry.accountId.slice(0, 32)}</span>}
      </span>
    </div>
  )
}

/**
 * The pool page.
 *
 * A read failure keeps the last document on screen and shows the reason beside
 * it, rather than blanking the page: the pool's state did not change because a
 * poll failed, and a blank page would look like the pool had emptied.
 */
export function WorkBuddyPoolPage({ t }: WorkBuddyPoolPageProps): ReactNode {
  const [document, setDocument] = useState<WorkBuddyPoolDocument>()
  const [readFailure, setReadFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  /** Newest read wins, so a slow poll cannot overwrite a fresh action's answer. */
  const seq = useRef(0)

  const read = useCallback(async () => {
    const mine = ++seq.current
    try {
      const response = await fetch(WORKBUDDY_POOL_PATH, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const next = await response.json() as WorkBuddyPoolDocument
      if (!mounted.current || mine !== seq.current) return
      setDocument(next)
      setReadFailure(undefined)
    } catch (error: unknown) {
      if (!mounted.current || mine !== seq.current) return
      setReadFailure(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void read()
    const timer = setInterval(() => { void read() }, POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [read])

  /**
   * Run one write action and adopt the document it answers with.
   *
   * The action's own answer supersedes the poll (it bumped `seq`), so the
   * toggle the user just flipped is not briefly reverted by a read that started
   * before it.
   *
   * Returns whether the action SUCCEEDED. The paste box needs that to decide
   * whether to clear its draft: clearing on a refused import would erase the
   * very text the user has to correct.
   */
  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    const key = document?.poolKey
    if (key === undefined) return false
    const mine = ++seq.current
    setBusy(true)
    try {
      const response = await fetch(WORKBUDDY_POOL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workbuddy-pool-key': key },
        body: JSON.stringify({ action, ...extra }),
      })
      const answer = await response.json() as { state?: string, document?: WorkBuddyPoolDocument, reason?: string }
      const ok = response.ok && answer.state !== 'failed'
      if (!mounted.current || mine !== seq.current) return ok
      if (answer.document !== undefined) setDocument(answer.document)
      setReadFailure(ok ? undefined : (answer.reason ?? `action failed (HTTP ${response.status})`))
      return ok
    } catch (error: unknown) {
      if (mounted.current && mine === seq.current) {
        setReadFailure(error instanceof Error ? error.message : String(error))
      }
      return false
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [document?.poolKey])

  const toggleMember = useCallback((id: string, member: boolean) => {
    const current = document?.accounts ?? []
    const ids = current.filter(account => account.member).map(account => account.id)
    const next = member ? [...new Set([...ids, id])] : ids.filter(existing => existing !== id)
    void act('set-members', { accountIds: next })
  }, [act, document?.accounts])

  if (document === undefined) {
    return (
      <div style={sectionStyle}>
        <p>{readFailure === undefined ? t('poolLoading') : `${t('poolReadFailed')}: ${readFailure}`}</p>
      </div>
    )
  }

  const accounts = document.accounts
  // Tolerated as absent: a host built before the import feature serves no
  // `imported` field, and the section simply renders empty rather than crashing.
  const imported = document.imported ?? []

  return (
    <div style={sectionStyle}>
      {readFailure === undefined
        ? null
        : <p style={{ ...hintStyle, ...dangerTextStyle }}>{t('poolReadFailed')}: {readFailure}</p>}

      <section style={cardStyle}>
        <div style={cardHeadStyle}>
          <h3 style={cardTitleStyle}>{t('poolTitle')}</h3>
          <Chip style={document.enabled ? chipLiveStyle : undefined}>
            {document.enabled ? t('poolStateOn') : t('poolStateOff')}
          </Chip>
        </div>
        <div style={cardBodyStyle}>
          <p style={hintStyle}>{t('poolIntro')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            <label style={switchRowStyle}>
              <input
                type="checkbox"
                checked={document.enabled}
                disabled={busy}
                onChange={event => { void act('set-enabled', { enabled: event.target.checked }) }}
              />
              <span style={switchCopyStyle}>
                <span style={switchLabelStyle}>{t('poolEnabled')}</span>
              </span>
            </label>
            <label style={switchRowStyle}>
              <input
                type="checkbox"
                checked={document.autoCheckin}
                disabled={busy}
                onChange={event => { void act('set-auto-checkin', { enabled: event.target.checked }) }}
              />
              <span style={switchCopyStyle}>
                <span style={switchLabelStyle}>{t('poolAutoCheckin')}</span>
                <span style={hintStyle}>{t('poolAutoCheckinHint')}</span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div style={cardHeadStyle}>
          <h3 style={cardTitleStyle}>{t('poolAccounts')}</h3>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy}
            onClick={() => { void act('rediscover') }}
          >
            {busy ? t('poolWorking') : t('poolRediscover')}
          </button>
        </div>
        <div style={cardBodyStyle}>
          <p style={hintStyle}>{t('poolMembersHint')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
            {accounts.length === 0
              ? <p style={emptyStyle}>{t('poolNoAccounts')}</p>
              : accounts.map(account => (
                  <AccountRow
                    key={`${account.variant}:${account.id}`}
                    account={account}
                    t={t}
                    disabled={busy}
                    onToggle={toggleMember}
                  />
                ))}
          </div>
        </div>
      </section>

      {/*
        Import. A file input plus a paste box, because the two ways a user has a
        credential differ: a `.info` copied from another machine is a file, while
        a value lifted out of a running app is text. Both go through the same
        host action, which validates before storing.
      */}
      <section style={cardStyle}>
        <div style={cardHeadStyle}>
          <h3 style={cardTitleStyle}>{t('poolImport')}</h3>
        </div>
        <div style={cardBodyStyle}>
          <p style={hintStyle}>{t('poolImportHint')}</p>
          <div style={{ marginTop: 10 }}>
            <input
              type="file"
              accept=".info,application/json"
              disabled={busy}
              aria-label={t('poolImportFile')}
              onChange={event => {
                const file = event.target.files?.[0]
                // Reset so choosing the SAME file twice still fires a change
                // event — otherwise a failed import could not be retried.
                event.target.value = ''
                if (file === undefined) return
                void file.text().then(text => act('import-credential', { text }))
              }}
            />
          </div>
          <ImportPasteBox t={t} disabled={busy} onImport={text => act('import-credential', { text })} />
          {imported.length === 0
            ? null
            : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
                  {imported.map(entry => (
                    <ImportedRow
                      key={entry.accountId === '' ? `${entry.accountName ?? 'unknown'}-${entry.reason ?? ''}` : entry.accountId}
                      entry={entry}
                      t={t}
                      disabled={busy}
                      onRemove={id => { void act('remove-imported', { accountId: id }) }}
                    />
                  ))}
                </div>
              )}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={cardHeadStyle}>
          <h3 style={cardTitleStyle}>{t('poolCheckin')}</h3>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy}
            onClick={() => { void act('checkin') }}
          >
            {t('poolCheckinRun')}
          </button>
        </div>
        <div style={cardBodyStyle}>
          <p style={hintStyle}>{t('poolCheckinHint')}</p>
          {(document.lastCheckin ?? []).length === 0
            ? <p style={emptyStyle}>{t('poolCheckinNever')}</p>
            : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
                  {(document.lastCheckin ?? []).map(row => (
                    <div key={row.accountId} style={accountRowStyle}>
                      <span style={accountNameStyle}>{row.accountName === '' ? row.accountId : row.accountName}</span>
                      <Chip style={row.status === 'failed' ? chipWarnStyle : undefined}>
                        {t(`poolCheckin_${row.status}` as 'poolCheckin_claimed')}
                      </Chip>
                      {row.credit === undefined ? null : <Chip>+{row.credit}</Chip>}
                    </div>
                  ))}
                </div>
              )}
        </div>
      </section>
    </div>
  )
}
