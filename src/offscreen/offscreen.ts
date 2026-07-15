/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { setBackend, ready, enableProdMode } from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgpu'
import { load as loadModel } from 'nsfwjs'

import { Model } from '../background/Model'
import { DEFAULT_TAB_ID } from '../background/Queue/QueueBase'
import { QueueWrapper as Queue } from '../background/Queue/QueueWrapper'
import { IReduxedStorage } from '../background/types'
import { RootState } from '../popup/redux/reducers'
import { SettingsState } from '../popup/redux/reducers/settings'
import { ILogger, Logger } from '../utils/Logger'

import { ModelController } from './ModelController'

enableProdMode()

// In-memory store — chrome.storage is not available in offscreen documents.
// Settings are pushed here from the service worker via messages.
const state: RootState = {
  settings: { logging: false, filterStrictness: 85, filterEffect: 'blur', trainedModel: 'MobileNet_v2', websites: [], videoSampleInterval: 3 },
  statistics: { totalBlocked: 0 },
  appearance: { darkTheme: true }
}

const store: IReduxedStorage = {
  getState: () => state,
  dispatch: async (action) => {
    if ('payload' in action && 'totalBlocked' in (action.payload as object)) {
      const totalBlocked = (action.payload as { totalBlocked: number }).totalBlocked
      state.statistics.totalBlocked = totalBlocked
      // Relay to service worker which has chrome.storage access
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_TOTAL_BLOCKED', totalBlocked }).catch(() => {})
    }
  }
}

type PendingPredict = { url: string, requestId: string, tabIdUrl: { tabId: number, tabUrl: string } }

// Register the listener immediately so no messages are dropped during model loading
let queue: Queue | null = null
let model: Model | null = null
const logger: ILogger = new Logger()
const buffered: PendingPredict[] = []

function dispatchPredict (url: string, requestId: string, tabIdUrl: { tabId: number, tabUrl: string }): void {
  if (queue === null) {
    buffered.push({ url, requestId, tabIdUrl })
    return
  }
  queue.predict(url, tabIdUrl)
    .then(result => {
      chrome.runtime.sendMessage({ type: 'PREDICTION_RESULT', requestId, result, url }).catch(() => {})
    })
    .catch((err: Error) => {
      chrome.runtime.sendMessage({
        type: 'PREDICTION_RESULT', requestId, result: false, url, error: err.message
      }).catch(() => {})
    })
}

// Owns model loading/switching. The previous model keeps serving predictions
// until a newly-selected one is fully loaded, so switching never un-blocks
// content mid-flight.
const modelController = new ModelController<Model>({
  loadFn: async () => {
    // Only MobileNet_v2 ships — a TFJS *graph* model, which runs reliably on the
    // WebGPU backend. (InceptionV3 was removed in 3.2.1: as a Keras *layers*
    // model it produced garbage verdicts on WebGPU, silently failing open.)
    const modelPath = chrome.runtime.getURL('models/')
    const nsfwjsModel = await loadModel(modelPath, { type: 'graph', size: 224 })
    return new Model(nsfwjsModel, logger, { filterStrictness: state.settings.filterStrictness })
  },
  onReady: (newModel, trainedModel) => {
    // Atomic swap: a fresh queue (empty cache) bound to the new model. The old
    // model/queue are dropped only now that the replacement is live. We don't
    // dispose the old model synchronously so any in-flight predictions on the
    // old queue can finish rather than error out (and reveal) mid-switch.
    model = newModel
    model.setSettings({ filterStrictness: state.settings.filterStrictness })
    queue = new Queue(model, logger, store)

    // Flush requests buffered before the first model was ready.
    for (const { url, requestId, tabIdUrl } of buffered) {
      dispatchPredict(url, requestId, tabIdUrl)
    }
    buffered.length = 0
    logger.log(`Model ready: ${trainedModel}`)
  },
  onError: (error, trainedModel) => {
    logger.error(error)
    logger.log(`Model load failed after retries: ${trainedModel}`)
  }
})

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'OFFSCREEN_INIT') {
    const settings = message.settings as SettingsState
    Object.assign(state.settings, settings)
    state.statistics.totalBlocked = message.totalBlocked as number ?? 0
    if (settings.logging) logger.enable()
    // Closes the cold-start race: init() may have kicked off a load with the
    // default model before the stored choice arrived; switch if they differ.
    modelController.select(state.settings.trainedModel)
  }

  if (message.type === 'OFFSCREEN_PREDICT') {
    const { url, requestId, tabIdUrl } = message
    const resolvedTabIdUrl = tabIdUrl ?? { tabId: DEFAULT_TAB_ID, tabUrl: `${DEFAULT_TAB_ID}` }
    dispatchPredict(url, requestId, resolvedTabIdUrl)
  }

  if (message.type === 'OFFSCREEN_TAB_ADD') queue?.addTabIdUrl(message.tabIdUrl)
  if (message.type === 'OFFSCREEN_TAB_UPDATE') queue?.updateTabIdUrl(message.tabIdUrl)
  if (message.type === 'OFFSCREEN_TAB_REMOVE') queue?.clearByTabId(message.tabId)
  if (message.type === 'OFFSCREEN_TAB_ACTIVATE') queue?.setActiveTabId(message.tabId)

  if (message.type === 'OFFSCREEN_CLEAR_CACHE') {
    const settings = message.settings as SettingsState
    Object.assign(state.settings, settings)
    settings.logging ? logger.enable() : logger.disable()
    // Strictness applies live to the current model...
    model?.setSettings({ filterStrictness: settings.filterStrictness })
    // ...and a model change hot-swaps (onReady builds a fresh, empty-cache
    // queue, so no explicit clearCache is needed on switch). If the model is
    // unchanged, select() is a no-op and we just clear the existing cache.
    if (settings.trainedModel === modelController.loaded) queue?.clearCache()
    modelController.select(settings.trainedModel)
  }
})

const init = async (): Promise<void> => {
  // WebGPU doesn't use eval so it works within MV3 CSP; fall back to CPU if unavailable
  const gpuAvailable = await setBackend('webgpu').catch(() => false)
  if (!gpuAvailable) await setBackend('cpu')
  await ready()

  // Kick off the initial load from whatever settings we have so far (may still
  // be the default if OFFSCREEN_INIT hasn't arrived yet — the INIT handler
  // reconciles via select()).
  modelController.select(state.settings.trainedModel)
}

init()
