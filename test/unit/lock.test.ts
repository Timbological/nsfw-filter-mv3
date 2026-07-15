import { createLock, verifyLock, weakens, GuardedSettings } from '../../src/popup/utils/lock'

const base: GuardedSettings = { filterStrictness: 85, websites: ['a.com'], videoSampleInterval: 3 }
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

  test('weaker video scanning weakens; stronger does not', () => {
    expect(weakens(base, change({ videoSampleInterval: 0 }))).toBe(true) // off = weakest
    expect(weakens(base, change({ videoSampleInterval: 10 }))).toBe(true) // less frequent
    expect(weakens(base, change({ videoSampleInterval: 2 }))).toBe(false) // more frequent
    expect(weakens(change({ videoSampleInterval: 0 }), change({ videoSampleInterval: 3 }))).toBe(false) // off -> on
  })
})
