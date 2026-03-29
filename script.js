let data = null;
let fixedSelection = [];
let wildcardRequests = [];
let combinations = [];
let comboIdx = 0;
let allowOverlap = true;
let onlyPresence = false;
let noQuereinsteiger = false;

const TIMES = ["17:10", "17:55", "18:45", "19:30", "20:25", "21:10"];
const COLLISION_EXCEPTIONS = [
    ["M2m", "M3m"], ["M4m", "M5m"], ["M6m", "M7m"],
    ["D2m", "D3m"], ["D4m", "D5m"], ["D6m", "D7m"],
    ["E2m", "E3m"], ["E4m", "E5m"], ["E6m", "E7m"],
    ["CH1k", "CH2k"], ["GPB2k", "GPB3k"]
];

// --- HILFSFUNKTIONEN FÜR ÜBERSCHNEIDUNGEN ---

function popcount(n) {
    let count = 0;
    let temp = BigInt(n);
    while (temp > 0n) {
        if ((temp & 1n) === 1n) count++;
        temp >>= 1n;
    }
    return count;
}

function isFernstudienmodul(name) {
    return /\d[stuqprm]/.test(name);
}

function isQuereinsteigermodul(name) {
    return /\d[ghjk]/.test(name);
}

function countInitialOverlaps(modules) {
    if (onlyPresence && modules.some(m => isFernstudienmodul(m.name))) return -1;
    if (noQuereinsteiger && modules.some(m => isQuereinsteigermodul(m.name))) return -1;
    let count = 0;
    for (let i = 0; i < modules.length; i++) {
        for (let j = i + 1; j < modules.length; j++) {
            const overlapBits = BigInt(modules[i].bitmask) & BigInt(modules[j].bitmask);
            if (overlapBits !== 0n) {
                const isEx = COLLISION_EXCEPTIONS.some(p => p.includes(modules[i].name) && p.includes(modules[j].name));
                if (!isEx) {
                    if (!allowOverlap) return -1;
                    if (isFernstudienmodul(modules[i].name) || isFernstudienmodul(modules[j].name)) return -1;
                    if (popcount(BigInt(modules[i].bitmask)) < 6 || popcount(BigInt(modules[j].bitmask)) < 6) return -1;
                    if (popcount(overlapBits) > 2) return -1;
                    count += 1;
                }
            }
        }
    }
    return count;
}

function canAddModule(m, currentModules, currentUsedOverlaps) {
    if (onlyPresence && isFernstudienmodul(m.name)) return { valid: false };
    if (noQuereinsteiger && isQuereinsteigermodul(m.name)) return { valid: false };
    let newOvl = 0;
    const mBits = BigInt(m.bitmask);

    for (const other of currentModules) {
        const overlapBits = mBits & BigInt(other.bitmask);
        if (overlapBits !== 0n) {
            const isEx = COLLISION_EXCEPTIONS.some(p => p.includes(m.name) && p.includes(other.name));
            if (!isEx) {
                if (!allowOverlap) return { valid: false };
                if (isFernstudienmodul(m.name) || isFernstudienmodul(other.name)) return { valid: false };
                if (popcount(mBits) < 6 || popcount(BigInt(other.bitmask)) < 6) return { valid: false };
                if (popcount(overlapBits) > 2) return { valid: false };
                newOvl += 1;
            }
        }
    }

    if (currentUsedOverlaps + newOvl > 1) return { valid: false };
    return { valid: true, newOvl: newOvl };
}

// --- INIT & RENDER LOGIK ---

async function init() {
    try {
        const response = await fetch('unterrichte.json');
        data = await response.json();
        generateGrid();
        renderSidebar();
    } catch (error) {
        console.error("Fehler beim Laden von unterrichte.json:", error);
        document.getElementById('current-status').innerText = 'Fehler: unterrichte.json konnte nicht geladen werden.';
    }
}

