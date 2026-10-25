import { createHash, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { type DB, getSetting, setSetting } from '../db.ts'

const BCRYPT_ROUNDS = 12
const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * The browser never sends the plain password: it sends sha256(password) as hex,
 * and the server stores bcrypt(sha256hex). This helper mirrors the client side.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function randomPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)]
  return out
}

/**
 * Until the admin changes the password, every start generates a new random one.
 * Returns the generated password (to print) or null when a custom password is set.
 */
export function ensurePassword(db: DB): string | null {
  if (getSetting(db, 'password_changed') === '1' && getSetting(db, 'password_hash')) return null
  const password = randomPassword()
  setSetting(db, 'password_hash', bcrypt.hashSync(sha256Hex(password), BCRYPT_ROUNDS))
  setSetting(db, 'password_changed', '0')
  return password
}

export async function verifyPassword(db: DB, passwordSha256: unknown): Promise<boolean> {
  const stored = getSetting(db, 'password_hash')
  if (!stored || typeof passwordSha256 !== 'string' || !SHA256_HEX.test(passwordSha256)) return false
  return bcrypt.compare(passwordSha256, stored)
}

export async function changePassword(db: DB, newSha256: string) {
  if (!SHA256_HEX.test(newSha256)) throw new Error('invalid password hash')
  setSetting(db, 'password_hash', await bcrypt.hash(newSha256, BCRYPT_ROUNDS))
  setSetting(db, 'password_changed', '1')
}

/** Go back to "random password on every start" (CLI: reset-password). */
export function resetPassword(db: DB) {
  setSetting(db, 'password_changed', '0')
}

export function passwordChanged(db: DB): boolean {
  return getSetting(db, 'password_changed') === '1'
}
