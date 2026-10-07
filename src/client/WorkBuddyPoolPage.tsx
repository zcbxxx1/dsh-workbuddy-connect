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
 * @module dsh-workbuddy-connect/client/WorkBuddyPoolPage
 */

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkBuddyPoolDocument, WorkBuddyWebPoolAccount } from '../status-paths.ts'
import { WORKBUDDY_POOL_PATH } from '../status-paths.ts'

/** Props the settings shell delivers to a `settings.section` entry. */
export type WorkBuddyPoolPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.workbuddy'>

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }
const cardStyle: CSSProperties = { border: '1px solid var(--dsh-border, #3a3a3a)', borderRadius: 8, padding: 12 }
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', flexWrap: 'wrap',
}
const mutedStyle: CSSProperties = { opacity: 0.65, fontSize: 12 }
const dangerStyle: CSSProperties = { color: 'var(--dsh-danger, #e06c75)' }
const buttonStyle: CSSProperties = { padding: '4px 10px', cursor: 'pointer' }

/** How often the page re-reads the document. */
const POLL_MS = 15_000

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
  return (
    <div style={rowStyle}>
      <input
        type="checkbox"
        checked={account.member}
        disabled={disabled}
        aria-label={account.name === '' ? account.id : account.name}
        onChange={event => { onToggle(account.id, event.target.checked) }}
      />
      <span style={{ minWidth: 180 }}>{account.name === '' ? t('poolUnnamed') : account.name}</span>
      <span style={mutedStyle}>{account.id.slice(0, 20)}</span>
      {account.live ? <span style={mutedStyle}>· {t('poolLive')}</span> : null}
      <span style={mutedStyle}>· {t('poolVariant')}: {account.variant}</span>
      <span style={mutedStyle}>· {t('poolExpires')}: {expiry}</span>
      {/*
        Credits: `unlimited` first, then a number, then "unknown" — never a
        zero. The billing route fails for some accounts (HTTP 500 on two of
        four here), and rendering that as 0 would assert an empty account.
        The reason rides the tooltip so the row stays one line.
      */}
      {account.creditsUnlimited === true
        ? <span style={mutedStyle}>· {t('poolCredits')}: {t('poolCreditsUnlimited')}</span>
        : account.credits === undefined
          ? (
              <span style={mutedStyle} title={account.creditsError ?? ''}>
                · {t('poolCredits')}: {t('poolCreditsUnknown')}
              </span>
            )
          : <span style={mutedStyle}>· {t('poolCredits')}: {account.credits}</span>}
      {account.excludedBy === undefined
        ? null
        : (
            <span style={dangerStyle} title={account.excludedReason ?? ''}>
              · {t('poolExcluded')}: {account.excludedBy}
              {/*
                The stated recovery instant, so "when does this come back" is
                answerable from the page. Absent when upstream named no time
                (a transport failure): saying "unknown" is honest, and a
                countdown invented from the local fallback would not be.
              */}
              {account.excludedUntilMs === undefined
                ? ` · ${t('poolRecoversUnknown')}`
                : ` · ${t('poolRecoversAt')} ${new Date(account.excludedUntilMs).toLocaleString()}`}
            </span>
          )}
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
        style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
        onChange={event => { setText(event.target.value) }}
      />
      <span>
        <button
          type="button"
          style={buttonStyle}
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
        : <p style={dangerStyle}>{t('poolReadFailed')}: {readFailure}</p>}

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t('poolTitle')}</h3>
        <p style={mutedStyle}>{t('poolIntro')}</p>
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={document.enabled}
            disabled={busy}
            onChange={event => { void act('set-enabled', { enabled: event.target.checked }) }}
          />
          <span>{t('poolEnabled')}</span>
        </label>
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={document.autoCheckin}
            disabled={busy}
            onChange={event => { void act('set-auto-checkin', { enabled: event.target.checked }) }}
          />
          <span>{t('poolAutoCheckin')}</span>
        </label>
        <p style={mutedStyle}>{t('poolAutoCheckinHint')}</p>
      </section>

      <section style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('poolAccounts')}</h3>
          <span>
            <button
              type="button"
              style={buttonStyle}
              disabled={busy}
              onClick={() => { void act('rediscover') }}
            >
              {t('poolRediscover')}
            </button>
          </span>
        </div>
        <p style={mutedStyle}>{t('poolMembersHint')}</p>
        {accounts.length === 0
          ? <p style={mutedStyle}>{t('poolNoAccounts')}</p>
          : accounts.map(account => (
              <AccountRow
                key={`${account.variant}:${account.id}`}
                account={account}
                t={t}
                disabled={busy}
                onToggle={toggleMember}
              />
            ))}
      </section>

      {/*
        Import. A file input plus a paste box, because the two ways a user has a
        credential differ: a `.info` copied from another machine is a file, while
        a value lifted out of a running app is text. Both go through the same
        host action, which validates before storing.
      */}
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t('poolImport')}</h3>
        <p style={mutedStyle}>{t('poolImportHint')}</p>
        <div style={rowStyle}>
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
          : imported.map(entry => (
              <div key={entry.accountId === '' ? `${entry.accountName ?? 'unknown'}-${entry.reason ?? ''}` : entry.accountId} style={rowStyle}>
                <span style={{ minWidth: 180 }}>
                  {entry.accountName ?? (entry.accountId === '' ? t('poolImportUnreadable') : entry.accountId)}
                </span>
                {entry.readable
                  ? null
                  : <span style={dangerStyle} title={entry.reason ?? ''}>· {t('poolImportBroken')}</span>}
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={busy || entry.accountId === ''}
                  onClick={() => { void act('remove-imported', { accountId: entry.accountId }) }}
                >
                  {t('poolImportRemove')}
                </button>
              </div>
            ))}
      </section>

      <section style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('poolCheckin')}</h3>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy}
            onClick={() => { void act('checkin') }}
          >
            {t('poolCheckinRun')}
          </button>
        </div>
        <p style={mutedStyle}>{t('poolCheckinHint')}</p>
        {(document.lastCheckin ?? []).length === 0
          ? null
          : (document.lastCheckin ?? []).map(row => (
              <div key={row.accountId} style={rowStyle}>
                <span style={{ minWidth: 180 }}>{row.accountName === '' ? row.accountId : row.accountName}</span>
                <span style={row.status === 'failed' ? dangerStyle : mutedStyle}>
                  {t(`poolCheckin_${row.status}` as 'poolCheckin_claimed')}
                </span>
                {row.credit === undefined ? null : <span style={mutedStyle}>· +{row.credit}</span>}
                {row.message === undefined ? null : <span style={mutedStyle}>· {row.message}</span>}
              </div>
            ))}
      </section>
    </div>
  )
}
