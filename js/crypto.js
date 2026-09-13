/**
 * Client-side decryption for the encrypted module-data file (unterrichte.json.enc).
 *
 * ─── WICHTIG: Sicherheits-Realitätscheck ────────────────────────────────────
 * Das hier ist eine reine Frontend-Hürde, keine echte Zugriffskontrolle.
 * Der Browser muss die Datei entschlüsseln können, um die Seite zu befüllen —
 * das heißt, der komplette Entschlüsselungsweg (dieser Code, die verschlüsselte
 * Datei, der Ablauf) liegt offen im ausgelieferten Frontend. Wer die DevTools
 * öffnet, einen Breakpoint setzt oder nach einer erfolgreichen Eingabe einfach
 * `State.data` aus der Konsole ausliest, kommt an die Klartextdaten — unabhängig
 * davon, wie stark die Verschlüsselung selbst ist. AES-GCM + PBKDF2 verhindern
 * hier nur, dass jemand *ohne* Passwort die Rohdatei öffnet oder sie manipuliert,
 * nicht dass ein technisch versierter Besucher *nach* Eingabe an die Daten kommt.
 * Für "Zufallsbesucher draußen halten" reicht das. Für wirklich vertrauliche
 * Daten bräuchte es eine serverseitige Prüfung.
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
 *   [28 .. end) ciphertext || 16-byte GCM authentication tag
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

    let plainBuffer;
    try {
        plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    } catch {
        // SubtleCrypto throws a generic OperationError on tag-verification failure
        // (i.e. wrong password) — we translate that into a clear sentinel here.
        throw new Error('WRONG_PASSWORD');
    }

    return JSON.parse(new TextDecoder().decode(plainBuffer));
}
