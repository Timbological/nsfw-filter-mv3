// Settings lock: a parent-set password that gates *weakening* changes to the
// filter (lowering strictness, whitelisting a site, weakening video scanning).
// Strengthening changes are always allowed.
//
// Security posture: this is a deterrent for a managed child account where
// chrome://extensions and devtools are locked down. The hash lives in
// chrome.storage (NOT a web-accessible file), salted and stretched with
// PBKDF2 — but a user with full device/devtools access could still edit the
// stored settings directly. It is not cryptographic protection against that.

const ITERATIONS = 150_000
const KEY_BITS = 256

export type LockCredential = {
  salt: string // hex
  hash: string // hex
  iterations: number
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map(byte => parseInt(byte, 16)))

const deriveHash = async (password: string, salt: Uint8Array, iterations: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BITS
  )
  return toHex(bits)
}

// Constant-time-ish comparison of two equal-length hex strings, so a wrong
// guess can't be distinguished by timing.
const hexEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const createLock = async (password: string): Promise<LockCredential> => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await deriveHash(password, salt, ITERATIONS)
  return { salt: toHex(salt.buffer), hash, iterations: ITERATIONS }
}

export const verifyLock = async (password: string, cred: LockCredential): Promise<boolean> => {
  const hash = await deriveHash(password, fromHex(cred.salt), cred.iterations)
  return hexEqual(hash, cred.hash)
}

// The subset of settings whose changes we guard.
export type GuardedSettings = {
  filterStrictness: number
  websites: string[]
  videoSampleInterval: number
}

// Video strictness: more frequent sampling is stricter; a longer interval is
// weaker; 0 ("off") is the weakest of all. Rank so that higher = stricter.
const videoRank = (interval: number): number => (interval <= 0 ? 0 : 1000 - interval)

const cleanHosts = (hosts: string[]): string[] =>
  hosts.map(h => h.trim()).filter(h => h.length > 0)

// True if `next` is weaker than `prev` in any guarded dimension:
// lower strictness, a newly whitelisted (filter-exempt) host, or weaker video
// scanning. Removing a whitelist entry or raising strictness is NOT weakening.
export const weakens = (prev: GuardedSettings, next: GuardedSettings): boolean => {
  if (next.filterStrictness < prev.filterStrictness) return true

  const prevHosts = new Set(cleanHosts(prev.websites))
  const addedHost = cleanHosts(next.websites).some(host => !prevHosts.has(host))
  if (addedHost) return true

  if (videoRank(next.videoSampleInterval) < videoRank(prev.videoSampleInterval)) return true

  return false
}
