/**
 * P&ID Symbol Detector using OpenCV.js Template Matching
 * 
 * This module provides symbol detection capabilities for P&ID diagrams
 * by matching template images against rendered PDF pages.
 */

// Symbol templates configuration
// Each symbol has a name, category, and will store template image data
const SYMBOL_TEMPLATES = {
    // Equipment
    pump: {
        name: 'Pump',
        category: 'Equipment',
        color: '#FF6B6B',
        templates: [], // Will hold multiple template variations
        threshold: 0.75
    },
    motor: {
        name: 'Motor',
        category: 'Equipment', 
        color: '#4ECDC4',
        templates: [],
        threshold: 0.80
    },
    gearBox: {
        name: 'Gear Box',
        category: 'Equipment',
        color: '#45B7D1',
        templates: [],
        threshold: 0.75
    },
    heatExchanger: {
        name: 'Heat Exchanger',
        category: 'Equipment',
        color: '#96CEB4',
        templates: [],
        threshold: 0.75
    },
    
    // Valves - General
    valveGeneral: {
        name: 'Valve (General)',
        category: 'Valves',
        color: '#DDA0DD',
        templates: [],
        threshold: 0.70
    },
    gateValve: {
        name: 'Gate Valve',
        category: 'Valves',
        color: '#9370DB',
        templates: [],
        threshold: 0.72
    },
    ballValve: {
        name: 'Ball Valve',
        category: 'Valves',
        color: '#BA55D3',
        templates: [],
        threshold: 0.72
    },
    checkValve: {
        name: 'Check Valve',
        category: 'Valves',
        color: '#DA70D6',
        templates: [],
        threshold: 0.70
    },
    butterflyValve: {
        name: 'Butterfly Valve',
        category: 'Valves',
        color: '#EE82EE',
        templates: [],
        threshold: 0.72
    },
    safetyValve: {
        name: 'Safety Valve',
        category: 'Valves',
        color: '#FF69B4',
        templates: [],
        threshold: 0.70
    },
    
    // Instruments
    gauge: {
        name: 'Gauge',
        category: 'Instruments',
        color: '#FFD93D',
        templates: [],
        threshold: 0.75
    },
    flowElement: {
        name: 'Flow Element',
        category: 'Instruments',
        color: '#6BCB77',
        templates: [],
        threshold: 0.75
    },
    
    // Actuators
    manualActuator: {
        name: 'Manual Actuator',
        category: 'Actuators',
        color: '#4D96FF',
        templates: [],
        threshold: 0.75
    },
    pneumaticActuator: {
        name: 'Pneumatic Actuator',
        category: 'Actuators',
        color: '#6495ED',
        templates: [],
        threshold: 0.72
    }
};

// Detection state
let opencvReady = false;
let detectedSymbols = [];
let symbolDetectionEnabled = false;

// OpenCV.js loading
function loadOpenCV() {
    return new Promise((resolve, reject) => {
        if (typeof cv !== 'undefined' && cv.Mat) {
            opencvReady = true;
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
        script.async = true;
        
        script.onload = () => {
            // OpenCV.js needs time to initialize
            const checkReady = setInterval(() => {
                if (typeof cv !== 'undefined' && cv.Mat) {
                    clearInterval(checkReady);
                    opencvReady = true;
                    console.log('OpenCV.js loaded successfully');
                    resolve();
                }
            }, 100);
            
            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkReady);
                if (!opencvReady) {
                    reject(new Error('OpenCV.js initialization timeout'));
                }
            }, 30000);
        };
        
        script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
        document.head.appendChild(script);
    });
}

/**
 * Load a template image from a file or URL
 * @param {string} symbolKey - Key from SYMBOL_TEMPLATES
 * @param {HTMLImageElement|string} imageSource - Image element or URL
 * @param {number} [scaleVariation] - Optional scale factor for multi-scale matching
 */