function renderSidebar() {
    const pflichtDiv = document.getElementById('pflicht-content');
    const freiDiv = document.getElementById('frei-content');

    for (const [fach, stufen] of Object.entries(data.Pflichtfach)) {
        pflichtDiv.appendChild(createAccordion(fach, () => {
            const wrap = document.createElement('div');
            for (const [stufe, module] of Object.entries(stufen)) {
                wrap.appendChild(createAccordion(`Stufe ${stufe}`, () => renderModuleList(module, fach, stufe)));
            }
            return wrap;
        }));
    }

    const freieListe = [];
    Object.values(data.Pflichtfach).forEach(subject => {
        Object.values(subject).forEach(levelModules => {
            levelModules.forEach(m => { if (m.pflicht === "nein") freieListe.push(m); });
        });
    });

    if (data["Nicht-Pflichtfach"]) {
        Object.values(data["Nicht-Pflichtfach"]).forEach(modulesArray => {
            freieListe.push(...modulesArray);
        });
    }

    if (freieListe.length > 0) {
        freiDiv.appendChild(renderModuleList(freieListe));
    }
}

function renderModuleList(modules, fach = null, stufe = null) {
    const ul = document.createElement('ul');
    ul.className = 'item-list';

    if (fach && stufe) {
        const li = document.createElement('li');
        li.id = `wildcard-${fach}-${stufe}`;
        li.innerHTML = `✨ <b>Beliebiges ${fach} ${stufe} Modul</b>`;
        li.onclick = () => {
            if (li.classList.contains('conflict')) return; // Klick blockieren, falls Konflikt
            toggleWildcard(fach, stufe, modules);
        };
        ul.appendChild(li);
    }

    modules.forEach(m => {
        const li = document.createElement('li');
        li.id = `li-${m.name}`;
        li.dataset.bitmask = m.bitmask;
        li.innerText = `${m.name} (${m.lehrer})`;

        // Regulärer Klick (Modul hinzufügen/entfernen)
        li.onclick = () => {
            if (li.classList.contains('conflict')) return; // Verhindert Auswahl bei Konflikt
            toggleFixedModule(m, fach, stufe);
        };

        // Maus-Events für die Vorschau-Rahmen
        li.onmousedown = () => {
            if (li.classList.contains('conflict')) showPreview(m);
        };
        li.onmouseup = hidePreview;
        li.onmouseleave = hidePreview;

        // Touch-Events für mobile Geräte
        li.ontouchstart = () => {
            if (li.classList.contains('conflict')) showPreview(m);
        };
        li.ontouchend = hidePreview;
        li.ontouchcancel = hidePreview;

        ul.appendChild(li);
    });
    return ul;
}

// --- VORSCHAU-LOGIK FÜR KONFLIKT-MODULE ---

function showPreview(m) {
    // Alte Vorschauen sofort entfernen, falls man sehr schnell klickt
    document.querySelectorAll('.module-preview-frame').forEach(f => f.remove());

    m.schedule.forEach(entry => {
        const timeIdx = getTimeIndex(entry.beginn);
        if (timeIdx === -1) return;

        let position = 'full';
        if (entry.ist_halbe_stunde) {
            const slotStart = TIMES[timeIdx];
            const diff = timeToMinutes(entry.beginn) - timeToMinutes(slotStart);
            position = diff > 15 ? 'bottom' : 'top';
        }

        const cell = document.getElementById(`cell-${entry.tag}-${timeIdx}`);
        if (cell) {
            const frame = document.createElement('div');
            frame.className = 'module-preview-frame';
            if (position === 'top') frame.classList.add('half-unit');
            else if (position === 'bottom') frame.classList.add('half-unit-bottom');
            else frame.classList.add('full-unit');

            cell.appendChild(frame);
        }
    });
}

function hidePreview() {
    document.querySelectorAll('.module-preview-frame:not(.fade-out)').forEach(frame => {
        frame.classList.add('fade-out');
        // Nach der CSS-Transition (400ms) aus dem DOM entfernen
        setTimeout(() => frame.remove(), 400);
    });
}

// --- REST DER LOGIK ---

