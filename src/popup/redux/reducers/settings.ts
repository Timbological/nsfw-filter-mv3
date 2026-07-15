
import { SettingsActionTypes } from '../actions/settings'
import {
  TOGGLE_LOGGING,
  SET_FILTER_EFFECT,
  SET_FILTER_STRICTNESS,
  SET_WEBSITE_LIST,
  SET_VIDEO_SAMPLE_INTERVAL
} from '../actions/settings/settingsTypes'

export type SettingsState = {
  logging: boolean
  filterEffect: 'hide' | 'blur' | 'grayscale'
  // Only MobileNet_v2 ships. InceptionV3 was removed in 3.2.1: as a Keras
  // layers model it produced garbage verdicts on the WebGPU backend (fail-open)
  // and was more permissive than MobileNet even when working.
  trainedModel: 'MobileNet_v2'
  filterStrictness: number
  websites: string[]
  // Seconds between video frame samples. 0 disables video scanning.
  videoSampleInterval: number
}

const initialState: SettingsState = {
  logging: process.env.NODE_ENV === 'development',
  filterEffect: 'blur',
  trainedModel: 'MobileNet_v2',
  filterStrictness: 85,
  websites: [],
  videoSampleInterval: 3
}

export function settings (state = initialState, action: SettingsActionTypes): SettingsState {
  switch (action.type) {
    case TOGGLE_LOGGING:
      return { ...state, logging: !state.logging }
    case SET_FILTER_EFFECT:
      return { ...state, filterEffect: action.payload.filterEffect }
    case SET_FILTER_STRICTNESS:
      return { ...state, filterStrictness: action.payload.filterStrictness }
    case SET_WEBSITE_LIST:
      return { ...state, websites: action.payload.websites }
    case SET_VIDEO_SAMPLE_INTERVAL:
      return { ...state, videoSampleInterval: action.payload.videoSampleInterval }
    default:
      return state
  }
}
