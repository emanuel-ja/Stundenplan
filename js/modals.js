/**
 * Single-instance modal system.
 * All dialogs reuse the same overlay/content DOM nodes defined in index.html,
 * avoiding repeated creation/destruction and layout thrash.
 */
export const Modals = {

    /**
     * Renders and displays the modal.
     * @param {object} opts
     * @param {string}      [opts.title]
     * @param {string}      [opts.text]
     * @param {HTMLElement} [opts.bodyElement] - Arbitrary DOM content inserted after text.
     * @param {Array<{text: string, className?: string, onClick?: function, closesModal?: boolean}>} [opts.buttons]
     * @param {string}      [opts.widthClass]  - Extra class on the content box (e.g. 'modal-wide').
     * @param {function}    [opts.onClose]     - Called when the overlay is clicked.
     */
    show({ title = '', text = '', bodyElement = null, buttons = [], widthClass = '', onClose = null }) {
        const overlay    = document.getElementById('app-modal');
        const contentBox = document.getElementById('app-modal-content');

        contentBox.innerHTML = '';
        contentBox.className = ['modal-content', 'text-center', widthClass].filter(Boolean).join(' ');

        if (title) {
            const el = document.createElement('div');
            el.className   = 'modal-title';
            el.textContent = title;
            contentBox.appendChild(el);
        }

        if (text) {
            const el = document.createElement('p');
            el.className   = 'modal-text';
            el.textContent = text;
            contentBox.appendChild(el);
        }

        if (bodyElement) contentBox.appendChild(bodyElement);

        if (buttons.length > 0) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'flex justify-center gap-md';

            for (const cfg of buttons) {
                const btn = document.createElement('button');
                btn.className  = cfg.className ?? 'btn btn-outline btn-md';
                btn.textContent = cfg.text;
                if (cfg.fullWidth) btn.classList.add('w-full');

                btn.addEventListener('click', () => {
                    if (cfg.closesModal !== false) Modals.hide();
                    cfg.onClick?.();
                });
                actionsDiv.appendChild(btn);
            }
            contentBox.appendChild(actionsDiv);
        }

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                Modals.hide();
                onClose?.();
            }
        };

        overlay.classList.remove('hidden');
    },

    hide() {
        const overlay = document.getElementById('app-modal');
        overlay.classList.add('hidden');
        overlay.onclick = null;
    },

    // ── Convenience wrappers ──────────────────────────────────────────────────

    /**
     * Shows a simple info dialog with a single "OK" button.
     * Closing via backdrop click or the button both just dismiss the modal.
     * @param {string} message
     */
    showAlert(message) {
        Modals.show({
            text: message,
            buttons: [
                { text: 'OK', className: 'btn btn-primary btn-md' },
            ],
        });
    },

    /**
     * Shows a confirm dialog with a cancel and a confirm button.
     * @param {string}   message
     * @param {function} onConfirm
     * @param {function} [onCancel]
     * @param {string}   [confirmText]
     * @param {boolean}  [usePrimaryButton]
     */
    showConfirm(message, onConfirm, onCancel, confirmText = 'Ja', usePrimaryButton = false) {
        Modals.show({
            text: message,
            onClose: onCancel,
            buttons: [
                { text: 'Abbrechen', className: 'btn btn-outline btn-md', onClick: onCancel },
                {
                    text: confirmText,
                    className: usePrimaryButton ? 'btn btn-primary btn-md' : 'btn btn-danger btn-md',
                    onClick: onConfirm,
                },
            ],
        });
    },

    /**
     * Promise-based confirm dialog.
     * Resolves to `true` on confirm, `false` on cancel or backdrop click.
     * @param {string}  message
     * @param {string}  [confirmText]
     * @param {boolean} [usePrimaryButton]
     * @returns {Promise<boolean>}
     */
    confirm(message, confirmText = 'Ja', usePrimaryButton = true) {
        return new Promise(resolve => {
            Modals.showConfirm(message, () => resolve(true), () => resolve(false), confirmText, usePrimaryButton);
        });
    },

    /**
     * Shows a scrollable list of modules for the user to choose one from.
     * Resolves to the selected module, or `null` if cancelled.
     * @param {object[]} modules
     * @returns {Promise<object|null>}
     */
    chooseModule(modules) {
        return new Promise(resolve => {
            const listContainer = document.createElement('div');
            listContainer.className = 'modal-body-scrollable flex flex-col text-left gap-sm';

            [...modules]
                .sort((a, b) => (a.fach_lang || a.name).localeCompare(b.fach_lang || b.name))
                .forEach(m => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-choice flex flex-col gap-xs text-left';

                    const nameEl = document.createElement('strong');
                    nameEl.textContent = m.name;
                    const metaEl = document.createElement('span');
                    metaEl.textContent = `${m.fach_lang ? `${m.fach_lang} ` : ''}(${m.lehrer})`;
                    btn.append(nameEl, metaEl);
                    btn.addEventListener('click', () => { Modals.hide(); resolve(m); });
                    listContainer.appendChild(btn);
                });

            Modals.show({
                title: 'Wähle eines der folgenden Module:',
                bodyElement: listContainer,
                widthClass: 'modal-wide',
                onClose: () => resolve(null),
                buttons: [
                    { text: 'Abbrechen', className: 'btn btn-outline btn-md w-full', onClick: () => resolve(null) },
                ],
            });
        });
    },
};
