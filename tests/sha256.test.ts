import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/shared/sha256.ts'

const reference = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('sha256Hex (browser fallback)', () => {
  it('matches node crypto for edge lengths around the 64-byte block boundary', () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = 'a'.repeat(n)
      expect(sha256Hex(s), `length ${n}`).toBe(reference(s))
    }
  })

  it('matches for multibyte UTF-8 passwords', () => {
    for (const s of ['中文密码', '密码🔐', 'Pässwörd', ' spaces and\ttabs\n']) {
      expect(sha256Hex(s)).toBe(reference(s))
    }
  })

  it('matches for many random passwords', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rnd() * 80)
      let s = ''
      for (let j = 0; j < len; j++) s += String.fromCharCode(32 + Math.floor(rnd() * 95))
      expect(sha256Hex(s)).toBe(reference(s))
    }
  })
})
