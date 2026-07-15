import { Button, Input, Select, Slider } from 'antd'
import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { setFilterStrictness } from '../../redux/actions/settings'
import {
  setFilterEffect,
  setWebsiteList,
  setVideoSampleInterval,
  setLock
} from '../../redux/actions/settings/index'
import { RootState } from '../../redux/reducers'
import { SettingsState } from '../../redux/reducers/settings'
import { StatisticsState } from '../../redux/reducers/statistics'
import { createLock, verifyLock, weakens, GuardedSettings } from '../../utils/lock'

import { Container, Stats, DropdownRow, TextBox } from './styles'

const { Option } = Select
const MIN_PASSWORD_LENGTH = 4

export const Production: React.FC = () => {
  const dispatch = useDispatch()
  const {
    filterStrictness,
    filterEffect,
    websites,
    videoSampleInterval,
    lock
  } = useSelector<RootState>((state) => state.settings) as SettingsState
  const { totalBlocked } = useSelector<RootState>((state) => state.statistics) as StatisticsState

  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [lockMessage, setLockMessage] = useState('')
  const [guardMessage, setGuardMessage] = useState('')

  const hasLock = lock !== null && lock !== undefined
  const locked = hasLock && !unlocked
  const current: GuardedSettings = { filterStrictness, websites, videoSampleInterval }

  // Apply a guarded change, unless it weakens protection while locked.
  const guard = (next: Partial<GuardedSettings>, apply: () => void): void => {
    if (locked && weakens(current, { ...current, ...next })) {
      setGuardMessage('🔒 Locked — enter the password below to reduce protection')
      return
    }
    setGuardMessage('')
    apply()
  }

  const handleSetPassword = async (): Promise<void> => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLockMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    dispatch(setLock(await createLock(password)))
    setPassword('')
    setUnlocked(true)
    setLockMessage('Protection on — weakening changes now need this password')
  }

  const handleUnlock = async (): Promise<void> => {
    if (lock !== null && lock !== undefined && await verifyLock(password, lock)) {
      setUnlocked(true)
      setPassword('')
      setLockMessage('')
      setGuardMessage('')
    } else {
      setLockMessage('Incorrect password')
    }
  }

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
          defaultValue={filterEffect}
          style={{ width: 140 }}
          onChange={value => dispatch(setFilterEffect(value))}
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
          value={websites.join(', ')}
          onChange={event => {
            const next = event.target.value.split(/\s*,\s*/)
            guard({ websites: next }, () => dispatch(setWebsiteList(next)))
          }}
        />
      </TextBox>

      {/* Settings lock: gate weakening changes behind a parent-set password. */}
      {!hasLock
        ? (
          <TextBox>
            <div>Set protection password (optional)</div>
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={event => { setPassword(event.target.value); setLockMessage('') }}
            />
            <Button type="primary" style={{ marginTop: 8 }} onClick={() => { handleSetPassword().catch(() => undefined) }}>
              Set password
            </Button>
            {lockMessage !== '' && <div style={{ marginTop: 8 }}>{lockMessage}</div>}
          </TextBox>
        )
        : locked
          ? (
            <TextBox>
              <div>🔒 Settings locked</div>
              <Input
                type="password"
                placeholder="Password to reduce protection"
                value={password}
                onChange={event => { setPassword(event.target.value); setLockMessage('') }}
              />
              <Button type="primary" style={{ marginTop: 8 }} onClick={() => { handleUnlock().catch(() => undefined) }}>
                Unlock
              </Button>
              {lockMessage !== '' && <div style={{ marginTop: 8, color: '#cf1322' }}>{lockMessage}</div>}
            </TextBox>
          )
          : (
            <TextBox>
              <div>🔓 Unlocked</div>
              <Button style={{ marginRight: 8 }} onClick={() => setUnlocked(false)}>Re-lock</Button>
              <Button danger onClick={() => { dispatch(setLock(null)); setUnlocked(false) }}>Remove password</Button>
            </TextBox>
          )}
    </Container>)
  )
}
