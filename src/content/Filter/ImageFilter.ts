import { PredictionRequest } from '../../utils/messages'

import { Filter } from './Filter'

const STATUS_PROCESSING = 'processing'
const STATUS_NSFW = 'nsfw'
const STATUS_SFW = 'sfw'

type imageFilterSettingsType = {
  filterEffect: 'blur' | 'hide' | 'grayscale'
}

export type IImageFilter = {
  analyzeImage: (image: HTMLImageElement, srcAttribute: boolean) => void
  analyzeElement: (element: HTMLElement, srcAttribute: boolean) => void
  setSettings: (settings: imageFilterSettingsType) => void
  checkStyleMutation: (element: HTMLElement) => void
}

export class ImageFilter extends Filter implements IImageFilter {
  private readonly MIN_IMAGE_SIZE: number
  private settings: imageFilterSettingsType

  constructor () {
    super()
    this.MIN_IMAGE_SIZE = 41

    this.settings = { filterEffect: 'hide' }
  }

  public setSettings (settings: imageFilterSettingsType): void {
    this.settings = settings
  }

  public analyzeImage (image: HTMLImageElement, srcAttribute: boolean = false): void {
    const imageIsNotAnalyzed = srcAttribute || image.dataset.nsfwFilterStatus === undefined
    const url = this.getImageUrl(image)

    // For <picture>/srcset the displayed URL lives in currentSrc, which isn't
    // populated until the browser has picked a <source> and started loading it
    // (often after document_start / node insertion). Defer to the load event
    // instead of silently dropping the image.
    if (url.length === 0) {
      const hasResponsiveSource = image.srcset.length > 0 || image.closest('picture') !== null
      if (imageIsNotAnalyzed && hasResponsiveSource && image.dataset.nsfwFilterAwaitingLoad === undefined) {
        image.dataset.nsfwFilterAwaitingLoad = 'true'
        image.addEventListener('load', () => { this.analyzeImage(image, true) }, { once: true })
      }
      return
    }

    const isImageValid = (image.width > this.MIN_IMAGE_SIZE && image.height > this.MIN_IMAGE_SIZE) || image.height === 0 || image.width === 0

    if (imageIsNotAnalyzed && isImageValid) {
      image.dataset.nsfwFilterStatus = STATUS_PROCESSING
      this._analyzeElement(image, url)
    }
  }

  // Non-<img> visual elements: CSS background-image and lazy-load data-src on
  // <div>/<a>/etc.
  public analyzeElement (element: HTMLElement, srcAttribute: boolean = false): void {
    const url = this.getBackgroundImageUrl(element)
    if (url.length === 0) return

    const elementIsNotAnalyzed = srcAttribute || element.dataset.nsfwFilterStatus === undefined
    if (!elementIsNotAnalyzed) return

    element.dataset.nsfwFilterStatus = STATUS_PROCESSING
    this._analyzeElement(element, url)
  }

  public checkStyleMutation (element: HTMLElement): void {
    if (!this.isStyleOutdated(element)) return

    const url = this.getBackgroundImageUrl(element)
    if (url.length === 0) return

    this.applyFilter(element, url)
  }

  private isStyleOutdated (element: HTMLElement): boolean {
    if (element.dataset.nsfwFilterStatus !== STATUS_NSFW) return false

    const style = element.getAttribute('style') ?? ''
    const isVisibilityHiddenOutdated = this.settings.filterEffect === 'hide' && !style.includes('visibility: hidden')
    const isBlurOutdated = this.settings.filterEffect === 'blur' && !style.includes('filter: blur')
    const isGrayscaleOutdated = this.settings.filterEffect === 'grayscale' && !style.includes('filter: grayscale')

    return isVisibilityHiddenOutdated || isBlurOutdated || isGrayscaleOutdated
  }

  private _analyzeElement (element: HTMLElement, url: string): void {
    this.applyInitialBlur(element)

    const request = new PredictionRequest(url)
    this.requestToAnalyzeImage(request)
      .then(({ result }) => {
        if (result) {
          element.dataset.nsfwFilterStatus = STATUS_NSFW
          this.applyFilter(element, url)
          this.blockedItems++
        } else {
          this.showElement(element, url)
        }
      }).catch(() => {
        this.showElement(element, url)
      })
  }