async function loadTemplate(symbolKey, imageSource, scaleVariation = 1.0) {
    if (!opencvReady) {
        await loadOpenCV();
    }
    
    let img;
    if (typeof imageSource === 'string') {
        img = await loadImageFromUrl(imageSource);
    } else {
        img = imageSource;
    }
    
    // Create canvas to get image data
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scaleVariation;
    canvas.height = img.height * scaleVariation;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Convert to OpenCV Mat
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mat = cv.matFromImageData(imgData);
    
    // Convert to grayscale for matching
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    
    // Store template
    if (SYMBOL_TEMPLATES[symbolKey]) {
        SYMBOL_TEMPLATES[symbolKey].templates.push({
            mat: gray,
            scale: scaleVariation,
            width: canvas.width,
            height: canvas.height
        });
    }
    
    mat.delete();
    return gray;
}

/**
 * Load image from URL
 */
function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * Extract template from a canvas region (for user-defined templates)
 * @param {HTMLCanvasElement} sourceCanvas - Source canvas (rendered PDF page)
 * @param {Object} rect - {x, y, width, height} of the region to extract
 * @param {string} symbolKey - Key to store the template under
 * @param {string} symbolName - Display name for the symbol (optional)
 */
async function extractTemplateFromCanvas(sourceCanvas, rect, symbolKey, symbolName) {
    if (!opencvReady) {
        await loadOpenCV();
    }
    
    const ctx = sourceCanvas.getContext('2d');
    const imgData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    
    const mat = cv.matFromImageData(imgData);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    
    // Create template entry if it doesn't exist
    if (!SYMBOL_TEMPLATES[symbolKey]) {
        SYMBOL_TEMPLATES[symbolKey] = {
            name: symbolName || currentSymbolName || symbolKey,
            category: 'Custom',
            color: '#9370DB',
            templates: [],
            threshold: 0.70
        };
    }
    
    SYMBOL_TEMPLATES[symbolKey].templates.push({
        mat: gray,
        scale: 1.0,
        width: rect.width,
        height: rect.height
    });
    
    // Update UI if available
    if (typeof window.updateTemplateStatus === 'function') {
        window.updateTemplateStatus();
    }
    
    mat.delete();
    return gray;
}

/**
 * Detect symbols in a rendered PDF page canvas
 * @param {HTMLCanvasElement} pageCanvas - The rendered PDF page
 * @param {number} pageNumber - Page number for tracking
 * @param {string[]} symbolsToDetect - Array of symbol keys to look for (or null for all)
 * @returns {Array} Array of detected symbol locations
 */
async function detectSymbolsInPage(pageCanvas, pageNumber, symbolsToDetect = null) {
    if (!opencvReady) {
        await loadOpenCV();
    }
    
    const detections = [];
    const ctx = pageCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, pageCanvas.width, pageCanvas.height);
    
    // Convert page to OpenCV Mat
    const pageMat = cv.matFromImageData(imgData);
    const pageGray = new cv.Mat();
    cv.cvtColor(pageMat, pageGray, cv.COLOR_RGBA2GRAY);
    
    // Which symbols to detect
    const symbolKeys = symbolsToDetect || Object.keys(SYMBOL_TEMPLATES);
    
    for (const key of symbolKeys) {
        const symbolConfig = SYMBOL_TEMPLATES[key];
        if (!symbolConfig || symbolConfig.templates.length === 0) continue;
        
        for (const template of symbolConfig.templates) {
            const matches = templateMatch(pageGray, template.mat, symbolConfig.threshold);
            
            for (const match of matches) {
                detections.push({
                    symbolKey: key,
                    symbolName: symbolConfig.name,
                    category: symbolConfig.category,
                    color: symbolConfig.color,
                    page: pageNumber,
                    x: match.x,
                    y: match.y,
                    width: template.width,
                    height: template.height,
                    confidence: match.confidence,
                    scale: template.scale
                });
            }
        }
    }
    
    // Clean up
    pageMat.delete();
    pageGray.delete();
    
    // Remove overlapping detections (non-maximum suppression)
    return nonMaxSuppression(detections);
}

