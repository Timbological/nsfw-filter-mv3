import { createStore } from 'redux'

import { createChromeStore } from '../popup/redux/chrome-storage'
import { rootReducer } from '../popup/redux/reducers'

import { DOMWatcher } from './DOMWatcher/DOMWatcher'
import { ImageFilter } from './Filter/ImageFilter'
import { VideoFilter } from './Filter/VideoFilter'

const init = (): void => {
  const imageFilter = new ImageFilter()
  const videoFilter = new VideoFilter()
  const domWatcher = new DOMWatcher(imageFilter, videoFilter)

  createChromeStore({ createStore })(rootReducer)
    .then(store => {
      const { filterEffect, websites, videoSampleInterval } = store.getState().settings
      imageFilter.setSettings({ filterEffect })
      // Coalesce: users upgrading from a build without this setting have no
      // persisted value, so fall back to the default rather than disabling.
      videoFilter.setSettings({ filterEffect, videoSampleInterval: videoSampleInterval ?? 3 })
      if (websites.includes(window.location.hostname) === false) {
        domWatcher.watch()
      }
    })
    .catch(error => {
      console.warn(error)
      imageFilter.setSettings({ filterEffect: 'blur' })
      videoFilter.setSettings({ filterEffect: 'blur', videoSampleInterval: 3 })
    })
}

// Ignore iframes, https://stackoverflow.com/a/326076/10432429
if (window.self === window.top) init()
