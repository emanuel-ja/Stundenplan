/**
 * Client-side decryption for the encrypted module-data file (unterrichte.json.enc).
 *AES-GCM + PBKDF2
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Must match tools/encrypt-data.js exactly, otherwise decryption fails. */
const PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 16; // bytes
const IV_LEN = 12;   // bytes — standard AES-GCM nonce length

/**
 * Derives an AES-GCM key from a password and salt using PBKDF2-SHA256.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );
}

/**
 * Decrypts an encrypted module-data file and parses it as JSON.
 *
 * Expected binary layout (produced by tools/encrypt-data.js):
 *   [0 .. 16)   salt
 *   [16 .. 28)  iv
 *   [28 .. end) ciphertext(gzip(json)) || 16-byte GCM authentication tag
 *
 * The plaintext recovered by AES-GCM is gzip-compressed, not raw JSON text —
 * encrypt-data.js compresses before encrypting, since encrypted bytes have
 * no exploitable patterns left for gzip to work with. We reverse that order
 * here: decrypt, then decompress.
 *
 * A wrong password almost always throws here rather than returning garbage:
 * GCM's authentication tag check fails before any plaintext is released.
 *
 * @param {ArrayBuffer} fileBuffer - Raw bytes fetched from the .enc file.
 * @param {string} password
 * @returns {Promise<object>} Parsed JSON payload.
 * @throws {Error} 'WRONG_PASSWORD' on auth failure, or a generic error if the
 *                 file itself is missing/too short/corrupt.
 */
export async function decryptModuleData(fileBuffer, password) {
    const bytes = new Uint8Array(fileBuffer);
    if (bytes.length < SALT_LEN + IV_LEN + 1) {
        throw new Error('Datendatei ist beschädigt oder unvollständig.');
    }

    const salt       = bytes.slice(0, SALT_LEN);
    const iv         = bytes.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const ciphertext = bytes.slice(SALT_LEN + IV_LEN);

    const key = await deriveKey(password, salt);

    let compressedBuffer;
    try {
        compressedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    } catch {
        // SubtleCrypto throws a generic OperationError on tag-verification failure
        // (i.e. wrong password) — we translate that into a clear sentinel here.
        throw new Error('WRONG_PASSWORD');
    }

    const jsonBuffer = await gunzip(compressedBuffer);
    return JSON.parse(new TextDecoder().decode(jsonBuffer));
}

/**
 * Decompresses gzip-compressed bytes using the built-in DecompressionStream
 * API (no external library — supported in all current browsers).
 * @param {ArrayBuffer} compressedBuffer
 * @returns {Promise<ArrayBuffer>}
 */
async function gunzip(compressedBuffer) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Dieser Browser unterstützt keine eingebaute Dekomprimierung. Bitte Browser aktualisieren.');
    }
    const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}
