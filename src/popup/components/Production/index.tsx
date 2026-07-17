import { Button, Checkbox, Input, Select, Slider } from 'antd'
import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { setFilterStrictness } from '../../redux/actions/settings'
import {
  setFilterEffect,
  setWebsiteList,
  setVideoSampleInterval,
  setLock,
  setLockAllSettings,
  setBlockExtensionsPage,
  setExtensionsPageAllowedUntil
} from '../../redux/actions/settings/index'
import { RootState } from '../../redux/reducers'
import { SettingsState } from '../../redux/reducers/settings'
import { StatisticsState } from '../../redux/reducers/statistics'
import { createLock, verifyLock, weakens, GuardedSettings } from '../../utils/lock'

import { Container, Stats, DropdownRow, TextBox, LockSection } from './styles'

const { Option } = Select
const MIN_PASSWORD_LENGTH = 4
// How long after an unlock chrome://extensions stays reachable for the parent.
const EXTENSIONS_GRACE_MS = 5 * 60 * 1000

export const Production: React.FC = () => {
  const dispatch = useDispatch()
  const {
    filterStrictness,
    filterEffect,
    websites,
    videoSampleInterval,
    lock,
    lockAllSettings,
    blockExtensionsPage
  } = useSelector<RootState>((state) => state.settings) as SettingsState
  const { totalBlocked } = useSelector<RootState>((state) => state.statistics) as StatisticsState

  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [lockMessage, setLockMessage] = useState('')
  const [guardMessage, setGuardMessage] = useState('')
  // In-progress whitelist text; null means "not editing, show the stored list".
  const [websitesDraft, setWebsitesDraft] = useState<string | null>(null)

  const hasLock = lock !== null && lock !== undefined
  const locked = hasLock && !unlocked
  const current: GuardedSettings = {
    filterStrictness,
    filterEffect,
    websites,
    videoSampleInterval,
    lockAllSettings: lockAllSettings === true,
    blockExtensionsPage: blockExtensionsPage === true
  }

  // Apply a guarded change unless it's blocked while locked. In "lock all"
  // mode every guarded change needs the password; otherwise only weakenings do.
  const guard = (next: Partial<GuardedSettings>, apply: () => void): void => {
    if (locked && (lockAllSettings === true || weakens(current, { ...current, ...next }))) {
      setGuardMessage(lockAllSettings === true
        ? '🔒 Locked — enter the password below to change settings'
        : '🔒 Locked — enter the password below to reduce protection')
      return
    }
    setGuardMessage('')
    apply()
  }

  // Let the parent through to chrome://extensions for a while after they prove
  // the password (or just set it).
  const grantExtensionsAccess = (): void => {
    dispatch(setExtensionsPageAllowedUntil(Date.now() + EXTENSIONS_GRACE_MS))
  }

  const handleSetPassword = async (): Promise<void> => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLockMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    dispatch(setLock(await createLock(password)))
    grantExtensionsAccess()
    setPassword('')
    setUnlocked(true)
    setLockMessage('Protection on — weakening changes now need this password')
  }

  const handleUnlock = async (): Promise<void> => {
    if (lock !== null && lock !== undefined && await verifyLock(password, lock)) {
      grantExtensionsAccess()
      setUnlocked(true)
      setPassword('')
      setLockMessage('')
      setGuardMessage('')
    } else {
      setLockMessage('Incorrect password')
    }
  }

  const parseHosts = (text: string): string[] =>
    text.split(/\s*,\s*/).map(host => host.trim()).filter(host => host.length > 0)

  // Whitelist edits commit on blur / Enter, not per keystroke: diffing a freeform
  // comma list on every keystroke mistakes the middle of a deletion (e.g. "b.co"
  // while removing "b.com") for adding a host, which blocked removals and let
  // stray commas through while locked. Unlocked edits still save live.
  const commitWebsites = (): void => {
    if (websitesDraft === null) return
    const next = parseHosts(websitesDraft)
    guard({ websites: next }, () => dispatch(setWebsiteList(next)))
    setWebsitesDraft(null)
  }

  const toggleLockAll = (checked: boolean): void =>
    guard({ lockAllSettings: checked }, () => dispatch(setLockAllSettings(checked)))

  const toggleBlockExtensions = (checked: boolean): void =>
    guard({ blockExtensionsPage: checked }, () => {
      dispatch(setBlockExtensionsPage(checked))
      // Don't lock the parent out the instant they enable it.
      if (checked) grantExtensionsAccess()
    })

  const protectionOptions = (
    <>
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={lockAllSettings === true} onChange={event => toggleLockAll(event.target.checked)}>
          Lock all settings, not just weakening
        </Checkbox>
      </div>
      <div>
        <Checkbox checked={blockExtensionsPage === true} onChange={event => toggleBlockExtensions(event.target.checked)}>
          Block the Chrome extensions page
        </Checkbox>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          Needs a password. A deterrent only — use Family Link to truly prevent removal.
        </div>
      </div>
    </>
  )

  return (
    (<Container>
      <Stats>
        <span>Total blocked: {totalBlocked}</span>
      </Stats>
      {guardMessage !== '' && <div style={{ color: '#cf1322' }}>{guardMessage}</div>}
      <div>Filter strictness: {filterStrictness}%</div>
      <Slider
        min={1}
        max={100}
        onChange={(value: number) => guard({ filterStrictness: value }, () => dispatch(setFilterStrictness(value)))}
        value={filterStrictness}
        tooltip={{
          formatter: null
        }}
      />
      <DropdownRow>
        <span>Filter effect</span>
        <Select
          value={filterEffect}
          style={{ width: 140 }}
          onChange={value => guard({ filterEffect: value }, () => dispatch(setFilterEffect(value)))}
        >
          <Option value="hide">Hide</Option>
          <Option value="blur">Blur</Option>
          <Option value="grayscale">Grayscale</Option>
        </Select>
      </DropdownRow>
      <DropdownRow>
        <span>Scan videos</span>
        <Select
          value={videoSampleInterval ?? 3}
          style={{ width: 140 }}
          onChange={value => guard({ videoSampleInterval: value }, () => dispatch(setVideoSampleInterval(value)))}
        >
          <Option value={0}>Off</Option>
          <Option value={2}>Every 2s</Option>
          <Option value={3}>Every 3s</Option>
          <Option value={5}>Every 5s</Option>
          <Option value={10}>Every 10s</Option>
        </Select>
      </DropdownRow>
      <div>Whitelisted websites</div>
      <TextBox>
        <Input
          placeholder="www.x.com, www.facebook.com"
          value={websitesDraft ?? websites.join(', ')}
          onChange={event => {
            const raw = event.target.value
            setWebsitesDraft(raw)
            // Unlocked: save live (no lock to enforce). Locked: hold the draft
            // and let commitWebsites decide on blur/Enter.
            if (!locked) dispatch(setWebsiteList(parseHosts(raw)))
          }}
          onBlur={commitWebsites}
          onPressEnter={commitWebsites}
        />
      </TextBox>

      {/* Settings lock: gate weakening changes behind a parent-set password. */}
      {!hasLock
        ? (
          <LockSection>
            <div>Set protection password (optional)</div>
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={event => { setPassword(event.target.value); setLockMessage('') }}
            />
            <Button type="primary" onClick={() => { handleSetPassword().catch(() => undefined) }}>
              Set password
            </Button>
            {protectionOptions}
            {lockMessage !== '' && <div>{lockMessage}</div>}
          </LockSection>
        )
        : locked
          ? (
            <LockSection>
              <div>🔒 Settings locked</div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={event => { setPassword(event.target.value); setLockMessage('') }}
                onPressEnter={() => { handleUnlock().catch(() => undefined) }}
              />
              <Button type="primary" onClick={() => { handleUnlock().catch(() => undefined) }}>
                Unlock
              </Button>
              {lockMessage !== '' && <div style={{ color: '#cf1322' }}>{lockMessage}</div>}
            </LockSection>
          )
          : (
            <LockSection>
              <div>🔓 Unlocked</div>
              <div>
                <Button style={{ marginRight: 8 }} onClick={() => setUnlocked(false)}>Re-lock</Button>
                <Button danger onClick={() => { dispatch(setLock(null)); setUnlocked(false) }}>Remove password</Button>
              </div>
              {protectionOptions}
            </LockSection>
          )}
    </Container>)
  )
}
