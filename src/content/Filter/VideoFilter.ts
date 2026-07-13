import { PredictionRequest } from '../../utils/messages'

import { Filter } from './Filter'

type videoFilterSettingsType = {
  filterEffect: 'blur' | 'hide' | 'grayscale'
  // Seconds between frame samples of a playing video. 0 disables video scanning.
  videoSampleInterval: number
}

export type IVideoFilter = {
  analyzeVideo: (video: HTMLVideoElement) => void
  setSettings: (settings: videoFilterSettingsType) => void
  isEnabled: () => boolean
}

// Videos can't be classified by URL the way images are (streams are usually
// MSE/HLS/DASH, not a single decodable file). Instead we sample decoded frames
// onto a canvas, turn each into a data: URL and push it through the exact same
// prediction pipeline the ImageFilter uses. The poster image, when present, is
// a normal URL so it is classified directly and cheaply.
//
// Limitation: drawImage()/toDataURL() throws a SecurityError when the frame
// tainted the canvas (cross-origin video without CORS headers, or DRM/EME). We
// try a one-shot crossOrigin reload; if the media server still won't cooperate
// the video is marked unreadable and left alone. There is no way around a
// tainted canvas from a content script.
export class VideoFilter extends Filter implements IVideoFilter {
  private readonly MIN_VIDEO_SIZE: number
  private readonly SAMPLE_MAX_DIMENSION: number
  private settings: videoFilterSettingsType

  constructor () {
    super()
    this.MIN_VIDEO_SIZE = 41
    this.SAMPLE_MAX_DIMENSION = 320 // downscale frames before classifying
    this.settings = { filterEffect: 'hide', videoSampleInterval: 3 }
  }

  public setSettings (settings: videoFilterSettingsType): void {
    this.settings = settings
  }

  // Video scanning is opt-out via a 0 interval. The DOMWatcher checks this so it
  // can skip enumerating <video> elements entirely when disabled.
  public isEnabled (): boolean {
    return this.settings.videoSampleInterval > 0
  }

  private get sampleIntervalMs (): number {
    return this.settings.videoSampleInterval * 1000
  }

  public analyzeVideo (video: HTMLVideoElement): void {
    if (!this.isEnabled()) return
    if (video.dataset.nsfwFilterStatus !== undefined) return
    video.dataset.nsfwFilterStatus = 'processing'

    // Cheap win: the poster attribute is a normal image URL.
    if (video.poster.length > 0) {
      this.requestToAnalyzeImage(new PredictionRequest(video.poster))
        .then(({ result }) => { if (result) this.blockVideo(video) })
        .catch(() => {})
    }

    // Frames only exist once there is decoded picture data.
    if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) this.scheduleSample(video)
    else video.addEventListener('loadeddata', () => this.scheduleSample(video), { once: true })
  }

  private scheduleSample (video: HTMLVideoElement): void {
    const status = video.dataset.nsfwFilterStatus
    if (status === 'nsfw' || status === 'unreadable') return
    if (!document.contains(video)) return

    // Sample the first frame immediately; after that only while playing, since
    // a paused frame does not change.
    const firstSample = video.dataset.nsfwFilterSampled === undefined
    if (firstSample || !video.paused) {
      video.dataset.nsfwFilterSampled = 'true'
      this.sampleFrame(video)
    }

    window.setTimeout(() => this.scheduleSample(video), this.sampleIntervalMs)
  }

  private sampleFrame (video: HTMLVideoElement): void {
    const w = video.videoWidth
    const h = video.videoHeight
    if (w <= this.MIN_VIDEO_SIZE || h <= this.MIN_VIDEO_SIZE) return

    const scale = Math.min(1, this.SAMPLE_MAX_DIMENSION / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)

    const context = canvas.getContext('2d')
    if (context === null) return

    let dataUrl: string
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    } catch {
      // Tainted canvas. Try once to re-load with CORS so future frames become
      // readable; this only helps if the server sends CORS headers and the
      // stream is a plain file (not MSE/EME).
      if (video.crossOrigin === null && video.src.length > 0) {
        video.crossOrigin = 'anonymous'
        video.load()
      } else {
        console.warn(`[NSFW-Filter] Cannot read video frames (tainted canvas): ${video.currentSrc.length > 0 ? video.currentSrc : video.src}`)
        video.dataset.nsfwFilterStatus = 'unreadable'
      }
      return
    }

    this.requestToAnalyzeImage(new PredictionRequest(dataUrl))
      .then(({ result }) => { if (result) this.blockVideo(video) })
      .catch(() => {})
  }

  private blockVideo (video: HTMLVideoElement): void {
    video.dataset.nsfwFilterStatus = 'nsfw'
    this.blockedItems++

    try { video.pause() } catch { /* autoplay policies / detached node */ }

    if (this.settings.filterEffect === 'blur') {
      video.style.filter = 'blur(25px)'
    } else if (this.settings.filterEffect === 'grayscale') {
      video.style.filter = 'grayscale(1)'
    } else {
      video.style.visibility = 'hidden'
    }
  }
}