function getTimeIndex(timeStr) {
    for (let i = TIMES.length - 1; i >= 0; i--) {
        if (timeStr >= TIMES[i]) return i;
    }
    return -1;
}

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function renderSchedule(modules) {
    document.querySelectorAll('.module-block').forEach(b => b.remove());

    const cellMap = {};

    modules.forEach(m => {
        m.schedule.forEach(entry => {
            const timeIdx = getTimeIndex(entry.beginn);
            if (timeIdx === -1) return;

            let position = 'full';
            if (entry.ist_halbe_stunde) {
                const slotStart = TIMES[timeIdx];
                const diff = timeToMinutes(entry.beginn) - timeToMinutes(slotStart);
                position = diff > 15 ? 'bottom' : 'top';
            }

            const cellKey = `${entry.tag}-${timeIdx}`;
            if (!cellMap[cellKey]) cellMap[cellKey] = [];

            if (!cellMap[cellKey].some(x => x.name === m.name && x.pos === position)) {
                cellMap[cellKey].push({ name: m.name, lehrer: m.lehrer, pos: position, day: entry.tag, tIdx: timeIdx });
            }
        });
    });

    const cellGroups = {};

    for (const [cellKey, entries] of Object.entries(cellMap)) {
        const hasHalf = entries.some(e => e.pos === 'top' || e.pos === 'bottom');

        entries.forEach(e => {
            if (e.pos === 'full' && hasHalf) {
                const topKey = `${cellKey}-top`;
                const bottomKey = `${cellKey}-bottom`;

                if (!cellGroups[topKey]) cellGroups[topKey] = { names: [], teachers: [], pos: 'top', day: e.day, tIdx: e.tIdx };
                cellGroups[topKey].names.push(e.name);
                cellGroups[topKey].teachers.push(e.lehrer);

                if (!cellGroups[bottomKey]) cellGroups[bottomKey] = { names: [], teachers: [], pos: 'bottom', day: e.day, tIdx: e.tIdx };
                cellGroups[bottomKey].names.push(e.name);
                cellGroups[bottomKey].teachers.push(e.lehrer);
            } else {
                const exactKey = `${cellKey}-${e.pos}`;
                if (!cellGroups[exactKey]) cellGroups[exactKey] = { names: [], teachers: [], pos: e.pos, day: e.day, tIdx: e.tIdx };
                cellGroups[exactKey].names.push(e.name);
                cellGroups[exactKey].teachers.push(e.lehrer);
            }
        });
    }

    for (const [key, cellData] of Object.entries(cellGroups)) {
        const cell = document.getElementById(`cell-${cellData.day}-${cellData.tIdx}`);
        if (cell) {
            const block = document.createElement('div');
            block.className = 'module-block';
            if (cellData.pos === 'top') block.classList.add('half-unit');
            else if (cellData.pos === 'bottom') block.classList.add('half-unit-bottom');
            else block.classList.add('full-unit');

            const uniqueNames = [...new Set(cellData.names)];
            const uniqueTeachers = [...new Set(cellData.teachers)];

            block.innerHTML = `<strong>${uniqueNames.join(' / ')}</strong><br>${uniqueTeachers.join(' / ')}`;

            if (uniqueNames.length > 1) {
                const isEx = COLLISION_EXCEPTIONS.some(p => p.includes(uniqueNames[0]) && p.includes(uniqueNames[1]));
                if (!isEx) {
                    block.style.backgroundColor = '#ef4444';
                }
            }

            cell.appendChild(block);
        }
    }
}

function calculateCombinations() {
    const results = [];

    const baseSelection = fixedSelection.filter(fs =>
        !wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
    );

    const initialOvl = countInitialOverlaps(baseSelection);
    if (initialOvl === -1) {
        combinations = [];
        document.getElementById('combination-controls').classList.add('hidden');
        renderSchedule(fixedSelection);
        updateStatusText(fixedSelection);
        return;
    }

    function solve(depth, currentModules, usedOverlaps) {
        if (depth === wildcardRequests.length) {
            results.push([...currentModules]);
            return;
        }
        const req = wildcardRequests[depth];
        for (const m of req.modules) {
            const check = canAddModule(m, currentModules, usedOverlaps);
            if (check.valid) {
                currentModules.push(m);
                solve(depth + 1, currentModules, usedOverlaps + check.newOvl);
                currentModules.pop();
                if (results.length >= 5000) break;
            }
        }
    }

    solve(0, [...baseSelection], initialOvl);
    combinations = results;
    comboIdx = 0;

    const ui = document.getElementById('combination-controls');
    if (combinations.length > 0) {
        ui.classList.remove('hidden');
        showCombo(0);
    } else {
        ui.classList.add('hidden');
        if (wildcardRequests.length > 0) alert("Keine gültige Kombination (unter Beachtung der Überschneidungsregeln) möglich!");
        renderSchedule(fixedSelection);
        updateStatusText(fixedSelection);
    }
}