  // <img> displayed URL: currentSrc wins for <picture>/srcset; fall back to the
  // src attribute, then lazy-load data-src.
  private getImageUrl (image: HTMLImageElement): string {
    // currentSrc/src are already absolute; data-src may be relative.
    if (image.currentSrc.length > 0) return image.currentSrc
    if (image.src.length > 0) return image.src
    const dataSrc = image.getAttribute('data-src') ?? image.dataset.src ?? ''
    return dataSrc.length > 0 ? this.toAbsoluteUrl(dataSrc) : ''
  }

  private getBackgroundImageUrl (element: HTMLElement): string {
    if (element instanceof HTMLImageElement) return this.getImageUrl(element)

    const dataSrc = element.getAttribute('data-src') ?? element.dataset.src
    if (dataSrc !== null && dataSrc !== undefined && dataSrc.length > 0) return this.toAbsoluteUrl(dataSrc)

    // Computed style resolves url() to an absolute URL; the inline value is a
    // fallback and may be relative, so absolutize whatever we extract.
    const computed = window.getComputedStyle(element).backgroundImage
    const raw = this.extractBackgroundImageUrl(computed.length > 0 && computed !== 'none' ? computed : element.style.backgroundImage)
    return raw.length > 0 ? this.toAbsoluteUrl(raw) : ''
  }

  private extractBackgroundImageUrl (backgroundImage: string): string {
    const match = backgroundImage.match(/url\((?:'|")?(.*?)(?:'|")?\)/)
    return match !== null ? match[1] : ''
  }

  // The offscreen classifier re-fetches by URL from the extension origin, so a
  // relative URL would 404. Resolve against the page before sending.
  private toAbsoluteUrl (url: string): string {
    if (url.startsWith('data:')) return url
    try {
      return new URL(url, window.location.href).href
    } catch {
      return url
    }
  }

  // Blur immediately, before the verdict, so NSFW content never flashes visible
  // during classification and there's no click-to-reveal teaser.
  private applyInitialBlur (element: HTMLElement): void {
    element.style.setProperty('filter', 'blur(25px)', 'important')
    element.style.visibility = 'visible'

    if (element instanceof HTMLImageElement && element.parentNode?.nodeName === 'BODY') element.hidden = false
  }

  private applyFilter (element: HTMLElement, _url: string): void {
    // Called only on a positive (NSFW) verdict; status is already 'nsfw'.
    if (this.settings.filterEffect === 'blur') {
      element.style.setProperty('filter', 'blur(25px)', 'important')
      this.revealBlocked(element)
      return
    }

    if (this.settings.filterEffect === 'grayscale') {
      element.style.setProperty('filter', 'grayscale(1)', 'important')
      this.revealBlocked(element)
      return
    }

    this.hideElement(element)
  }

  // Make a blocked element visible so the blur/grayscale is seen, while keeping
  // its 'nsfw' status and filter (so the style-mutation watcher can re-apply if
  // the page later strips the effect).
  private revealBlocked (element: HTMLElement): void {
    if (element instanceof HTMLImageElement && element.parentNode?.nodeName === 'BODY') element.hidden = false
    element.style.visibility = 'visible'
  }

  private hideElement (element: HTMLElement): void {
    if (element instanceof HTMLImageElement && element.parentNode?.nodeName === 'BODY') element.hidden = true

    element.style.visibility = 'hidden'
  }

  private showElement (element: HTMLElement, url: string): void {
    if (this.getBackgroundImageUrl(element) !== url) return

    if (element instanceof HTMLImageElement && element.parentNode?.nodeName === 'BODY') element.hidden = false
    // Clear the initial blur only for genuinely safe content.
    if (element.dataset.nsfwFilterStatus !== STATUS_NSFW) {
      element.style.setProperty('filter', 'none', 'important')
    }

    element.dataset.nsfwFilterStatus = STATUS_SFW
    element.style.visibility = 'visible'
  }
}
