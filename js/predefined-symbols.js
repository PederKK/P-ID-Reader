/**
 * Pre-defined P&ID Symbol Templates
 * 
 * These are SVG-based symbol templates that match common P&ID standards.
 * Users can load these instantly instead of capturing from the PDF.
 */

const PREDEFINED_SYMBOLS = {
    // ==========================================
    // PUMPS
    // ==========================================
    pump: {
        name: 'Pump (Centrifugal)',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="38" y1="20" x2="58" y2="20" stroke="#000" stroke-width="2"/>
            <polygon points="20,2 38,20 20,38" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 60,
        height: 40
    },

    // ==========================================
    // VALVES
    // ==========================================
    valveGeneral: {
        name: 'Valve (General)',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,0 20,15 0,30" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,0 20,15 40,30" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    gateValve: {
        name: 'Gate Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <polygon points="0,5 20,20 0,35" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,5 20,20 40,35" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="20" y1="0" x2="20" y2="40" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 40
    },
    
    ballValve: {
        name: 'Ball Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,0 20,15 0,30" fill="#000" stroke="#000" stroke-width="2"/>
            <polygon points="40,0 20,15 40,30" fill="#000" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    checkValve: {
        name: 'Check Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,0 20,15 0,30" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,0 20,15 40,30" fill="none" stroke="#000" stroke-width="2"/>
            <circle cx="20" cy="15" r="4" fill="#000"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    globeValve: {
        name: 'Globe Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <polygon points="0,5 20,20 0,35" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,5 20,20 40,35" fill="none" stroke="#000" stroke-width="2"/>
            <circle cx="20" cy="20" r="6" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 40
    },
    
    butterflyValve: {
        name: 'Butterfly Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,0 20,15 0,30" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,0 20,15 40,30" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="10" y1="7" x2="30" y2="23" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    needleValve: {
        name: 'Needle Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,0 20,15 0,30" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,0 20,15 40,30" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="17,12 20,15 23,12 20,5" fill="#000"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    safetyValve: {
        name: 'Safety/Relief Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 45">
            <polygon points="0,15 20,30 0,45" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,15 20,30 40,45" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="20" y1="30" x2="20" y2="5" stroke="#000" stroke-width="2"/>
            <polygon points="15,5 20,0 25,5" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 45
    },
    
    threeWayValve: {
        name: '3-Way Valve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50">
            <polygon points="0,10 20,25 0,40" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="40,10 20,25 40,40" fill="none" stroke="#000" stroke-width="2"/>
            <polygon points="10,50 20,25 30,50" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 50
    },

    // ==========================================
    // EQUIPMENT
    // ==========================================
    motor: {
        name: 'Motor',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
            <text x="20" y="26" text-anchor="middle" font-size="16" font-weight="bold" fill="#000">M</text>
        </svg>`,
        width: 40,
        height: 40
    },
    
    heatExchanger: {
        name: 'Heat Exchanger',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
            <circle cx="40" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 60,
        height: 40
    },
    
    strainer: {
        name: 'Strainer',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <polygon points="0,10 20,30 40,10" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="5" y1="15" x2="35" y2="15" stroke="#000" stroke-width="1"/>
            <line x1="8" y1="20" x2="32" y2="20" stroke="#000" stroke-width="1"/>
        </svg>`,
        width: 40,
        height: 40
    },

    // ==========================================
    // INSTRUMENTS
    // ==========================================
    gauge: {
        name: 'Gauge/Indicator',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="20" y1="20" x2="30" y2="10" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 40
    },
    
    flowElement: {
        name: 'Flow Element',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 30">
            <rect x="5" y="5" width="40" height="20" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="0" y1="15" x2="5" y2="15" stroke="#000" stroke-width="2"/>
            <line x1="45" y1="15" x2="50" y2="15" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 50,
        height: 30
    },
    
    fieldInstrument: {
        name: 'Field Instrument',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="5" y1="20" x2="35" y2="20" stroke="#000" stroke-width="1"/>
        </svg>`,
        width: 40,
        height: 40
    },

    // ==========================================
    // ACTUATORS
    // ==========================================
    manualActuator: {
        name: 'Manual Actuator',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30">
            <line x1="10" y1="0" x2="10" y2="15" stroke="#000" stroke-width="2"/>
            <line x1="0" y1="15" x2="20" y2="15" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 20,
        height: 30
    },
    
    pneumaticActuator: {
        name: 'Pneumatic Actuator',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
            <polygon points="0,30 15,0 30,30" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 30,
        height: 30
    },
    
    solenoidActuator: {
        name: 'Solenoid Actuator',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
            <rect x="5" y="0" width="20" height="25" fill="none" stroke="#000" stroke-width="2"/>
            <line x1="15" y1="25" x2="15" y2="30" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 30,
        height: 30
    },

    // ==========================================
    // MISC
    // ==========================================
    reducer: {
        name: 'Reducer/Enlarger',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">
            <polygon points="0,5 40,0 40,30 0,25" fill="none" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 40,
        height: 30
    },
    
    blindFlange: {
        name: 'Blind/End',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30">
            <line x1="10" y1="0" x2="10" y2="30" stroke="#000" stroke-width="3"/>
            <line x1="0" y1="0" x2="0" y2="30" stroke="#000" stroke-width="2"/>
        </svg>`,
        width: 20,
        height: 30
    }
};

/**
 * Convert SVG string to an Image for template matching
 * @param {string} svgString - SVG markup
 * @param {number} width - Desired width
 * @param {number} height - Desired height
 * @param {number} scale - Scale factor for higher resolution
 * @returns {Promise<HTMLImageElement>}
 */
function svgToImage(svgString, width, height, scale = 2) {
    return new Promise((resolve, reject) => {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            
            // Draw to canvas at desired size
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Create new image from canvas
            const finalImg = new Image();
            finalImg.onload = () => resolve(finalImg);
            finalImg.onerror = reject;
            finalImg.src = canvas.toDataURL();
        };
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * Load a predefined symbol as a template
 * @param {string} symbolKey - Key from PREDEFINED_SYMBOLS
 * @param {string} targetKey - Key in SYMBOL_TEMPLATES to load into
 * @param {number[]} scales - Array of scale factors for multi-scale matching
 */
async function loadPredefinedSymbol(symbolKey, targetKey = null, scales = [1.0, 1.5, 2.0]) {
    const predefined = PREDEFINED_SYMBOLS[symbolKey];
    if (!predefined) {
        console.error(`Unknown predefined symbol: ${symbolKey}`);
        return false;
    }
    
    // Use same key if not specified
    if (!targetKey) targetKey = symbolKey;
    
    // Ensure SYMBOL_TEMPLATES has this key
    if (!SYMBOL_TEMPLATES[targetKey]) {
        SYMBOL_TEMPLATES[targetKey] = {
            name: predefined.name,
            category: 'Custom',
            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
            templates: [],
            threshold: 0.68
        };
    }
    
    console.log(`Loading predefined symbol: ${predefined.name}`);
    
    // Load at multiple scales for better matching
    for (const scale of scales) {
        try {
            const img = await svgToImage(predefined.svg, predefined.width, predefined.height, scale);
            await window.SymbolDetector.loadTemplate(targetKey, img, 1.0);
            console.log(`  ✓ Loaded at scale ${scale}`);
        } catch (err) {
            console.error(`  ✗ Failed at scale ${scale}:`, err);
        }
    }
    
    return true;
}

/**
 * Load multiple predefined symbols at once
 * @param {string[]} symbolKeys - Array of symbol keys to load
 */
async function loadPredefinedSymbols(symbolKeys) {
    const results = { loaded: [], failed: [] };
    
    for (const key of symbolKeys) {
        try {
            await loadPredefinedSymbol(key);
            results.loaded.push(key);
        } catch (err) {
            results.failed.push(key);
        }
    }
    
    return results;
}

/**
 * Load all valve symbols (quick preset)
 */
async function loadAllValves() {
    return loadPredefinedSymbols([
        'valveGeneral', 'gateValve', 'ballValve', 'checkValve', 
        'globeValve', 'butterflyValve', 'needleValve', 'safetyValve', 'threeWayValve'
    ]);
}

/**
 * Load common equipment symbols (quick preset)
 */
async function loadCommonEquipment() {
    return loadPredefinedSymbols([
        'pump', 'motor', 'heatExchanger', 'strainer'
    ]);
}

/**
 * Get list of available predefined symbols
 */
function getAvailablePredefinedSymbols() {
    return Object.entries(PREDEFINED_SYMBOLS).map(([key, val]) => ({
        key,
        name: val.name,
        width: val.width,
        height: val.height
    }));
}

// ============================================
// CUSTOM IMAGE UPLOAD
// ============================================

/**
 * Load a symbol template from an uploaded image file
 * @param {File} file - Image file (PNG, JPG, etc.)
 * @param {string} symbolKey - Key to store under (e.g., 'pump', 'valve')
 * @param {string} symbolName - Display name for the symbol
 */
async function loadSymbolFromImage(file, symbolKey, symbolName = null) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
                try {
                    // Ensure template key exists
                    if (!window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey]) {
                        window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey] = {
                            name: symbolName || symbolKey,
                            category: 'Custom',
                            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
                            templates: [],
                            threshold: 0.65
                        };
                    }
                    
                    // Load at multiple scales
                    const scales = [0.75, 1.0, 1.25, 1.5];
                    for (const scale of scales) {
                        await window.SymbolDetector.loadTemplate(symbolKey, img, scale);
                    }
                    
                    console.log(`✓ Loaded image template for ${symbolKey} at ${scales.length} scales`);
                    resolve(true);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Load multiple symbol images from files
 * @param {FileList} files - List of image files
 * @param {Function} nameExtractor - Optional function to extract symbol name from filename
 */
async function loadSymbolsFromImages(files, nameExtractor = null) {
    const results = { loaded: [], failed: [] };
    
    for (const file of files) {
        // Extract name from filename (remove extension)
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const symbolKey = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const symbolName = nameExtractor ? nameExtractor(file.name) : baseName;
        
        try {
            await loadSymbolFromImage(file, symbolKey, symbolName);
            results.loaded.push({ key: symbolKey, name: symbolName });
        } catch (err) {
            console.error(`Failed to load ${file.name}:`, err);
            results.failed.push({ name: file.name, error: err.message });
        }
    }
    
    return results;
}

/**
 * Show the image upload dialog
 */
function showImageUploadDialog() {
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'upload-symbols-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 20000;
    `;
    
    modal.innerHTML = `
        <div class="upload-dialog">
            <div class="upload-header">
                <h3>📤 Upload Symbol Images</h3>
                <button class="btn-close" onclick="closeUploadDialog()">✕</button>
            </div>
            
            <div class="upload-content">
                <div class="upload-info">
                    <p><strong>How to prepare symbol images:</strong></p>
                    <ol>
                        <li>Open your P&ID legend image (like the one you shared)</li>
                        <li>Crop each symbol individually (just the symbol, no text)</li>
                        <li>Save as PNG files with descriptive names like:<br>
                            <code>pump.png</code>, <code>gate-valve.png</code>, <code>check-valve.png</code></li>
                        <li>Upload them here</li>
                    </ol>
                </div>
                
                <div class="upload-zone" id="upload-zone">
                    <div class="upload-icon">📁</div>
                    <p>Drop symbol images here<br>or click to browse</p>
                    <input type="file" id="symbol-file-input" multiple accept="image/*" 
                           onchange="handleSymbolFileSelect(this.files)" style="display:none">
                </div>
                
                <div class="upload-preview" id="upload-preview">
                    <!-- Preview of uploaded symbols will appear here -->
                </div>
            </div>
            
            <div class="upload-footer">
                <button class="btn btn-secondary" onclick="closeUploadDialog()">Cancel</button>
                <button class="btn btn-primary" id="upload-confirm-btn" onclick="confirmSymbolUpload()" disabled>
                    Upload Selected
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Setup click handler for upload zone
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.onclick = () => document.getElementById('symbol-file-input').click();
    
    // Setup drag and drop
    uploadZone.ondragover = (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    };
    uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
    uploadZone.ondrop = (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleSymbolFileSelect(e.dataTransfer.files);
    };
    
    // Add styles
    if (!document.getElementById('upload-styles')) {
        const styles = document.createElement('style');
        styles.id = 'upload-styles';
        styles.textContent = `
            .upload-dialog {
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 550px;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0,0,0,0.4);
            }
            .upload-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid #e5e7eb;
            }
            .upload-header h3 { margin: 0; }
            .upload-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }
            .upload-info {
                background: #f0f9ff;
                border: 1px solid #bae6fd;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 20px;
                font-size: 13px;
            }
            .upload-info p { margin: 0 0 10px; }
            .upload-info ol { margin: 0; padding-left: 20px; }
            .upload-info li { margin: 5px 0; }
            .upload-info code {
                background: #e0f2fe;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
            }
            .upload-zone {
                border: 2px dashed #d1d5db;
                border-radius: 12px;
                padding: 40px;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .upload-zone:hover, .upload-zone.dragover {
                border-color: #3b82f6;
                background: #eff6ff;
            }
            .upload-icon { font-size: 48px; margin-bottom: 10px; }
            .upload-zone p { margin: 0; color: #6b7280; }
            .upload-preview {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                gap: 10px;
                margin-top: 20px;
            }
            .preview-item {
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                padding: 8px;
                text-align: center;
                position: relative;
            }
            .preview-item img {
                max-width: 100%;
                max-height: 60px;
                object-fit: contain;
            }
            .preview-item .name {
                font-size: 11px;
                color: #374151;
                margin-top: 5px;
                word-break: break-all;
            }
            .preview-item .remove {
                position: absolute;
                top: 2px;
                right: 2px;
                background: #ef4444;
                color: white;
                border: none;
                border-radius: 50%;
                width: 18px;
                height: 18px;
                font-size: 12px;
                cursor: pointer;
                line-height: 1;
            }
            .upload-footer {
                padding: 15px 20px;
                border-top: 1px solid #e5e7eb;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
        `;
        document.head.appendChild(styles);
    }
}

// Store pending files for upload
let pendingSymbolFiles = [];

/**
 * Handle file selection
 */
function handleSymbolFileSelect(files) {
    const preview = document.getElementById('upload-preview');
    const confirmBtn = document.getElementById('upload-confirm-btn');
    
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        
        pendingSymbolFiles.push(file);
        
        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.dataset.fileName = file.name;
            item.innerHTML = `
                <button class="remove" onclick="removePreviewItem(this)">×</button>
                <img src="${e.target.result}" alt="${file.name}">
                <div class="name">${file.name}</div>
            `;
            preview.appendChild(item);
        };
        reader.readAsDataURL(file);
    }
    
    if (pendingSymbolFiles.length > 0) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `Upload ${pendingSymbolFiles.length} Symbol(s)`;
    }
}

/**
 * Remove a preview item
 */
function removePreviewItem(btn) {
    const item = btn.closest('.preview-item');
    const fileName = item.dataset.fileName;
    pendingSymbolFiles = pendingSymbolFiles.filter(f => f.name !== fileName);
    item.remove();
    
    const confirmBtn = document.getElementById('upload-confirm-btn');
    if (pendingSymbolFiles.length === 0) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Upload Selected';
    } else {
        confirmBtn.textContent = `Upload ${pendingSymbolFiles.length} Symbol(s)`;
    }
}