function toggleFixedModule(m, fach, stufe) {
    const idx = fixedSelection.findIndex(x => x.name === m.name);
    if (idx > -1) {
        fixedSelection.splice(idx, 1);
    } else {
        if (fach && stufe) {
            const wIdx = wildcardRequests.findIndex(w => w.fach === fach && w.stufe === stufe);
            if (wIdx > -1) wildcardRequests.splice(wIdx, 1);
            fixedSelection = fixedSelection.filter(fs => !(fs.fach_lang === m.fach_lang && fs.stufe == m.stufe));
        }

        const currentOvl = countInitialOverlaps(fixedSelection);
        if (currentOvl === -1) return;
        if (!canAddModule(m, fixedSelection, currentOvl).valid) return;

        fixedSelection.push(m);
    }
    updateSystem();
}

function toggleWildcard(fach, stufe, modules) {
    const idx = wildcardRequests.findIndex(w => w.fach === fach && w.stufe === stufe);
    if (idx > -1) {
        wildcardRequests.splice(idx, 1);
    } else {
        fixedSelection = fixedSelection.filter(fs => !modules.some(m => m.name === fs.name));
        wildcardRequests.push({ fach, stufe, modules });
    }
    updateSystem();
}

function updateStatusText(modules) {
    const statusDiv = document.getElementById('current-status');
    const names = modules.map(m => m.name).sort().join(', ');
    statusDiv.innerHTML = `<strong>Gewählte Module:</strong> ${names}`;
}

function updateSystem() {
    if (wildcardRequests.length > 0) calculateCombinations();
    else {
        combinations = [];
        document.getElementById('combination-controls').classList.add('hidden');
        renderSchedule(fixedSelection);
        updateStatusText(fixedSelection);
    }
    updateSidebarUI();
}

function findModuleByName(name) {
    for (const fach of Object.values(data.Pflichtfach)) {
        for (const stufe of Object.values(fach)) {
            const found = stufe.find(m => m.name === name);
            if (found) return found;
        }
    }
    if (data["Nicht-Pflichtfach"]) {
        for (const modules of Object.values(data["Nicht-Pflichtfach"])) {
            const found = modules.find(m => m.name === name);
            if (found) return found;
        }
    }
    return null;
}

function isWildcardViable(fach, stufe, modules) {
    const currentWildcards = wildcardRequests.filter(w => !(w.fach === fach && w.stufe === stufe));
    const tempWildcards = [...currentWildcards, { fach, stufe, modules }];

    const baseSelection = fixedSelection.filter(fs =>
        !tempWildcards.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
    );

    const initialOvl = countInitialOverlaps(baseSelection);
    if (initialOvl === -1) return false;

    let possible = false;
    function quickCheck(depth, currentModules, usedOvl) {
        if (possible) return;
        if (depth === tempWildcards.length) { possible = true; return; }
        for (const m of tempWildcards[depth].modules) {
            const check = canAddModule(m, currentModules, usedOvl);
            if (check.valid) {
                currentModules.push(m);
                quickCheck(depth + 1, currentModules, usedOvl + check.newOvl);
                currentModules.pop();
            }
        }
    }
    quickCheck(0, [...baseSelection], initialOvl);
    return possible;
}

