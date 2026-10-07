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
            </span>
          )}
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
   */
  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const key = document?.poolKey
    if (key === undefined) return
    const mine = ++seq.current
    setBusy(true)
    try {
      const response = await fetch(WORKBUDDY_POOL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workbuddy-pool-key': key },
        body: JSON.stringify({ action, ...extra }),
      })
      const answer = await response.json() as { state?: string, document?: WorkBuddyPoolDocument, reason?: string }
      if (!mounted.current || mine !== seq.current) return
      if (answer.document !== undefined) setDocument(answer.document)
      setReadFailure(answer.state === 'failed' ? (answer.reason ?? 'action failed') : undefined)
    } catch (error: unknown) {
      if (mounted.current && mine === seq.current) {
        setReadFailure(error instanceof Error ? error.message : String(error))
      }
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
