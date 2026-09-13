import { decryptModuleData } from './crypto.js';

/** Path to the encrypted schedule data file, relative to index.html. */
const DATA_URL = 'unterrichte.json.enc';

/**
 * Shows the full-screen password gate defined in index.html, fetches the
 * encrypted data file once, and resolves as soon as the user enters the
 * correct password. Wrong attempts show an inline error and let the user
 * retry — the file is only fetched once and re-used across attempts.
 *
 * @returns {Promise<object>} The decrypted module data (parsed JSON).
 */
export function requestModuleData() {
    const gate      = document.getElementById('password-gate');
    const form      = document.getElementById('password-gate-form');
    const input     = document.getElementById('password-gate-input');
    const errorEl   = document.getElementById('password-gate-error');
    const submitBtn = document.getElementById('password-gate-submit');

    gate.classList.remove('hidden');

    return new Promise((resolve, reject) => {
        let fileBuffer = null;

        /** Lazily fetches and caches the encrypted file's raw bytes. */
        async function ensureFileLoaded() {
            if (fileBuffer) return fileBuffer;
            const res = await fetch(DATA_URL, { cache: 'no-cache' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} – ${DATA_URL} konnte nicht geladen werden.`);
            }
            fileBuffer = await res.arrayBuffer();
            return fileBuffer;
        }

        function showError(message) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }

        input.focus();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = input.value;
            if (!password) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Prüfe…';
            errorEl.classList.add('hidden');

            try {
                const buffer = await ensureFileLoaded();
                const data = await decryptModuleData(buffer, password);
                gate.classList.add('hidden');
                form.reset();
                resolve(data);
                return;
            } catch (err) {
                if (err.message === 'WRONG_PASSWORD') {
                    showError('Falsches Passwort. Bitte erneut versuchen.');
                    input.value = '';
                    input.focus();
                } else {
                    // Data file missing/unreachable/corrupt — retrying won't help
                    // without fixing the deployment, so surface it plainly.
                    showError(err.message);
                    reject(err);
                    return;
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Bestätigen';
            }
        });
    });
}