/**
 * Confirm and process the upload
 */
async function confirmSymbolUpload() {
    const confirmBtn = document.getElementById('upload-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ Processing...';
    
    try {
        const result = await loadSymbolsFromImages(pendingSymbolFiles);
        
        if (result.loaded.length > 0) {
            if (window.showToast) {
                window.showToast(`✓ Loaded ${result.loaded.length} symbol(s)!`, 'success');
            }
            if (window.updateTemplateStatus) {
                window.updateTemplateStatus();
            }
        }
        
        if (result.failed.length > 0) {
            console.warn('Failed to load some symbols:', result.failed);
        }
        
        closeUploadDialog();
    } catch (err) {
        console.error('Upload error:', err);
        confirmBtn.disabled = false;
        confirmBtn.textContent = `Upload ${pendingSymbolFiles.length} Symbol(s)`;
    }
}

/**
 * Close the upload dialog
 */
function closeUploadDialog() {
    pendingSymbolFiles = [];
    const modal = document.getElementById('upload-symbols-modal');
    if (modal) modal.remove();
}

// Export to window
window.PredefinedSymbols = {
    PREDEFINED_SYMBOLS,
    svgToImage,
    loadPredefinedSymbol,
    loadPredefinedSymbols,
    loadAllValves,
    loadCommonEquipment,
    getAvailablePredefinedSymbols,
    // New image upload functions
    loadSymbolFromImage,
    loadSymbolsFromImages,
    showImageUploadDialog
};
