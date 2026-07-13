import { PredictionRequest } from '../../utils/messages'

import { Filter } from './Filter'

type imageFilterSettingsType = {
  filterEffect: 'blur' | 'hide' | 'grayscale'
}

export type IImageFilter = {
  analyzeImage: (image: HTMLImageElement, srcAttribute: boolean) => void
  setSettings: (settings: imageFilterSettingsType) => void
  checkStyleMutation: (image: HTMLImageElement) => void
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

  // For <picture>/srcset responsive images the URL actually being displayed
  // lives in currentSrc; the <img>'s own src attribute is frequently empty.
  // Reading src alone makes the filter blind to responsive images (e.g. most
  // editorial imagery on news sites such as abc.net.au).
  private getImageUrl (image: HTMLImageElement): string {
    return image.currentSrc.length > 0 ? image.currentSrc : image.src
  }

  public analyzeImage (image: HTMLImageElement, srcAttribute: boolean = false): void {
    const imageIsNotAnalyzed = srcAttribute || image.dataset.nsfwFilterStatus === undefined
    const url = this.getImageUrl(image)

    // currentSrc is only populated once the browser has picked a <source> and
    // begun loading it. If we run before that (common at document_start or right
    // after node insertion), defer analysis to the load event rather than
    // silently dropping a responsive image.
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
      image.dataset.nsfwFilterStatus = 'processing'
      this._analyzeImage(image, url)
    }
  }

  public checkStyleMutation (image: HTMLImageElement): void {
    const isStyleOutdated = this.isStyleOutdated(image)

    if (!isStyleOutdated) return

    this.applyFilter(image, this.getImageUrl(image))
  }

  private isStyleOutdated (image: HTMLImageElement): boolean {
    const isImageNSFW = image.dataset.nsfwFilterStatus === 'nsfw'

    if (!isImageNSFW) return false

    const isVisibilityHiddenOutdated = this.settings.filterEffect === 'hide' && image.getAttribute('style')?.includes('visibility: hidden') === false
    const isBlurOutdated = this.settings.filterEffect === 'blur' && image.getAttribute('style')?.includes('filter: blur') === false
    const isGrayscaleOutdated = this.settings.filterEffect === 'grayscale' && image.getAttribute('style')?.includes('filter: grayscale') === false

    return isVisibilityHiddenOutdated || isBlurOutdated || isGrayscaleOutdated
  }

  private _analyzeImage (image: HTMLImageElement, url: string): void {
    this.hideImage(image)

    const request = new PredictionRequest(url)
    this.requestToAnalyzeImage(request)
      .then(({ result, url }) => {
        if (result) {
          this.applyFilter(image, url)

          this.blockedItems++
          image.dataset.nsfwFilterStatus = 'nsfw'
        } else {
          this.showImage(image, url)
        }
      }).catch(({ url }) => {
        this.showImage(image, url)
      })
  }

  private applyFilter (image: HTMLImageElement, url: string): void {
    if (this.settings.filterEffect === 'blur') {
      image.style.filter = 'blur(25px)'
      this.showImage(image, url)
      return
    }

    if (this.settings.filterEffect === 'grayscale') {
      image.style.filter = 'grayscale(1)'
      this.showImage(image, url)
      return
    }

    this.hideImage(image)
  }

  private hideImage (image: HTMLImageElement): void {
    if (image.parentNode?.nodeName === 'BODY') image.hidden = true

    image.style.visibility = 'hidden'
  }

  private showImage (image: HTMLImageElement, url: string): void {
    if (this.getImageUrl(image) === url) {
      if (image.parentNode?.nodeName === 'BODY') image.hidden = false

      image.dataset.nsfwFilterStatus = 'sfw'
      image.style.visibility = 'visible'
    }
  }
}
