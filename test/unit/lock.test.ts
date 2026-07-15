import { createLock, verifyLock, weakens, GuardedSettings, extensionsPageBlocked, isExtensionsUrl } from '../../src/popup/utils/lock'

const base: GuardedSettings = { filterStrictness: 85, filterEffect: 'blur', websites: ['a.com'], videoSampleInterval: 3, lockAllSettings: false, blockExtensionsPage: false }
const change = (over: Partial<GuardedSettings>): GuardedSettings => ({ ...base, ...over })

describe('popup => lock => password', () => {
  test('a correct password verifies, a wrong one does not', async () => {
    const cred = await createLock('hunter2')
    expect(await verifyLock('hunter2', cred)).toBe(true)
    expect(await verifyLock('Hunter2', cred)).toBe(false)
    expect(await verifyLock('', cred)).toBe(false)
  })

  test('the same password yields a different salt+hash each time (salted)', async () => {
    const a = await createLock('hunter2')
    const b = await createLock('hunter2')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    // ...yet both still verify
    expect(await verifyLock('hunter2', a)).toBe(true)
    expect(await verifyLock('hunter2', b)).toBe(true)
  })
})

describe('popup => lock => weakens', () => {
  test('an unchanged setting is not a weakening', () => {
    expect(weakens(base, change({}))).toBe(false)
  })

  test('lowering strictness weakens; raising it does not', () => {
    expect(weakens(base, change({ filterStrictness: 50 }))).toBe(true)
    expect(weakens(base, change({ filterStrictness: 100 }))).toBe(false)
  })

  test('adding a whitelisted host weakens; removing one does not', () => {
    expect(weakens(base, change({ websites: ['a.com', 'b.com'] }))).toBe(true)
    expect(weakens(base, change({ websites: [] }))).toBe(false)
    // swapping a host (remove a.com, add b.com) still counts as adding b.com
    expect(weakens(base, change({ websites: ['b.com'] }))).toBe(true)
  })

  test('whitespace-only whitelist noise is ignored', () => {
    expect(weakens(base, change({ websites: ['a.com', '  '] }))).toBe(false)
  })

  test('a weaker filter effect weakens; a stronger one does not (hide > blur > grayscale)', () => {
    expect(weakens(base, change({ filterEffect: 'grayscale' }))).toBe(true) // blur -> grayscale
    expect(weakens(base, change({ filterEffect: 'hide' }))).toBe(false) // blur -> hide
    expect(weakens(change({ filterEffect: 'hide' }), change({ filterEffect: 'grayscale' }))).toBe(true)
    expect(weakens(change({ filterEffect: 'hide' }), change({ filterEffect: 'blur' }))).toBe(true)
    expect(weakens(change({ filterEffect: 'grayscale' }), change({ filterEffect: 'blur' }))).toBe(false)
  })

  test('weaker video scanning weakens; stronger does not', () => {
    expect(weakens(base, change({ videoSampleInterval: 0 }))).toBe(true) // off = weakest
    expect(weakens(base, change({ videoSampleInterval: 10 }))).toBe(true) // less frequent
    expect(weakens(base, change({ videoSampleInterval: 2 }))).toBe(false) // more frequent
    expect(weakens(change({ videoSampleInterval: 0 }), change({ videoSampleInterval: 3 }))).toBe(false) // off -> on
  })

  test('turning off a protection toggle weakens; turning it on does not', () => {
    const guarded = change({ lockAllSettings: true, blockExtensionsPage: true })
    expect(weakens(guarded, change({ lockAllSettings: false, blockExtensionsPage: true }))).toBe(true)
    expect(weakens(guarded, change({ lockAllSettings: true, blockExtensionsPage: false }))).toBe(true)
    expect(weakens(base, change({ lockAllSettings: true }))).toBe(false)
    expect(weakens(base, change({ blockExtensionsPage: true }))).toBe(false)
  })
})

describe('popup => lock => extensionsPageBlocked', () => {
  test('recognises the extensions URL', () => {
    expect(isExtensionsUrl('chrome://extensions/')).toBe(true)
    expect(isExtensionsUrl('chrome://extensions/?id=abc')).toBe(true)
    expect(isExtensionsUrl('chrome://settings/')).toBe(false)
    expect(isExtensionsUrl('https://example.com')).toBe(false)
    expect(isExtensionsUrl(undefined)).toBe(false)
  })

  test('blocks only when enabled, a lock exists, and outside the grace window', () => {
    const on = { url: 'chrome://extensions/', blockExtensionsPage: true, hasLock: true }
    expect(extensionsPageBlocked({ ...on, allowedUntil: 0, now: 1000 })).toBe(true)
    // within grace window -> allowed
    expect(extensionsPageBlocked({ ...on, allowedUntil: 5000, now: 1000 })).toBe(false)
    // feature off -> allowed
    expect(extensionsPageBlocked({ ...on, blockExtensionsPage: false, now: 1000 })).toBe(false)
    // no password set -> never block (else you'd lock yourself out)
    expect(extensionsPageBlocked({ ...on, hasLock: false, now: 1000 })).toBe(false)
    // not the extensions page -> allowed
    expect(extensionsPageBlocked({ ...on, url: 'https://example.com', now: 1000 })).toBe(false)
  })
})
