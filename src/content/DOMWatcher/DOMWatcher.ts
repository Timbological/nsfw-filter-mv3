// Highly sensitive code, make sure that you know what you're doing
// https://stackoverflow.com/a/39332340/10432429

// @TODO Canvas and SVG

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
    this.findAndCheckAllVisualElements(document.documentElement)
    this.observer.observe(document, DOMWatcher.getConfig())
  }

  private callback (mutationsList: MutationRecord[]): void {
    for (let i = 0; i < mutationsList.length; i++) {
      const mutation = mutationsList[i]
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        this.findAndCheckAllVisualElements(mutation.target as Element)
      } else if (mutation.type === 'attributes') {
        this.checkAttributeMutation(mutation)
      }
    }
  }

  private findAndCheckAllVisualElements (element: Element): void {
    const images = element.getElementsByTagName('img')
    for (let i = 0; i < images.length; i++) {
      this.imageFilter.analyzeImage(images[i], false)
    }

    // Non-<img> visual elements: CSS background-image and lazy-load data-src.
    const elements = element.querySelectorAll<HTMLElement>('[data-src], [srcset], [style*="background-image"]')
    for (let i = 0; i < elements.length; i++) {
      const current = elements[i]
      if (current.nodeName === 'IMG') continue
      this.imageFilter.analyzeElement(current, false)
    }

    if (this.videoFilter === undefined || !this.videoFilter.isEnabled()) return
    const videos = element.getElementsByTagName('video')
    for (let i = 0; i < videos.length; i++) {
      this.videoFilter.analyzeVideo(videos[i])
    }
  }

  private checkAttributeMutation (mutation: MutationRecord): void {
    const target = mutation.target as HTMLElement
    const attrName = mutation.attributeName

    if (target.nodeName === 'IMG') {
      // srcset counts as a source change too: lazy-loaders swap srcset, and it
      // drives currentSrc for responsive images.
      const isSrcAttribute = attrName === 'src' || attrName === 'srcset' || attrName === 'data-src'

      if (attrName === 'style') {
        this.imageFilter.checkStyleMutation(target)
        return
      }

      if (isSrcAttribute) this.imageFilter.analyzeImage(target as HTMLImageElement, true)
      return
    }

    if (target.nodeName === 'VIDEO' && this.videoFilter !== undefined && this.videoFilter.isEnabled()) {
      // A src/poster swap means new content to inspect.
      if (attrName !== 'style') this.videoFilter.analyzeVideo(target as HTMLVideoElement)
      return
    }

    // Background-image / lazy-load elements.
    const isBackgroundAttribute = attrName === 'style' || attrName === 'class' || attrName === 'data-src'
    if (!isBackgroundAttribute) return

    if (attrName === 'style' || attrName === 'class') {
      this.imageFilter.checkStyleMutation(target)
    }

    this.imageFilter.analyzeElement(target, attrName === 'data-src')
  }

  private static getConfig (): MutationObserverInit {
    return {
      characterData: false,
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster', 'style', 'data-src', 'class']
    }
  }
}
