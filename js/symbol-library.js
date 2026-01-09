/**
 * Symbol Library Manager
 * Simple manager for P&ID symbols from the /symbols folder
 */

// ============================================
// SYMBOL REGISTRY - Add your symbols here!
// ============================================
// Just add entries with filename and display name
// The dropdown will automatically populate from this list

const SYMBOL_LIBRARY = [
    // Basic Valves
    { file: 'valve-open.png', name: 'Valve (Open)' },
    { file: 'valve-closed.png', name: 'Valve (Closed)' },
    
    // Globe Valves
    { file: 'valve-globe.png', name: 'Globe Valve (Open)' },
    { file: 'valve-globe-closed.png', name: 'Globe Valve (Closed)' },
    
    // Ball Valves
    { file: 'valve-ball-open.png', name: 'Ball Valve (Open)' },
    { file: 'valve-ball-closed.png', name: 'Ball Valve (Closed)' },
    { file: 'valve-ball-segment-open.png', name: 'Ball Valve Segment (Open)' },
    { file: 'alve-ball-segment-closed.png', name: 'Ball Valve Segment (Closed)' },
    
    // Gate Valves
    { file: 'valve-gate-open.png', name: 'Gate Valve (Open)' },
    { file: 'valve-gate-closed.png', name: 'Gate Valve (Closed)' },
    
    // Butterfly Valves
    { file: 'valve-butterfly-open.png', name: 'Butterfly Valve (Open)' },
    { file: 'valve-butterfly-closed.png', name: 'Butterfly Valve (Closed)' },
    
    // Knife Gate Valves
    { file: 'valve-knife-gate-open.png', name: 'Knife Gate Valve (Open)' },
    { file: 'alve-knife-gate-closed.png', name: 'Knife Gate Valve (Closed)' },
    
    // Diaphragm Valves
    { file: 'valve-diaphragm-open.png', name: 'Diaphragm Valve (Open)' },
    { file: 'valve-diaphragm-closed.png', name: 'Diaphragm Valve (Closed)' },
    
    // Needle Valves
    { file: 'valve-needle-open.png', name: 'Needle Valve (Open)' },
    { file: 'valve-neddle-closed.png', name: 'Needle Valve (Closed)' },
    
    // Plug Valves
    { file: 'valve-plug-open.png', name: 'Plug Valve (Open)' },
    { file: 'valve-plug-closed.png', name: 'Plug Valve (Closed)' },
    
    // Shut-off Valves
    { file: 'valve-shut-off-open.png', name: 'Shut-off Valve (Open)' },
    { file: 'valve-shut-off-closed.png', name: 'Shut-off Valve (Closed)' },
    
    // Add more as you add images to /symbols folder:
    // { file: 'pump.png', name: 'Pump' },
    // { file: 'check-valve.png', name: 'Check Valve' },
    // { file: 'heat-exchanger.png', name: 'Heat Exchanger' },
];

// ============================================
// DROPDOWN POPULATION
// ============================================

/**
 * Populate the symbol dropdown with available symbols
 */
function populateSymbolDropdown() {
    const select = document.getElementById('symbolSelect');
    if (!select) return;
    
    // Clear existing options
    select.innerHTML = '<option value="">Choose a symbol...</option>';
    
    // Add "All Valves" option at the top
    const allValvesOption = document.createElement('option');
    allValvesOption.value = 'all-valves';
    allValvesOption.textContent = '🔧 All Valves (Load Everything)';
    select.appendChild(allValvesOption);
    
    // Add custom option next
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = '✂️ Custom (capture from PDF)';
    select.appendChild(customOption);
    
    // Add divider
    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '─────────────────────';
    select.appendChild(divider);
    
    // Add symbols from library
    SYMBOL_LIBRARY.forEach((symbol, index) => {
        const option = document.createElement('option');
        option.value = index.toString();
        option.textContent = symbol.name;
        select.appendChild(option);
    });
    
    console.log(`✓ Symbol dropdown populated with ${SYMBOL_LIBRARY.length} symbols`);
}

/**
 * Get symbol info by dropdown index
 */
function getSymbolByIndex(index) {
    if (index === 'custom' || index === '') return null;
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= SYMBOL_LIBRARY.length) return null;
    return SYMBOL_LIBRARY[idx];
}

/**
 * Handle dropdown selection change
 */
