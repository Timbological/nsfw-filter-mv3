// Highly sensitive code, make sure that you know what you're doing
// https://stackoverflow.com/a/39332340/10432429

// @TODO Canvas and SVG
// @TODO Lazy loading for div.style.background-image?
// @TODO <div> and <a>

import { IImageFilter } from '../Filter/ImageFilter'
import { IVideoFilter } from '../Filter/VideoFilter'

export type IDOMWatcher = {
  watch: () => void
}

export class DOMWatcher implements IDOMWatcher {
  private readonly observer: MutationObserver
  private readonly imageFilter: IImageFilter
  private readonly videoFilter: IVideoFilter | undefined

  constructor (imageFilter: IImageFilter, videoFilter?: IVideoFilter) {
    this.imageFilter = imageFilter
    this.videoFilter = videoFilter
    this.observer = new MutationObserver(this.callback.bind(this))
  }

  public watch (): void {
    // Scan media already present in the DOM (e.g. direct image URLs, fast-loading pages)
    this.findAndCheckAllMedia(document.documentElement)
    this.observer.observe(document, DOMWatcher.getConfig())
  }

  private callback (mutationsList: MutationRecord[]): void {
    for (let i = 0; i < mutationsList.length; i++) {
      const mutation = mutationsList[i]
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        this.findAndCheckAllMedia(mutation.target as Element)
      } else if (mutation.type === 'attributes') {
        this.checkAttributeMutation(mutation)
      }
    }
  }

  private findAndCheckAllMedia (element: Element): void {
    const images = element.getElementsByTagName('img')
    for (let i = 0; i < images.length; i++) {
      this.imageFilter.analyzeImage(images[i], false)
    }

    if (this.videoFilter === undefined || !this.videoFilter.isEnabled()) return
    const videos = element.getElementsByTagName('video')
    for (let i = 0; i < videos.length; i++) {
      this.videoFilter.analyzeVideo(videos[i])
    }
  }

  private checkAttributeMutation (mutation: MutationRecord): void {
    const node = mutation.target as HTMLElement

    if (node.nodeName === 'IMG') {
      // srcset counts as a source change too: lazy-loaders swap srcset, and it
      // drives currentSrc for responsive images.
      const isSrcAttribute = mutation.attributeName === 'src' || mutation.attributeName === 'srcset'
      const isStyleAttribute = mutation.attributeName === 'style'

      if (isStyleAttribute) {
        this.imageFilter.checkStyleMutation(node as HTMLImageElement)
        return
      }

      this.imageFilter.analyzeImage(node as HTMLImageElement, isSrcAttribute)
      return
    }

    if (node.nodeName === 'VIDEO' && this.videoFilter !== undefined && this.videoFilter.isEnabled()) {
      // A src/poster swap means new content to inspect.
      if (mutation.attributeName !== 'style') this.videoFilter.analyzeVideo(node as HTMLVideoElement)
    }
  }

  private static getConfig (): MutationObserverInit {
    return {
      characterData: false,
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster', 'style']
    }
  }
}