/**
 * Perform template matching
 * @param {cv.Mat} source - Source image (grayscale)
 * @param {cv.Mat} template - Template image (grayscale)
 * @param {number} threshold - Match threshold (0-1)
 * @returns {Array} Array of match locations
 */
function templateMatch(source, template, threshold) {
    const matches = [];
    
    // Check if template is smaller than source
    if (template.cols > source.cols || template.rows > source.rows) {
        return matches;
    }
    
    const result = new cv.Mat();
    const mask = new cv.Mat();
    
    try {
        // Use TM_CCOEFF_NORMED for normalized correlation
        cv.matchTemplate(source, template, result, cv.TM_CCOEFF_NORMED, mask);
        
        // Find all locations above threshold
        const resultData = result.data32F;
        const cols = result.cols;
        const rows = result.rows;
        
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const confidence = resultData[y * cols + x];
                if (confidence >= threshold) {
                    matches.push({
                        x: x,
                        y: y,
                        confidence: confidence
                    });
                }
            }
        }
    } catch (e) {
        console.error('Template matching error:', e);
    } finally {
        result.delete();
        mask.delete();
    }
    
    return matches;
}

/**
 * Non-maximum suppression to remove overlapping detections
 * @param {Array} detections - Array of detection objects
 * @param {number} overlapThreshold - IoU threshold for considering overlap
 * @returns {Array} Filtered detections
 */
function nonMaxSuppression(detections, overlapThreshold = 0.3) {
    if (detections.length === 0) return [];
    
    // Sort by confidence descending
    detections.sort((a, b) => b.confidence - a.confidence);
    
    const kept = [];
    const suppressed = new Set();
    
    for (let i = 0; i < detections.length; i++) {
        if (suppressed.has(i)) continue;
        
        kept.push(detections[i]);
        
        for (let j = i + 1; j < detections.length; j++) {
            if (suppressed.has(j)) continue;
            
            const iou = calculateIoU(detections[i], detections[j]);
            if (iou > overlapThreshold) {
                suppressed.add(j);
            }
        }
    }
    
    return kept;
}

/**
 * Calculate Intersection over Union
 */
