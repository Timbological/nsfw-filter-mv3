import { createStore } from 'redux'

import { createChromeStore } from '../popup/redux/chrome-storage'
import { rootReducer } from '../popup/redux/reducers'

import { DOMWatcher } from './DOMWatcher/DOMWatcher'
import { ImageFilter } from './Filter/ImageFilter'
import { VideoFilter } from './Filter/VideoFilter'

// chrome.storage reads are async, so between document_start (when this script
// runs) and the store resolving + the observer attaching, images can parse and
// flash before the filter hides them. Inject a stylesheet up-front that hides
// every <img> the filter hasn't tagged yet; per-image inline styles take over
// the moment ImageFilter sets data-nsfw-filter-status, so blur/grayscale modes
// are unaffected. It also covers images added later, before the observer
// callback can hide them.
const HIDE_STYLE_ID = 'nsfw-filter-pending-hide'
// Backstop: if the store never settles, reveal images rather than leaving the
// page permanently blank (matches the "show images if we can't filter"
// degradation of the .catch branch below).
const HIDE_STYLE_SAFETY_TIMEOUT = 4000

const injectPendingHide = (): void => {
  const style = document.createElement('style')
  style.id = HIDE_STYLE_ID
  style.textContent = 'img:not([data-nsfw-filter-status]){visibility:hidden !important}'
  document.documentElement.appendChild(style)
}

const removePendingHide = (): void => {
  document.getElementById(HIDE_STYLE_ID)?.remove()
}

const init = (): void => {
  const imageFilter = new ImageFilter()
  const videoFilter = new VideoFilter()
  const domWatcher = new DOMWatcher(imageFilter, videoFilter)

  injectPendingHide()
  const safety = window.setTimeout(removePendingHide, HIDE_STYLE_SAFETY_TIMEOUT)

  createChromeStore({ createStore })(rootReducer)
    .then(store => {
      window.clearTimeout(safety)
      const { filterEffect, websites, videoSampleInterval } = store.getState().settings
      imageFilter.setSettings({ filterEffect })
      // Coalesce: users upgrading from a build without this setting have no
      // persisted value, so fall back to the default rather than disabling.
      videoFilter.setSettings({ filterEffect, videoSampleInterval: videoSampleInterval ?? 3 })
      if (websites.includes(window.location.hostname) === false) {
        // Keep the pending-hide stylesheet in place: from here per-image tagging
        // governs visibility.
        domWatcher.watch()
      } else {
        // Filtering disabled for this site: reveal everything.
        removePendingHide()
      }
    })
    .catch(error => {
      console.warn(error)
      window.clearTimeout(safety)
      removePendingHide()
      imageFilter.setSettings({ filterEffect: 'blur' })
      videoFilter.setSettings({ filterEffect: 'blur', videoSampleInterval: 3 })
    })
}

// Ignore iframes, https://stackoverflow.com/a/326076/10432429
if (window.self === window.top) init()
