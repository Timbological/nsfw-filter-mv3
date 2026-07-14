import { ModelController } from '../../src/offscreen/ModelController'

type Deferred<T> = { promise: Promise<T>, resolve: (v: T) => void, reject: (e: Error) => void }
function defer<T> (): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const tick = async (): Promise<void> => { await new Promise<void>(res => setImmediate(res)) }

describe('offscreen => ModelController', () => {
  test('loads the selected model and only reports it active once loaded', async () => {
    const d = defer<string>()
    const loads: string[] = []
    const ready: Array<[string, string]> = []
    const c = new ModelController<string>({
      loadFn: (id) => { loads.push(id); return d.promise },
      onReady: (m, id) => { ready.push([m, id]) },
      scheduleRetry: (r) => { r() }
    })

    c.select('A')
    expect(loads).toEqual(['A'])
    expect(c.isLoading).toBe(true)
    expect(c.loaded).toBeNull() // not active until the load resolves

    d.resolve('modelA')
    await tick()
    expect(ready).toEqual([['modelA', 'A']])
    expect(c.loaded).toBe('A')
    expect(c.isLoading).toBe(false)
  })

  test('re-selecting the active model does not reload', async () => {
    const loads: string[] = []
    const c = new ModelController<string>({
      loadFn: (id) => { loads.push(id); return Promise.resolve(`m${id}`) },
      onReady: () => {},
      scheduleRetry: (r) => { r() }
    })
    c.select('A'); await tick()
    c.select('A')
    expect(loads).toEqual(['A'])
  })

  test('switching keeps the old model active until the new one is ready (no gap)', async () => {
    const dA = defer<string>(); const dB = defer<string>()
    const ready: string[] = []
    const c = new ModelController<string>({
      loadFn: (id) => (id === 'A' ? dA.promise : dB.promise),
      onReady: (_m, id) => { ready.push(id) },
      scheduleRetry: (r) => { r() }
    })

    c.select('A'); dA.resolve('mA'); await tick()
    expect(c.loaded).toBe('A')

    c.select('B')
    expect(c.isLoading).toBe(true)
    expect(c.loaded).toBe('A') // still serving A while B loads — nothing un-blocked

    dB.resolve('mB'); await tick()
    expect(c.loaded).toBe('B')
    expect(ready).toEqual(['A', 'B'])
  })

  test('converges to the newest choice when it changes mid-load', async () => {
    const dA = defer<string>(); const dB = defer<string>(); const dC = defer<string>()
    const map: Record<string, Promise<string>> = { A: dA.promise, B: dB.promise, C: dC.promise }
    const loads: string[] = []
    const c = new ModelController<string>({
      loadFn: (id) => { loads.push(id); return map[id] },
      onReady: () => {},
      scheduleRetry: (r) => { r() }
    })

    c.select('A'); dA.resolve('mA'); await tick()
    c.select('B') // begins loading B
    c.select('C') // desired now C, but only one load at a time
    expect(loads).toEqual(['A', 'B'])

    dB.resolve('mB'); await tick() // B done → desired is C → load C
    expect(loads).toEqual(['A', 'B', 'C'])
    dC.resolve('mC'); await tick()
    expect(c.loaded).toBe('C')
  })

  test('closes the cold-start race (default kicked off, stored arrives before it resolves)', async () => {
    const dDefault = defer<string>(); const dStored = defer<string>()
    const map: Record<string, Promise<string>> = { MobileNet: dDefault.promise, Inception: dStored.promise }
    const loads: string[] = []
    const c = new ModelController<string>({
      loadFn: (id) => { loads.push(id); return map[id] },
      onReady: () => {},
      scheduleRetry: (r) => { r() }
    })

    c.select('MobileNet') // init() with the default
    c.select('Inception') // OFFSCREEN_INIT with the stored choice, default still loading
    expect(loads).toEqual(['MobileNet'])

    dDefault.resolve('m1'); await tick() // default resolves → switch to stored
    expect(loads).toEqual(['MobileNet', 'Inception'])
    dStored.resolve('m2'); await tick()
    expect(c.loaded).toBe('Inception')
  })

  test('retries a failed load then succeeds', async () => {
    let n = 0
    const c = new ModelController<string>({
      loadFn: () => { n += 1; return n === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok') },
      onReady: () => {},
      scheduleRetry: (r) => { r() },
      maxAttempts: 5
    })
    c.select('A')
    await tick(); await tick()
    expect(n).toBeGreaterThanOrEqual(2)
    expect(c.loaded).toBe('A')
  })

  test('gives up after maxAttempts and keeps the previous model active', async () => {
    const errors: string[] = []
    const c = new ModelController<string>({
      loadFn: (id) => (id === 'B' ? Promise.reject(new Error('boom')) : Promise.resolve('mA')),
      onReady: () => {},
      onError: (_e, id) => { errors.push(id) },
      scheduleRetry: (r) => { r() },
      maxAttempts: 3
    })

    c.select('A'); await tick()
    expect(c.loaded).toBe('A')

    c.select('B')
    await tick(); await tick(); await tick()
    expect(errors).toEqual(['B'])
    expect(c.loaded).toBe('A') // failed switch leaves the working model in place
  })
})
