import { SettingsState } from '../popup/redux/reducers/settings'
import { StatisticsState } from '../popup/redux/reducers/statistics'

const OFFSCREEN_DOCUMENT_URL = 'src/offscreen.html'
const STORAGE_KEY = 'nsfw-filter-redux-storage'
const DEFAULT_TAB_ID = 999999

// Map of requestId -> sendResponse callback for pending predictions
const pendingRequests = new Map<string, (response: object) => void>()

async function readSettings (): Promise<{ settings: SettingsState, statistics: StatisticsState }> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const state = (stored[STORAGE_KEY] ?? {}) as Partial<{ settings: SettingsState, statistics: StatisticsState }>
  return {
    settings: state.settings ?? { logging: false, filterStrictness: 85, filterEffect: 'blur', trainedModel: 'MobileNet_v2' as const, websites: [] },
    statistics: state.statistics ?? { totalBlocked: 0 }
  }
}

async function saveTotalBlocked (totalBlocked: number): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const state = (stored[STORAGE_KEY] ?? {}) as object
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...state, statistics: { totalBlocked } } })
}

async function ensureOffscreenDocument (): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  })
  if (existingContexts.length > 0) return

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_URL,
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
    justification: 'NSFW image classification requires DOM access for loading images'
  })

  // Send initial settings to offscreen once it's created
  const { settings, statistics } = await readSettings()
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_INIT', settings, totalBlocked: statistics.totalBlocked }).catch(() => {})
}

function buildTabIdUrl (tab: chrome.tabs.Tab): { tabId: number, tabUrl: string } {
  return {
    tabId: tab?.id ?? DEFAULT_TAB_ID,
    tabUrl: tab?.url ?? `${DEFAULT_TAB_ID}`
  }
}

// Start the offscreen document on service worker startup
ensureOffscreenDocument().catch(console.error)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Stats update from offscreen (chrome.storage not available there)
  if (message.type === 'OFFSCREEN_TOTAL_BLOCKED') {
    saveTotalBlocked(message.totalBlocked as number).catch(console.error)
    return
  }

  // Response from offscreen document
  if (message.type === 'PREDICTION_RESULT') {
    const { requestId, result, url, error } = message
    const pending = pendingRequests.get(requestId)
    if (pending != null) {
      pendingRequests.delete(requestId)
      const errorMsg = typeof error === 'string' && error.length > 0 ? error : undefined
      const responseMsg = errorMsg != null
        ? `Prediction result is ${result as boolean} for image ${url as string}, error: ${errorMsg}`
        : `Prediction result is ${result as boolean} for image ${url as string}`
      pending({ result, url, message: responseMsg })
    }
    return
  }

  // Ignore internal extension messages
  if (message.type === 'SIGN_CONNECT') return

  // Prediction request from content script
  const { url } = message
  const requestId = `${Date.now()}-${Math.random()}`
  const tabIdUrl = buildTabIdUrl(sender.tab as chrome.tabs.Tab)

  pendingRequests.set(requestId, sendResponse)

  ensureOffscreenDocument()
    .then(() => chrome.runtime.sendMessage({
      type: 'OFFSCREEN_PREDICT',
      url,
      requestId,
      tabIdUrl
    }))
    .catch(err => {
      const pending = pendingRequests.get(requestId)
      if (pending != null) {
        pendingRequests.delete(requestId)
        pending({ result: false, url, message: `Background error: ${err.message as string}` })
      }
    })

  return true // Keep message channel open for async response
})

chrome.tabs.onCreated.addListener(tab => {
  ensureOffscreenDocument()
    .then(() => chrome.runtime.sendMessage({ type: 'OFFSCREEN_TAB_ADD', tabIdUrl: buildTabIdUrl(tab) }))
    .catch(() => {})
})

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_TAB_REMOVE', tabId }).catch(() => {})
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_TAB_UPDATE', tabIdUrl: buildTabIdUrl(tab) }).catch(() => {})
  }
})

chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_TAB_ACTIVATE', tabId: activeInfo.tabId }).catch(() => {})
})

chrome.runtime.onConnect.addListener(port => {
  port.onDisconnect.addListener(() => {
    readSettings()
      .then(({ settings }) => chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLEAR_CACHE', settings }))
      .catch(() => {})
  })
})