function onSymbolSelectChange() {
    const select = document.getElementById('symbolSelect');
    const hint = document.getElementById('symbol-hint');
    const captureBtn = document.querySelector('#symbolSelect').closest('.step-row')?.querySelector('button');
    
    if (!select) return;
    
    const value = select.value;
    
    if (value === '') {
        // No selection
        if (hint) hint.textContent = '';
        if (captureBtn) captureBtn.disabled = true;
    } else if (value === 'all-valves') {
        // All valves - will load all symbols at once
        if (hint) hint.textContent = `Click "Load" to load all ${SYMBOL_LIBRARY.length} valve symbols at once`;
        if (captureBtn) captureBtn.disabled = false;
    } else if (value === 'custom') {
        // Custom selection - requires manual capture
        if (hint) hint.textContent = 'Draw a box around any symbol in the PDF to capture it';
        if (captureBtn) captureBtn.disabled = false;
    } else {
        // Library symbol selected - will auto-load
        const symbol = getSymbolByIndex(value);
        if (symbol && hint) {
            hint.textContent = `Click "Load" to prepare "${symbol.name}" for detection`;
        }
        if (captureBtn) captureBtn.disabled = false;
    }
}

/**
 * Capture the selected symbol from the PDF
 */
async function captureSelectedSymbol() {
    const select = document.getElementById('symbolSelect');
    if (!select || !select.value) {
        window.showToast('Please select a symbol first', 'error');
        return;
    }
    
    // All valves - load all symbols
    if (select.value === 'all-valves') {
        try {
            window.showToast(`Loading all ${SYMBOL_LIBRARY.length} valve symbols...`, 'info');
            let successCount = 0;
            let failCount = 0;
            
            for (const symbol of SYMBOL_LIBRARY) {
                try {
                    await loadSymbolFromFile(symbol.file, symbol.name);
                    successCount++;
                } catch (err) {
                    console.error(`Failed to load ${symbol.name}:`, err);
                    failCount++;
                }
            }
            
            if (failCount > 0) {
                window.showToast(`✓ Loaded ${successCount} symbols (${failCount} failed)`, 'warning');
            } else {
                window.showToast(`✓ All ${successCount} valve symbols loaded!`, 'success');
            }
        } catch (err) {
            console.error('Failed to load symbols:', err);
            window.showToast('Failed to load valve symbols', 'error');
        }
        return;
    }
    
    // Custom capture - user draws on PDF
    if (select.value === 'custom') {
        if (window.SymbolDetector && window.SymbolDetector.enableTemplateCaptureMode) {
            window.SymbolDetector.enableTemplateCaptureMode('custom', 'Custom Symbol');
        } else {
            window.showToast('Symbol detector not ready', 'error');
        }
        return;
    }
    
    // Predefined symbol - load from image file
    const symbol = getSymbolByIndex(select.value);
    if (!symbol) {
        window.showToast('Invalid symbol selection', 'error');
        return;
    }
    
    try {
        window.showToast(`Loading ${symbol.name}...`, 'info');
        await loadSymbolFromFile(symbol.file, symbol.name);
        window.showToast(`✓ Loaded ${symbol.name}`, 'success');
    } catch (err) {
        console.error('Failed to load symbol:', err);
        window.showToast(`Failed to load ${symbol.name}`, 'error');
    }
}

/**
 * Load a predefined symbol from an image file
 * @param {string} filename - The image filename (e.g., 'valve-open.png')
 * @param {string} displayName - Display name for the symbol
 */
async function loadSymbolFromFile(filename, displayName) {
    if (!window.SymbolDetector) {
        throw new Error('Symbol detector not initialized');
    }
    
    // Create symbol key from filename (remove extension, clean up)
    const symbolKey = filename.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/gi, '');
    
    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    return new Promise((resolve, reject) => {
        img.onload = async () => {
            try {
                // Ensure SYMBOL_TEMPLATES has this key
                if (!window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey]) {
                    window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey] = {
                        name: displayName,
                        category: 'Valves',
                        color: '#9370DB',
                        templates: [],
                        threshold: 0.70
                    };
                }
                
                // Load template at multiple scales for better matching
                const scales = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                for (const scale of scales) {
                    await window.SymbolDetector.loadTemplate(symbolKey, img, scale);
                }
                
                console.log(`✓ Loaded ${displayName} (${scales.length} scales)`);
                
                // Update UI
                if (window.updateTemplateStatus) {
                    window.updateTemplateStatus();
                }
                
                resolve({ key: symbolKey, name: displayName });
            } catch (err) {
                reject(err);
            }
        };
        
        img.onerror = () => reject(new Error(`Failed to load image: ${filename}`));
        img.src = `symbols/${filename}`;
    });
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    populateSymbolDropdown();
});

// ============================================
// EXPORTS
// ============================================

window.SymbolLibrary = {
    SYMBOL_LIBRARY,
    populateSymbolDropdown,
    getSymbolByIndex,
    onSymbolSelectChange,
    captureSelectedSymbol,
    loadSymbolFromFile
};

// Make functions globally available for onclick handlers
window.onSymbolSelectChange = onSymbolSelectChange;
window.captureSelectedSymbol = captureSelectedSymbol;
