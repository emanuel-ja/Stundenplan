        let data = null;
        let fixedSelection = []; 
        let wildcardRequests = []; 
        let combinations = [];
        let comboIdx = 0;

        const TIMES = ["17:10", "17:55", "18:45", "19:30", "20:25", "21:10"];
        const COLLISION_EXCEPTIONS = [
            ["M2m", "M3m"], ["M4m", "M5m"], ["M6m", "M7m"],
            ["D2m", "D3m"], ["D4m", "D5m"], ["D6m", "D7m"],
            ["E2m", "E3m"], ["E4m", "E5m"], ["E6m", "E7m"]
        ];

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
                    levelModules.forEach(m => { if(m.pflicht === "nein") freieListe.push(m); });
                });
            });

            if(data["Nicht-Pflichtfach"]) {
                Object.values(data["Nicht-Pflichtfach"]).forEach(modulesArray => {
                    freieListe.push(...modulesArray);
                });
            }
            
            if(freieListe.length > 0) {
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
                li.onclick = () => toggleWildcard(fach, stufe, modules);
                ul.appendChild(li);
            }

            modules.forEach(m => {
                const li = document.createElement('li');
                li.id = `li-${m.name}`;
                li.dataset.bitmask = m.bitmask;
                li.innerText = `${m.name} (${m.lehrer})`;
                li.onclick = () => toggleFixedModule(m, fach, stufe);
                ul.appendChild(li);
            });
            return ul;
        }

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
            const cellGroups = {};

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
                    const key = `${entry.tag}-${timeIdx}-${position}`;
                    if (!cellGroups[key]) {
                        cellGroups[key] = { names: [], teacher: m.lehrer, pos: position, day: entry.tag, tIdx: timeIdx };
                    }
                    if (!cellGroups[key].names.includes(m.name)) {
                        cellGroups[key].names.push(m.name);
                    }
                });
            });

            for (const [key, cellData] of Object.entries(cellGroups)) {
                const cell = document.getElementById(`cell-${cellData.day}-${cellData.tIdx}`);
                if (cell) {
                    const block = document.createElement('div');
                    block.className = 'module-block';
                    if (cellData.pos === 'top') block.classList.add('half-unit');
                    else if (cellData.pos === 'bottom') block.classList.add('half-unit-bottom');
                    else block.classList.add('full-unit');
                    block.innerHTML = `<strong>${cellData.names.join(' / ')}</strong><br>${cellData.teacher}`;
                    cell.appendChild(block);
                }
            }
        }

        function calculateCombinations() {
            const results = [];
            // Basis-Maske: Alles außer den Fächern, die durch Wildcards ersetzt werden
            const baseSelection = fixedSelection.filter(fs => 
                !wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
            );
            const baseMask = baseSelection.reduce((acc, m) => acc | BigInt(m.bitmask), 0n);

            function solve(depth, currentMask, currentModules) {
                if (depth === wildcardRequests.length) {
                    results.push([...currentModules]);
                    return;
                }
                const req = wildcardRequests[depth];
                for (const m of req.modules) {
                    if (!hasConflict(m, currentMask, currentModules)) {
                        currentModules.push(m);
                        solve(depth + 1, currentMask | BigInt(m.bitmask), currentModules);
                        currentModules.pop();
                        if (results.length >= 1000) break; // Erhöhtes Limit
                    }
                }
            }

            solve(0, baseMask, [...baseSelection]);
            combinations = results;
            comboIdx = 0;

            const ui = document.getElementById('combination-controls');
            if (combinations.length > 0) {
                ui.classList.remove('hidden');
                showCombo(0);
            } else {
                ui.classList.add('hidden');
                if (wildcardRequests.length > 0) alert("Keine überschneidungsfreie Kombination möglich!");
                renderSchedule(fixedSelection);
                updateStatusText(fixedSelection);
            }
        }

        function hasConflict(m, currentMask, currentList) {
            const mMask = BigInt(m.bitmask);
            if ((mMask & currentMask) === 0n) return false;
            for (const other of currentList) {
                if ((BigInt(other.bitmask) & mMask) !== 0n) {
                    const isEx = COLLISION_EXCEPTIONS.some(p => p.includes(m.name) && p.includes(other.name));
                    if (!isEx) return true;
                }
            }
            return false;
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
                if (hasConflict(m, fixedSelection.reduce((acc, x) => acc | BigInt(x.bitmask), 0n), fixedSelection)) return;
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
            if (!modules || modules.length === 0) {
                statusDiv.innerText = 'Wähle Module oder "Beliebiges..."';
            } else {
                const names = modules.map(m => m.name).sort().join(', ');
                statusDiv.innerHTML = `<strong>Gewählte Module:</strong> ${names}`;
            }
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
            
            // Basis: Alles außer den betroffenen Fächern
            const baseSelection = fixedSelection.filter(fs => 
                !tempWildcards.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
            );
            const baseMask = baseSelection.reduce((acc, m) => acc | BigInt(m.bitmask), 0n);
            
            let possible = false;
            function quickCheck(depth, currentMask, currentModules) {
                if (possible) return;
                if (depth === tempWildcards.length) { possible = true; return; }
                for (const m of tempWildcards[depth].modules) {
                    if (!hasConflict(m, currentMask, currentModules)) {
                        currentModules.push(m);
                        quickCheck(depth + 1, currentMask | BigInt(m.bitmask), currentModules);
                        currentModules.pop();
                    }
                }
            }
            quickCheck(0, baseMask, [...baseSelection]);
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

                    if (wildcardRequests.length === 0) {
                        const testSelection = filterReplaced(fixedSelection);
                        const testMask = testSelection.reduce((acc, x) => acc | BigInt(x.bitmask), 0n);
                        if (hasConflict(mObj, testMask, testSelection)) li.classList.add('conflict');
                    } else {
                        // Bei Wildcards: Das Modul unabhängig von den bereits generierten Kombinationen prüfen.
                        // Diese sind nämlich oft auf ein zuvor gewähltes Geschwister-Modul limitiert.
                        const testSelection = filterReplaced(fixedSelection);
                        const testMask = testSelection.reduce((acc, x) => acc | BigInt(x.bitmask), 0n);
                        
                        if (hasConflict(mObj, testMask, testSelection)) {
                            li.classList.add('conflict');
                        } else {
                            // Wildcard ignorieren, falls mObj dieses Fach/Stufe ohnehin ersetzt
                            const activeWildcards = wildcardRequests.filter(w => 
                                !(mObj.fach_lang && mObj.stufe && w.fach === mObj.fach_lang && w.stufe == mObj.stufe)
                            );

                            let possible = false;
                            const startMask = testMask | BigInt(mObj.bitmask);
                            const startSelection = [...testSelection, mObj];
                            
                            const quickCheck = (depth, currentMask, currentModules) => {
                                if (possible) return;
                                if (depth === activeWildcards.length) { possible = true; return; }
                                for (const m of activeWildcards[depth].modules) {
                                    if (!hasConflict(m, currentMask, currentModules)) {
                                        currentModules.push(m);
                                        quickCheck(depth + 1, currentMask | BigInt(m.bitmask), currentModules);
                                        currentModules.pop();
                                    }
                                }
                            };
                            quickCheck(0, startMask, startSelection);
                            if (!possible) li.classList.add('conflict');
                        }
                    }
                }
            });
        }

        function generateGrid() {
            const grid = document.getElementById('schedule-grid');
            TIMES.forEach((time, i) => {
                const tLabel = document.createElement('div');
                tLabel.className = 'grid-cell time-label';
                
                // Endzeit berechnen (+45 Minuten)
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
                updateSidebarUI();
            };
            wrap.appendChild(btn); wrap.appendChild(content);
            return wrap;
        }

        function showCombo(idx) {
            document.getElementById('combo-info').innerText = `${combinations.length}${combinations.length >= 1000 ? '+' : ''} Varianten gefunden (${idx + 1}/${combinations.length})`;
            renderSchedule(combinations[idx]);
            updateStatusText(combinations[idx]);
        }

        function nextCombo() { comboIdx = (comboIdx + 1) % combinations.length; showCombo(comboIdx); }
        function prevCombo() { comboIdx = (comboIdx - 1 + combinations.length) % combinations.length; showCombo(comboIdx); }
        function applyCurrentCombo() { fixedSelection = [...combinations[comboIdx]]; wildcardRequests = []; updateSystem(); }
        
        function resetSchedule() { 
            if (!confirm("Möchtest du den Stundenplan wirklich komplett zurücksetzen?")) return;
            
            fixedSelection = []; 
            wildcardRequests = []; 
            
            // Alle offenen Akkordeons einklappen
            document.querySelectorAll('.accordion-content').forEach(el => el.classList.remove('active'));
            
            updateSystem(); 
        }
        
        function toggleAccordion(id) { document.getElementById(id).classList.toggle('active'); }

        function exportPDF() {
            const list = document.getElementById('print-modules');
            list.innerHTML = '';
            
            // Nimmt entweder die gerade angezeigte Kombination oder die feste Auswahl
            let modulesToPrint = combinations.length > 0 ? combinations[comboIdx] : fixedSelection;

            if (modulesToPrint.length === 0) {
                alert("Bitte wähle zuerst Module aus.");
                return;
            }

            // Alphabetisch nach Fach sortieren für eine saubere Liste
            const sortedModules = [...modulesToPrint].sort((a, b) => a.name.localeCompare(b.name));

            sortedModules.forEach(m => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${m.name}</strong> (${m.lehrer})`;
                list.appendChild(li);
            });

            // Browser-Druckdialog aufrufen (Ziel: "Als PDF speichern")
            setTimeout(() => window.print(), 100); 
        }

        init();