function updateSidebarUI() {
    document.querySelectorAll('.item-list li').forEach(li => {
        li.classList.remove('selected', 'wildcard-active', 'conflict');

        if (li.id.startsWith('wildcard-')) {
            const [_, f, s] = li.id.split('-');
            const isActive = wildcardRequests.some(w => w.fach === f && w.stufe === s);
            if (isActive) {
                li.classList.add('wildcard-active');
            } else {
                const modules = data.Pflichtfach[f][s];
                if (!isWildcardViable(f, s, modules)) li.classList.add('conflict');
            }
            return;
        }

        const mName = li.id.replace('li-', '');
        const mObj = findModuleByName(mName);

        if (fixedSelection.some(s => s.name === mName)) {
            li.classList.add('selected');
        } else if (mObj) {
            const filterReplaced = (list) => {
                if (mObj.fach_lang && mObj.stufe) {
                    return list.filter(fs => !(fs.fach_lang === mObj.fach_lang && fs.stufe == mObj.stufe));
                }
                return list;
            };

            const testSelection = filterReplaced(fixedSelection);
            const initialOvl = countInitialOverlaps(testSelection);

            if (initialOvl === -1 || !canAddModule(mObj, testSelection, initialOvl).valid) {
                li.classList.add('conflict');
            } else if (wildcardRequests.length > 0) {
                const activeWildcards = wildcardRequests.filter(w =>
                    !(mObj.fach_lang && mObj.stufe && w.fach === mObj.fach_lang && w.stufe == mObj.stufe)
                );

                let possible = false;
                const checkFirst = canAddModule(mObj, testSelection, initialOvl);
                const startSelection = [...testSelection, mObj];
                const startOvl = initialOvl + checkFirst.newOvl;

                const quickCheck = (depth, currentModules, usedOvl) => {
                    if (possible) return;
                    if (depth === activeWildcards.length) { possible = true; return; }
                    for (const m of activeWildcards[depth].modules) {
                        const check = canAddModule(m, currentModules, usedOvl);
                        if (check.valid) {
                            currentModules.push(m);
                            quickCheck(depth + 1, currentModules, usedOvl + check.newOvl);
                            currentModules.pop();
                        }
                    }
                };
                quickCheck(0, startSelection, startOvl);
                if (!possible) li.classList.add('conflict');
            }
        }
    });
}

function generateGrid() {
    const grid = document.getElementById('schedule-grid');
    TIMES.forEach((time, i) => {
        const tLabel = document.createElement('div');
        tLabel.className = 'grid-cell time-label';

        let [h, m] = time.split(':').map(Number);
        m += 45;
        h += Math.floor(m / 60);
        m = m % 60;
        const endTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        tLabel.innerHTML = `${time}<br>-<br>${endTime}`;
        grid.appendChild(tLabel);
        for (let d = 0; d < 5; d++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.id = `cell-${d}-${i}`;
            grid.appendChild(cell);
        }
    });
}

function createAccordion(title, contentCb) {
    const wrap = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'accordion-header';
    btn.innerText = title;
    const content = document.createElement('div');
    content.className = 'accordion-content';
    btn.onclick = () => {
        if (!content.hasChildNodes()) content.appendChild(contentCb());
        content.classList.toggle('active');
        btn.classList.toggle('active');
        updateSidebarUI();
    };
    wrap.appendChild(btn); wrap.appendChild(content);
    return wrap;
}

function toggleAllowOverlap() {
    const chk = document.getElementById('allow-overlap-chk');

    if (chk.checked) {
        allowOverlap = true;
        updateSystem();
    } else {
        allowOverlap = false;

        const tempValid = checkSystemValidWithoutOverlaps();

        if (tempValid) {
            updateSystem();
        } else {
            if (confirm("Für die gegebene Modulwahl existiert keine Variante ohne Überschneidung. Soll der Stundenplan komplett zurückgesetzt werden?")) {
                resetSchedule(true);
            } else {
                chk.checked = true;
                allowOverlap = true;
            }
        }
    }
}

function checkSystemValidWithoutOverlaps() {
    if (countInitialOverlaps(fixedSelection) === -1) return false;

    if (wildcardRequests.length === 0) return true;

    const baseSelection = fixedSelection.filter(fs =>
        !wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
    );
    let possible = false;
    function quickSolve(depth, currentModules) {
        if (possible) return;
        if (depth === wildcardRequests.length) { possible = true; return; }
        for (const m of wildcardRequests[depth].modules) {
            const check = canAddModule(m, currentModules, 0);
            if (check.valid) {
                currentModules.push(m);
                quickSolve(depth + 1, currentModules);
                currentModules.pop();
            }
        }
    }
    quickSolve(0, [...baseSelection]);
    return possible;
}

