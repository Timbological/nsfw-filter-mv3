/**
 * @jest-environment jsdom
 */
import { ImageFilter } from '../../src/content/Filter/ImageFilter'

// The pending-hide stylesheet hides every <img> until ImageFilter tags it with
// data-nsfw-filter-status. So the contract these tests protect is: analyzeImage
// must ALWAYS reach a tagged state (or an explicit awaiting-load deferral) —
// otherwise the stylesheet would strand the image invisible forever.

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

// Bypass the background round-trip; return a verdict we control.
const stubVerdict = (result: boolean): jest.SpyInstance =>
  jest.spyOn(ImageFilter.prototype as any, 'requestToAnalyzeImage')
    .mockResolvedValue({ result, url: '', message: '' })

const stubPending = (): jest.SpyInstance =>
  jest.spyOn(ImageFilter.prototype as any, 'requestToAnalyzeImage')
    .mockReturnValue(new Promise(() => undefined))

const makeImage = (width: number, height: number, src = 'http://example.com/a.jpg'): HTMLImageElement => {
  const image = document.createElement('img')
  if (src.length > 0) image.src = src
  image.width = width
  image.height = height
  document.body.appendChild(image)
  return image
}

afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = '' })

describe('content => ImageFilter => analyzeImage tagging', () => {
  test('a full-size image is marked processing and sent for a verdict', () => {
    stubPending()
    const image = makeImage(200, 200)

    new ImageFilter().analyzeImage(image)

    expect(image.dataset.nsfwFilterStatus).toBe('processing')
  })

  test('a too-small image is tagged sfw and revealed (never stranded by the stylesheet)', () => {
    const spy = stubPending()
    const image = makeImage(10, 10)

    new ImageFilter().analyzeImage(image)

    expect(image.dataset.nsfwFilterStatus).toBe('sfw')
    expect(image.style.visibility).toBe('visible')
    expect(spy).not.toHaveBeenCalled()
  })

  test('an empty, non-responsive image is tagged sfw rather than left hidden', () => {
    stubPending()
    const image = makeImage(200, 200, '')

    new ImageFilter().analyzeImage(image)

    expect(image.dataset.nsfwFilterStatus).toBe('sfw')
    expect(image.style.visibility).toBe('visible')
  })

  test('a responsive image with no currentSrc yet defers to load, staying untagged (hidden) meanwhile', () => {
    stubPending()
    const image = makeImage(200, 200, '')
    image.setAttribute('srcset', 'http://example.com/a-2x.jpg 2x')

    new ImageFilter().analyzeImage(image)

    expect(image.dataset.nsfwFilterStatus).toBeUndefined()
    expect(image.dataset.nsfwFilterAwaitingLoad).toBe('true')
  })

  test('an already-analyzed image is not reprocessed without a src change', () => {
    const spy = stubPending()
    const image = makeImage(200, 200)
    image.dataset.nsfwFilterStatus = 'sfw'

    new ImageFilter().analyzeImage(image, false)

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('content => ImageFilter => hide-first verdict flow', () => {
  test('an image is fully hidden (not blurred) while the verdict is in flight', () => {
    stubPending()
    const filter = new ImageFilter()
    filter.setSettings({ filterEffect: 'blur' })
    const image = makeImage(200, 200)

    filter.analyzeImage(image)

    expect(image.style.visibility).toBe('hidden')
    expect(image.style.filter).toBe('')
  })

  test('a safe verdict reveals the image with no effect', async () => {
    stubVerdict(false)
    const filter = new ImageFilter()
    filter.setSettings({ filterEffect: 'blur' })
    const image = makeImage(200, 200)

    filter.analyzeImage(image)
    await flush()

    expect(image.dataset.nsfwFilterStatus).toBe('sfw')
    expect(image.style.visibility).toBe('visible')
    expect(image.style.filter).toBe('')
  })

  test('an NSFW verdict applies the chosen blur effect and reveals it', async () => {
    stubVerdict(true)
    const filter = new ImageFilter()
    filter.setSettings({ filterEffect: 'blur' })
    const image = makeImage(200, 200)

    filter.analyzeImage(image)
    await flush()

    expect(image.dataset.nsfwFilterStatus).toBe('nsfw')
    expect(image.style.filter).toContain('blur(25px)')
    expect(image.style.visibility).toBe('visible')
  })

  test('an NSFW verdict under the hide effect keeps the image hidden', async () => {
    stubVerdict(true)
    const filter = new ImageFilter()
    filter.setSettings({ filterEffect: 'hide' })
    const image = makeImage(200, 200)

    filter.analyzeImage(image)
    await flush()

    expect(image.dataset.nsfwFilterStatus).toBe('nsfw')
    expect(image.style.visibility).toBe('hidden')
  })
})

describe('content => ImageFilter => checkStyleMutation', () => {
  test('re-hides a still-processing element whose inline hide was wiped by a re-render', () => {
    const filter = new ImageFilter()
    const el = document.createElement('div')
    el.dataset.nsfwFilterStatus = 'processing'
    el.style.visibility = 'visible' // simulate the site clobbering our style

    filter.checkStyleMutation(el)

    expect(el.style.visibility).toBe('hidden')
  })

  test('re-applies the effect to a blocked element the page stripped it from', () => {
    const filter = new ImageFilter()
    filter.setSettings({ filterEffect: 'blur' })
    const el = document.createElement('div')
    el.dataset.nsfwFilterStatus = 'nsfw'
    el.style.backgroundImage = 'url(http://example.com/a.jpg)' // effect stripped

    filter.checkStyleMutation(el)

    expect(el.style.filter).toContain('blur(25px)')
  })

  test('leaves a safe element untouched', () => {
    const filter = new ImageFilter()
    const el = document.createElement('div')
    el.dataset.nsfwFilterStatus = 'sfw'
    el.style.visibility = 'visible'

    filter.checkStyleMutation(el)

    expect(el.style.visibility).toBe('visible')
    expect(el.style.filter).toBe('')
  })
})
