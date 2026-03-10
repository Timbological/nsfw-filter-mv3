/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { setBackend, ready, enableProdMode } from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgpu'
import { load as loadModel } from 'nsfwjs'

import { ILogger, Logger } from '../utils/Logger'
import { SettingsState } from '../popup/redux/reducers/settings'
import { IReduxedStorage } from '../background/types'
import { RootState } from '../popup/redux/reducers'

import { Model } from '../background/Model'
import { DEFAULT_TAB_ID } from '../background/Queue/QueueBase'
import { QueueWrapper as Queue } from '../background/Queue/QueueWrapper'

enableProdMode()

// In-memory store — chrome.storage is not available in offscreen documents.
// Settings are pushed here from the service worker via messages.
const state: RootState = {
  settings: { logging: false, filterStrictness: 85, filterEffect: 'blur', trainedModel: 'MobileNet_v2', websites: [] },
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

let attempts = 0

type PendingPredict = { url: string, requestId: string, tabIdUrl: { tabId: number, tabUrl: string } }

// Register the listener immediately so no messages are dropped during model loading
let queue: Queue | null = null
let model: Model | null = null
let logger: ILogger = new Logger()
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

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'OFFSCREEN_INIT') {
    const settings = message.settings as SettingsState
    Object.assign(state.settings, settings)
    state.statistics.totalBlocked = message.totalBlocked as number ?? 0
    if (settings.logging) logger.enable()
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
    model?.setSettings({ filterStrictness: settings.filterStrictness })
    queue?.clearCache()
  }
})

const init = async (): Promise<void> => {
  // WebGPU doesn't use eval so it works within MV3 CSP; fall back to CPU if unavailable
  const gpuAvailable = await setBackend('webgpu').catch(() => false)
  if (!gpuAvailable) await setBackend('cpu')
  await ready()

  const load = (): void => {
    const { trainedModel, filterStrictness } = state.settings
    const modelPath = chrome.runtime.getURL(trainedModel === 'InceptionV3' ? 'models/inceptionv3/' : 'models/')
    const modelSize = trainedModel === 'InceptionV3' ? 299 : 224

    loadModel(modelPath, { type: 'graph', size: modelSize })
      .then(NSFWJSModel => {
        model = new Model(NSFWJSModel, logger, { filterStrictness })
        queue = new Queue(model, logger, store)

        // Flush any requests that arrived before the model was ready
        for (const { url, requestId, tabIdUrl } of buffered) {
          dispatchPredict(url, requestId, tabIdUrl)
        }
        buffered.length = 0
      })
      .catch(error => {
        logger.error(error)
        attempts++
        if (attempts < 5) setTimeout(load, 200)
        logger.log(`Reload model, attempt: ${attempts}`)
      })
  }

  load()
}

init()
