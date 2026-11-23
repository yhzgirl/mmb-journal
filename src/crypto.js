// Encryption for MMB Journal. Shared by the app and the stand-alone decrypt page,
// and written only with the browser's built-in Web Crypto (no outside code).
//
// One random 256-bit journal key encrypts every file with AES-256-GCM. Each
// encrypted file is:  "MMBJ1" (5 bytes) + IV (12 bytes) + ciphertext and tag.
// The file's path in the journal folder is bound in as "additional data", so an
// encrypted file can't be swapped for another one without it being noticed.
//
// The journal key itself is stored "wrapped" (encrypted) by other keys:
//   - the PIN (PBKDF2-SHA-256), on the phone only
//   - the fingerprint (passkey PRF output through HKDF), on the phone only
//   - the recovery key (120 random bits through HKDF), on the phone and in Dropbox

const enc = new TextEncoder();
const MAGIC = enc.encode('MMBJ1');
const IV_BYTES = 12;
export const ENC_SUFFIX = '.enc';
export const RECOVERY_INFO = 'mmb-journal recovery key v1';
export const FINGERPRINT_INFO = 'mmb-journal fingerprint v1';

export const b64 = bytes => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

const aesKey = (raw, usages = ['encrypt', 'decrypt']) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);

/** A new random journal key (raw bytes) and its CryptoKey. */
export async function newJournalKey() {
  const raw = randomBytes(32);
  return { raw, key: await aesKey(raw) };
}
export const importJournalKey = raw => aesKey(raw);

/** A short ID for a journal key, so two devices can tell whether they share one. Reveals nothing about the key. */
export async function keyId(raw) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...enc.encode('mmb-journal key id v1:'), ...raw])));
  return Array.from(h.subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

/** Encrypts bytes (or a string) for the file at `path`. */
export async function encryptFile(key, data, path) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(path) }, key, bytes));
  const out = new Uint8Array(MAGIC.length + IV_BYTES + ct.length);
  out.set(MAGIC); out.set(iv, MAGIC.length); out.set(ct, MAGIC.length + IV_BYTES);
  return out;
}

export const isEncrypted = bytes => bytes.length > MAGIC.length + IV_BYTES && MAGIC.every((b, i) => bytes[i] === b);

/** Decrypts a file made by encryptFile. Throws if the key or path is wrong, or the file was changed. */
export async function decryptFile(key, data, path) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isEncrypted(bytes)) throw new Error('not an MMB Journal encrypted file');
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(path) }, key,
    bytes.subarray(MAGIC.length + IV_BYTES)));
}

// ---------- wrapping the journal key ----------

export async function kekFromPin(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function kekFromSecret(secret, salt, info) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrap(kek, raw) {
  const iv = randomBytes(IV_BYTES);
  return { iv: b64(iv), key: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw)) };
}
/** Returns the raw journal key, or throws if the wrapping key is wrong. */
export async function unwrap(kek, wrapped) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapped.iv) }, kek, unb64(wrapped.key)));
}

// ---------- recovery key ----------
// 24 characters in 6 groups of 4, from an alphabet with no I, L, O or U, so it's
// easy to copy by hand. 24 × 5 bits = 120 random bits.
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRecoveryKey() {
  const bytes = randomBytes(15);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += ABC[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}

/** Turns typed text into the key's 15 bytes, forgiving spaces, dashes, case and I/L/O mix-ups. Null if it isn't a whole key. */
export function parseRecoveryKey(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 24 || [...clean].some(c => !ABC.includes(c))) return null;
  const out = new Uint8Array(15);
  let bits = 0, value = 0, i = 0;
  for (const c of clean) {
    value = ((value << 5) | ABC.indexOf(c)) & 0xffff; bits += 5;
    if (bits >= 8) { out[i++] = (value >>> (bits - 8)) & 255; bits -= 8; }
  }
  return out;
}

/** The recovery block stored in journal.json: the journal key wrapped by the recovery key. */
export async function recoveryBlock(raw, recoveryText) {
  const salt = randomBytes(16);
  const kek = await kekFromSecret(parseRecoveryKey(recoveryText), salt, RECOVERY_INFO);
  return { kdf: 'HKDF-SHA-256', salt: b64(salt), info: RECOVERY_INFO, wrap: 'AES-256-GCM', ...(await wrap(kek, raw)) };
}
export async function openRecoveryBlock(block, recoveryText) {
  const secret = parseRecoveryKey(recoveryText);
  if (!secret) throw new Error('That isn\'t a complete recovery key. It has 24 letters and numbers.');
  const kek = await kekFromSecret(secret, unb64(block.salt), block.info || RECOVERY_INFO);
  try { return await unwrap(kek, block); }
  catch { throw new Error('That recovery key doesn\'t open this journal.'); }
}

/** The encryption section of journal.json (safe to store in Dropbox). */
export const encryptionInfo = async (raw, recovery) => ({
  cipher: 'AES-256-GCM',
  file: 'MMBJ1 (5 bytes) + 12-byte IV + ciphertext; additional data = the file\'s path in the journal folder, without .enc',
  keyId: await keyId(raw),
  recovery
});
