import { LockCredential } from '../../../utils/lock'

import {
  TOGGLE_LOGGING,
  TOGGLE_DIV_FILTERING,
  SET_FILTER_EFFECT,
  SET_FILTER_STRICTNESS,
  SET_WEBSITE_LIST,
  SET_VIDEO_SAMPLE_INTERVAL,
  SET_LOCK,
  SET_LOCK_ALL_SETTINGS,
  SET_BLOCK_EXTENSIONS_PAGE,
  SET_EXTENSIONS_PAGE_ALLOWED_UNTIL
} from './settingsTypes'

export const toggleLogging = () => ({ type: TOGGLE_LOGGING } as const)
export const toggleDivFiltering = () => ({ type: TOGGLE_DIV_FILTERING } as const)

export const setFilterEffect = (filterEffect: 'hide' | 'blur' | 'grayscale') => ({
  type: SET_FILTER_EFFECT,
  payload: { filterEffect }
} as const)

export const setFilterStrictness = (filterStrictness: number) => ({
  type: SET_FILTER_STRICTNESS,
  payload: { filterStrictness }
} as const)

export const setWebsiteList = (websites: string[]) => ({
  type: SET_WEBSITE_LIST,
  payload: { websites }
} as const)

// 0 disables video scanning entirely; otherwise seconds between frame samples.
export const setVideoSampleInterval = (videoSampleInterval: number) => ({
  type: SET_VIDEO_SAMPLE_INTERVAL,
  payload: { videoSampleInterval }
} as const)

// Set the settings-lock password credential, or null to remove the lock.
export const setLock = (lock: LockCredential | null) => ({
  type: SET_LOCK,
  payload: { lock }
} as const)

// When true (and locked), ALL settings changes need the password, not just
// weakening ones.
export const setLockAllSettings = (lockAllSettings: boolean) => ({
  type: SET_LOCK_ALL_SETTINGS,
  payload: { lockAllSettings }
} as const)

// When true (and a lock is set), navigations to chrome://extensions are
// redirected — unless within the post-unlock grace window.
export const setBlockExtensionsPage = (blockExtensionsPage: boolean) => ({
  type: SET_BLOCK_EXTENSIONS_PAGE,
  payload: { blockExtensionsPage }
} as const)

// Timestamp (ms) until which chrome://extensions is allowed after an unlock.
export const setExtensionsPageAllowedUntil = (extensionsPageAllowedUntil: number) => ({
  type: SET_EXTENSIONS_PAGE_ALLOWED_UNTIL,
  payload: { extensionsPageAllowedUntil }
} as const)
