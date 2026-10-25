/**
 * SHA-256 in plain JavaScript. The login form hashes the password in the browser,
 * but `crypto.subtle` only exists in secure contexts (HTTPS or localhost), so a site
 * opened over plain HTTP from another address could not log in. This gives the same
 * digest everywhere. The constants are derived from primes, and the tests compare the
 * output with Node's crypto.
 */

const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0

// The first 64 primes. K = fractional parts of their cube roots, H0 = of the square roots of the first 8.
const PRIMES: number[] = []
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n)
const K = PRIMES.map((p) => frac32(Math.cbrt(p)))
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)))

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** SHA-256 of raw bytes. Returns 32 bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8
  // Message, 0x80, zero padding, then the 64-bit length: a multiple of 64 bytes.
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6))
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  const h = H0.slice()
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((v, i) => outView.setUint32(i * 4, v))
  return out
}

/** Lowercase hex digest of a UTF-8 string. The same value the server expects for a password. */
export function sha256Hex(text: string): string {
  const digest = sha256(new TextEncoder().encode(text))
  let out = ''
  for (const b of digest) out += b.toString(16).padStart(2, '0')
  return out
}
