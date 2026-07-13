import {
  TOGGLE_LOGGING,
  TOGGLE_DIV_FILTERING,
  SET_FILTER_EFFECT,
  SET_TRAINED_MODEL,
  SET_FILTER_STRICTNESS,
  SET_WEBSITE_LIST,
  SET_VIDEO_SAMPLE_INTERVAL
} from './settingsTypes'

export const toggleLogging = () => ({ type: TOGGLE_LOGGING } as const)
export const toggleDivFiltering = () => ({ type: TOGGLE_DIV_FILTERING } as const)

export const setFilterEffect = (filterEffect: 'hide' | 'blur' | 'grayscale') => ({
  type: SET_FILTER_EFFECT,
  payload: { filterEffect }
} as const)

export const setTrainedModel = (trainedModel: 'MobileNet_v2' | 'InceptionV3') => ({
  type: SET_TRAINED_MODEL,
  payload: { trainedModel }
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