function checkSystemValidWithCurrentSettings() {
    const baseSelection = fixedSelection.filter(fs =>
        !wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
    );

    const initialOvl = countInitialOverlaps(baseSelection);
    if (initialOvl === -1) return false;
    if (wildcardRequests.length === 0) return true;

    let possible = false;
    function quickSolve(depth, currentModules, usedOvl) {
        if (possible) return;
        if (depth === wildcardRequests.length) { possible = true; return; }
        for (const m of wildcardRequests[depth].modules) {
            const check = canAddModule(m, currentModules, usedOvl);
            if (check.valid) {
                currentModules.push(m);
                quickSolve(depth + 1, currentModules, usedOvl + check.newOvl);
                currentModules.pop();
            }
        }
    }
    quickSolve(0, [...baseSelection], initialOvl);
    return possible;
}

function toggleOnlyPresence() {
    const chk = document.getElementById('only-presence-chk');

    if (!chk.checked) { // Toggle wird AUSgeschaltet -> Fernstudium verbieten
        onlyPresence = true;
        const tempValid = checkSystemValidWithCurrentSettings();

        if (tempValid) {
            updateSystem();
        } else {
            if (confirm("Für die gegebene Modulwahl existiert keine Variante ohne Fernstudien-Modul. Soll der Stundenplan komplett zurückgesetzt werden?")) {
                resetSchedule(true);
                chk.checked = false; // Bleibt aus
                onlyPresence = true;
            } else {
                chk.checked = true; // Wird wieder an gemacht
                onlyPresence = false;
            }
        }
    } else { // Toggle wird EINgeschaltet -> Fernstudium erlauben
        onlyPresence = false;
        updateSystem();
    }
}

// --- NEUE FUNKTION FÜR QUEREINSTEIGER-MODULE ---
function toggleNoQuereinsteiger() {
    const chk = document.getElementById('no-quereinsteiger-chk');

    if (!chk.checked) { // Toggle wird AUSgeschaltet -> Quereinsteiger verbieten
        noQuereinsteiger = true;
        const tempValid = checkSystemValidWithCurrentSettings();

        if (tempValid) {
            updateSystem();
        } else {
            if (confirm("Für die gegebene Modulwahl existiert keine Variante ohne Quereinsteiger-Modul. Soll der Stundenplan komplett zurückgesetzt werden?")) {
                resetSchedule(true);
                chk.checked = false; // Bleibt aus
                noQuereinsteiger = true;
            } else {
                chk.checked = true; // Wird wieder an gemacht
                noQuereinsteiger = false;
            }
        }
    } else { // Toggle wird EINgeschaltet -> Quereinsteiger erlauben
        noQuereinsteiger = false;
        updateSystem();
    }
}

function showCombo(idx) {
    document.getElementById('combo-info').innerText = `${combinations.length}${combinations.length >= 1000 ? '+' : ''} Varianten gefunden (${idx + 1}/${combinations.length})`;
    renderSchedule(combinations[idx]);
    updateStatusText(combinations[idx]);
}

function nextCombo() { comboIdx = (comboIdx + 1) % combinations.length; showCombo(comboIdx); }
function prevCombo() { comboIdx = (comboIdx - 1 + combinations.length) % combinations.length; showCombo(comboIdx); }
function applyCurrentCombo() { fixedSelection = [...combinations[comboIdx]]; wildcardRequests = []; updateSystem(); }

function resetSchedule(skipConfirm = false) {
    if (!skipConfirm && !confirm("Soll der Stundenplan komplett zurückgesetzt werden?")) return;

    fixedSelection = [];
    wildcardRequests = [];
    document.querySelectorAll('.accordion-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.accordion-header').forEach(el => el.classList.remove('active'));
    updateSystem();
}

function toggleAccordion(id) { document.getElementById(id).classList.toggle('active'); }

function exportPDF() {
    const list = document.getElementById('print-modules');
    list.innerHTML = '';

    let modulesToPrint = combinations.length > 0 ? combinations[comboIdx] : fixedSelection;
/*
    if (modulesToPrint.length === 0) {
        alert("Bitte wähle zuerst Module aus.");
        return;
    }
*/
    const sortedModules = [...modulesToPrint].sort((a, b) => a.name.localeCompare(b.name));

    sortedModules.forEach(m => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${m.name}</strong> (${m.lehrer})`;
        list.appendChild(li);
    });

    setTimeout(() => window.print(), 100);
}

init();