function calculateIoU(box1, box2) {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
    
    if (x2 < x1 || y2 < y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;
    
    return intersection / union;
}

/**
 * Draw detection boxes on a canvas overlay
 * @param {HTMLCanvasElement} overlayCanvas - Canvas to draw on
 * @param {Array} detections - Detections for this page
 */
function drawDetectionBoxes(overlayCanvas, detections) {
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    for (const det of detections) {
        // Draw box
        ctx.strokeStyle = det.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(det.x, det.y, det.width, det.height);
        
        // Draw label background
        ctx.fillStyle = det.color;
        const label = `${det.symbolName} (${Math.round(det.confidence * 100)}%)`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(det.x, det.y - 18, textWidth + 8, 18);
        
        // Draw label text
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(label, det.x + 4, det.y - 5);
    }
}

/**
 * Create detection overlays for all PDF pages
 * @param {HTMLElement} pdfWrapper - Container with page canvases
 */
async function detectSymbolsInAllPages(pdfWrapper) {
    if (!opencvReady) {
        await loadOpenCV();
    }
    
    detectedSymbols = [];
    const pdfPages = pdfWrapper.querySelectorAll('.pdf-page');
    
    for (let i = 0; i < pdfPages.length; i++) {
        const pageDiv = pdfPages[i];
        const pageCanvas = pageDiv.querySelector('canvas:not(.symbol-overlay)');
        if (!pageCanvas) {
            console.warn(`No canvas found for page ${i + 1}`);
            continue;
        }
        
        const pageNumber = i + 1;
        console.log(`Detecting symbols on page ${pageNumber}...`);
        
        // Detect symbols
        const pageDetections = await detectSymbolsInPage(pageCanvas, pageNumber);
        detectedSymbols.push(...pageDetections);
        
        // Create or get overlay canvas
        let overlay = pageDiv.querySelector('.symbol-overlay');
        if (!overlay) {
            overlay = document.createElement('canvas');
            overlay.className = 'symbol-overlay';
            overlay.width = pageCanvas.width;
            overlay.height = pageCanvas.height;
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                pointer-events: none;
                width: 100%;
                height: 100%;
            `;
            pageDiv.style.position = 'relative';
            pageDiv.appendChild(overlay);
        }
        
        // Draw detection boxes
        const pageSymbols = pageDetections.filter(d => d.page === pageNumber);
        drawDetectionBoxes(overlay, pageSymbols);
    }
    
    console.log(`Total symbols detected: ${detectedSymbols.length}`);
    return detectedSymbols;
}

/**
 * Generate a summary of detected symbols
 */
function getSymbolSummary() {
    const summary = {};
    
    for (const det of detectedSymbols) {
        if (!summary[det.category]) {
            summary[det.category] = {};
        }
        if (!summary[det.category][det.symbolName]) {
            summary[det.category][det.symbolName] = [];
        }
        summary[det.category][det.symbolName].push({
            page: det.page,
            confidence: det.confidence
        });
    }
    
    return summary;
}

/**
 * Export detected symbols to CSV
 */
function exportSymbolsToCSV() {
    if (detectedSymbols.length === 0) {
        alert('No symbols detected. Please run symbol detection first.');
        return;
    }
    
    let csv = 'Symbol,Category,Page,X,Y,Width,Height,Confidence\n';
    
    for (const det of detectedSymbols) {
        csv += `"${det.symbolName}","${det.category}",${det.page},${det.x},${det.y},${det.width},${det.height},${det.confidence.toFixed(3)}\n`;
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pid_symbols.csv';
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Toggle symbol detection overlays visibility
 */
function toggleSymbolOverlays(visible) {
    const overlays = document.querySelectorAll('.symbol-overlay');
    overlays.forEach(overlay => {
        overlay.style.display = visible ? 'block' : 'none';
    });
    symbolDetectionEnabled = visible;
}

/**
 * Clear all templates and detections
 */
function clearSymbolDetection() {
    detectedSymbols = [];
    
    // Remove overlays
    document.querySelectorAll('.symbol-overlay').forEach(el => el.remove());
    
    // Clear templates (keep configurations)
    for (const key of Object.keys(SYMBOL_TEMPLATES)) {
        SYMBOL_TEMPLATES[key].templates.forEach(t => {
            if (t.mat) t.mat.delete();
        });
        SYMBOL_TEMPLATES[key].templates = [];
    }
}

// ============================================
// TEMPLATE CAPTURE UI
// ============================================

let captureMode = false;
let captureStart = null;
let captureCanvas = null;
let captureOverlay = null;
let currentSymbolKey = null;
let currentSymbolName = null;

/**
 * Enable template capture mode
 * User can draw a rectangle on the PDF to capture a symbol template
 * @param {string} symbolKey - The key for storing the template
 * @param {string} displayName - Optional display name for the symbol
 */
function enableTemplateCaptureMode(symbolKey, displayName) {
    captureMode = true;
    currentSymbolKey = symbolKey;
    currentSymbolName = displayName || SYMBOL_TEMPLATES[symbolKey]?.name || symbolKey;
    
    // Create capture overlay if needed
    if (!captureOverlay) {
        captureOverlay = document.createElement('div');
        captureOverlay.id = 'capture-overlay';
        captureOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.3);
            cursor: crosshair;
            z-index: 10000;
        `;
        
        document.body.appendChild(captureOverlay);
        
        // Event listeners
        captureOverlay.addEventListener('mousedown', startCapture);
        captureOverlay.addEventListener('mousemove', updateCapture);
        captureOverlay.addEventListener('mouseup', endCapture);
        document.addEventListener('keydown', cancelCapture);
    }
    
    // Update or create instructions
    let instructions = captureOverlay.querySelector('.capture-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.className = 'capture-instructions';
        instructions.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 28px;
            border-radius: 10px;
            font-size: 15px;
            z-index: 10001;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            text-align: center;
            max-width: 400px;
        `;
        captureOverlay.appendChild(instructions);
    }
    
    instructions.innerHTML = `
        <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">
            🎯 Capture "${currentSymbolName}"
        </div>
        <div style="font-size: 13px; opacity: 0.95; line-height: 1.5;">
            Click and drag a box around the symbol in your PDF
        </div>
        <div style="font-size: 11px; opacity: 0.8; margin-top: 8px;">
            Press ESC to cancel
        </div>
    `;
    
    // Selection rectangle
    let selRect = document.getElementById('capture-selection');
    if (!selRect) {
        selRect = document.createElement('div');
        selRect.id = 'capture-selection';
        selRect.style.cssText = `
            position: fixed;
            border: 3px solid #00ff88;
            background: rgba(0, 255, 136, 0.15);
            display: none;
            pointer-events: none;
            z-index: 10001;
            box-shadow: 0 0 20px rgba(0, 255, 136, 0.6), inset 0 0 20px rgba(0, 255, 136, 0.2);
        `;
        captureOverlay.appendChild(selRect);
    }
    
    captureOverlay.style.display = 'block';
}

function startCapture(e) {
    captureStart = { x: e.clientX, y: e.clientY };
    const selRect = document.getElementById('capture-selection');
    selRect.style.left = e.clientX + 'px';
    selRect.style.top = e.clientY + 'px';
    selRect.style.width = '0px';
    selRect.style.height = '0px';
    selRect.style.display = 'block';
}

function updateCapture(e) {
    if (!captureStart) return;
    
    const selRect = document.getElementById('capture-selection');
    const width = e.clientX - captureStart.x;
    const height = e.clientY - captureStart.y;
    
    selRect.style.left = (width < 0 ? e.clientX : captureStart.x) + 'px';
    selRect.style.top = (height < 0 ? e.clientY : captureStart.y) + 'px';
    selRect.style.width = Math.abs(width) + 'px';
    selRect.style.height = Math.abs(height) + 'px';
}

async function endCapture(e) {
    if (!captureStart) return;
    
    const rect = {
        x: Math.min(captureStart.x, e.clientX),
        y: Math.min(captureStart.y, e.clientY),
        width: Math.abs(e.clientX - captureStart.x),
        height: Math.abs(e.clientY - captureStart.y)
    };
    
    // Hide selection rectangle
    const selRect = document.getElementById('capture-selection');
    if (selRect) selRect.style.display = 'none';
    
    if (rect.width < 10 || rect.height < 10) {
        console.log('Selection too small, cancelled');
        captureStart = null;
        disableTemplateCaptureMode();
        return;
    }
    
    console.log('Capture rect:', rect);
    
    // Find which page canvas this is on - look for .pdf-page > canvas
    const pdfPages = document.querySelectorAll('.pdf-page');
    let captured = false;
    
    for (const pageDiv of pdfPages) {
        const canvas = pageDiv.querySelector('canvas');
        if (!canvas) continue;
        
        const canvasRect = canvas.getBoundingClientRect();
        console.log('Checking canvas:', canvasRect);
        
        // Check if selection center is within this canvas
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        
        if (centerX >= canvasRect.left && centerX <= canvasRect.right &&
            centerY >= canvasRect.top && centerY <= canvasRect.bottom) {
            
            console.log('Found matching canvas!');
            
            // Convert to canvas coordinates accounting for zoom
            const scaleX = canvas.width / canvasRect.width;
            const scaleY = canvas.height / canvasRect.height;
            
            const canvasCoords = {
                x: Math.max(0, Math.min(canvas.width - 1, (rect.x - canvasRect.left) * scaleX)),
                y: Math.max(0, Math.min(canvas.height - 1, (rect.y - canvasRect.top) * scaleY)),
                width: Math.min(canvas.width, rect.width * scaleX),
                height: Math.min(canvas.height, rect.height * scaleY)
            };
            
            console.log('Canvas coords:', canvasCoords);
            
            // Extract template
            try {
                await extractTemplateFromCanvas(canvas, canvasCoords, currentSymbolKey, currentSymbolName);
                console.log(`✓ Template captured for ${currentSymbolKey}`);
                
                // Show success feedback with toast (if available)
                if (typeof window.showToast === 'function') {
                    window.showToast(`✓ Captured "${currentSymbolName || currentSymbolKey}" template`, 'success');
                } else {
                    // Fallback visual feedback
                    showCaptureSuccess();
                }
                captured = true;
            } catch (err) {
                console.error('Failed to extract template:', err);
                if (typeof window.showToast === 'function') {
                    window.showToast('Failed to capture template', 'error');
                }
            }
            
            break;
        }
    }
    
    if (!captured) {
        console.log('No canvas found at selection location');
        if (typeof window.showToast === 'function') {
            window.showToast('Draw over the PDF page', 'warning');
        }
    }
    
    // Reset
    captureStart = null;
    disableTemplateCaptureMode();
}

function showCaptureSuccess() {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(16, 185, 129, 0.95);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        z-index: 20000;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        animation: popIn 0.3s ease;
    `;
    flash.textContent = '✓ Template Captured!';
    document.body.appendChild(flash);
    
    setTimeout(() => {
        flash.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => flash.remove(), 300);
    }, 1500);
}

function cancelCapture(e) {
    if (e.key === 'Escape') {
        disableTemplateCaptureMode();
    }
}

function disableTemplateCaptureMode() {
    captureMode = false;
    captureStart = null;
    currentSymbolKey = null;
    
    if (captureOverlay) {
        captureOverlay.style.display = 'none';
    }
    
    document.removeEventListener('keydown', cancelCapture);
}

// ============================================
// MULTI-SCALE DETECTION
// ============================================

/**
 * Detect symbols at multiple scales for robustness
 * @param {HTMLCanvasElement} pageCanvas 
 * @param {number} pageNumber 
 * @param {number[]} scales - Array of scale factors to try
 */
async function detectSymbolsMultiScale(pageCanvas, pageNumber, scales = [0.8, 1.0, 1.2]) {
    const allDetections = [];
    
    for (const scale of scales) {
        // Create scaled version of page
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = pageCanvas.width * scale;
        scaledCanvas.height = pageCanvas.height * scale;
        const ctx = scaledCanvas.getContext('2d');
        ctx.drawImage(pageCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        
        // Detect on scaled version
        const detections = await detectSymbolsInPage(scaledCanvas, pageNumber);
        
        // Scale coordinates back to original
        for (const det of detections) {
            det.x = det.x / scale;
            det.y = det.y / scale;
            det.width = det.width / scale;
            det.height = det.height / scale;
            det.detectionScale = scale;
        }
        
        allDetections.push(...detections);
    }
    
    // Apply NMS across all scales
    return nonMaxSuppression(allDetections);
}

// ============================================
// EXPORTS
// ============================================

// Make functions available globally
window.SymbolDetector = {
    loadOpenCV,
    loadTemplate,
    extractTemplateFromCanvas,
    detectSymbolsInPage,
    detectSymbolsInAllPages,
    detectSymbolsMultiScale,
    drawDetectionBoxes,
    getSymbolSummary,
    exportSymbolsToCSV,
    toggleSymbolOverlays,
    clearSymbolDetection,
    enableTemplateCaptureMode,
    disableTemplateCaptureMode,
    SYMBOL_TEMPLATES,
    get detectedSymbols() { return detectedSymbols; },
    get isReady() { return opencvReady; }
};
