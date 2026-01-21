// --- CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Line tag patterns (original first as the canonical reference)
// Original example: 10-2"-HC-1234-01-A
const LINE_TAG_PATTERN = /\b\d+-\d+"-[A-Z]+-[A-Z0-9]+-(?:\d{4}|XXXX)-[A-Z]+\b/g;

// Alternate line size formats to support fractions/decimals like:
// 35-1.1/2"-RM-A06A1-5532-ET
// 35-3/4"-CI-A04A1-9506-N
// Size token here allows: 2", 3/4", 1.1/2" (digits + optional .digits + optional /digits)
const LINE_TAG_PATTERN_ALT = /\b\d+-\d+(?:\.\d+)?(?:\/\d+)?"-[A-Z]+-[A-Z0-9]+-(?:\d{4}|XXXX)-[A-Z]+\b/g;

// Valve tag patterns (original first as the canonical reference)
// Original example: 35-2"-A2R-9008 OR 35-A2R-9008
const VALVE_TAG_PATTERN = /\b\d+(?:-\d+")?-[A-Z0-9]+-(?:\d{4}|XXXX)\b/g;

// Alternate valve size formats to support fractions/decimals like:
// 35-1.1/2"-A2R-9008
// 35-3/4"-B2R-9055
const VALVE_TAG_PATTERN_ALT = /\b\d+-\d+(?:\.\d+)?(?:\/\d+)?"-[A-Z0-9]+-(?:\d{4}|XXXX)\b/g;
let activeTagPattern = LINE_TAG_PATTERN;

const RENDER_SCALE = 2.0; 
let allFoundTags = []; 
let currentZoom = 1.0;
let currentPdfBytes = null;

// Duplicate handling for sidebar + CSV
// - occurrences: show/count every match
// - unique: combine identical tags across pages
let duplicateMode = 'occurrences';

// DOM Elements
const fileInput = document.getElementById('fileInput');
const pdfWrapper = document.getElementById('pdf-wrapper');
const resultList = document.getElementById('resultList');
const statusBar = document.getElementById('status-bar');
const spinner = document.getElementById('spinner');
const completionIcon = document.getElementById('completion-icon');
const exportBtn = document.getElementById('export-btn');
const printBtn = document.getElementById('print-btn');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const footerList = document.getElementById('footerList');
const stickyFooter = document.getElementById('sticky-footer');
const viewerContainer = document.getElementById('viewer-container');
const zoomContainer = document.getElementById('zoom-container'); // New container
// Optional: some UI variants include a dedicated Search button.
// This project currently auto-runs on file selection, so the button may not exist.
const searchBtn = document.getElementById('search-btn');

// Track current page for footer updates
let currentPageNumber = 1;
let pdfDoc = null; // Store global PDF reference
let pdfContentWidth = 0; // Max width of pages
let pdfContentHeight = 0; // Total height of pages

// Panning Variables
let isPanning = false;
let startX, startY, scrollLeft, scrollTop;

fileInput.addEventListener('change', handleFileUpload);

// Duplicate mode UI binding (Count all vs Combine)
document.querySelectorAll('input[name="dupMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        duplicateMode = document.querySelector('input[name="dupMode"]:checked')?.value || 'occurrences';
        rebuildSidebar();
    });
});

// --- PANNING CONTROLS ---
viewerContainer.addEventListener('mousedown', (e) => {
    // Only pan if left click and not on a highlight box or interactive element
    if (e.button !== 0 || e.target.closest('.highlight-box') || e.target.closest('.btn-floating')) return;
    
    isPanning = true;
    viewerContainer.classList.add('grabbing');
    startX = e.pageX - viewerContainer.offsetLeft;
    startY = e.pageY - viewerContainer.offsetTop;
    scrollLeft = viewerContainer.scrollLeft;
    scrollTop = viewerContainer.scrollTop;
});

viewerContainer.addEventListener('mouseleave', () => {
    isPanning = false;
    viewerContainer.classList.remove('grabbing');
});

viewerContainer.addEventListener('mouseup', () => {
    isPanning = false;
    viewerContainer.classList.remove('grabbing');
});

viewerContainer.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    e.preventDefault();
    const x = e.pageX - viewerContainer.offsetLeft;
    const y = e.pageY - viewerContainer.offsetTop;
    const walkX = (x - startX) * 1.5; // Scroll-fast multiplier
    const walkY = (y - startY) * 1.5;
    viewerContainer.scrollLeft = scrollLeft - walkX;
    viewerContainer.scrollTop = scrollTop - walkY;
});

// --- KEYBOARD & WHEEL CONTROLS ---
document.addEventListener('keydown', (e) => {
    // Zoom with + / -
    if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        updateZoom(0.1);
    } else if ((e.key === '-' || e.key === '_') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        updateZoom(-0.1);
    }
    // Arrow keys for scrolling (if not focused on input)
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        const step = 50;
        if (e.key === 'ArrowUp') viewerContainer.scrollTop -= step;
        if (e.key === 'ArrowDown') viewerContainer.scrollTop += step;
        if (e.key === 'ArrowLeft') viewerContainer.scrollLeft -= step;
        if (e.key === 'ArrowRight') viewerContainer.scrollLeft += step;
    }
});

viewerContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        updateZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }
}, { passive: false });

function updateZoom(delta) {
    let newZoom = parseFloat(currentZoom) + delta;
    newZoom = Math.max(0.2, Math.min(newZoom, 3.0)); // Clamp between 0.2 and 3.0
    
    currentZoom = newZoom.toFixed(1);
    zoomSlider.value = currentZoom;
    applyZoom();
}

function applyZoom() {
    zoomValue.textContent = Math.round(currentZoom * 100) + '%';
    
    // Scale the inner wrapper
    pdfWrapper.style.transform = `scale(${currentZoom})`;
    
    // Resize the outer container to occupy the correct space
    if (pdfContentWidth > 0 && pdfContentHeight > 0) {
        zoomContainer.style.width = `${pdfContentWidth * currentZoom}px`;
        zoomContainer.style.height = `${pdfContentHeight * currentZoom}px`;
    }
}

// Scroll listener to update footer based on visible page
document.getElementById('viewer-container').addEventListener('scroll', debounce(updateFooterForVisiblePage, 200));

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function toggleInfoBox() {
    const infoBox = document.getElementById('info-box');
    const btn = document.getElementById('toggle-info-btn');
    infoBox.classList.toggle('collapsed');
    btn.textContent = infoBox.classList.contains('collapsed') ? 'Show Info' : 'Hide Info';
}

function collapseFooter(e) {
    e.stopPropagation(); 
    document.getElementById('sticky-footer').classList.add('collapsed');
}

function expandFooter() {
    const footer = document.getElementById('sticky-footer');
    if (footer.classList.contains('collapsed')) {
        footer.classList.remove('collapsed');
    }
}

function toggleSidebar() {
    document.body.classList.toggle('sidebar-collapsed');
    // Trigger resize event so PDF viewer can adjust if needed (though we use CSS transform/width)
    // But if we were using canvas width based on container, we might need to re-render.
    // Since we use CSS scaling on a fixed canvas size, it should be fine.
}

zoomSlider.addEventListener('input', (e) => {
    currentZoom = e.target.value;
    applyZoom();
});

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Store PDF name for export feature
    window.currentPDFName = file.name.replace(/\.pdf$/i, '');
    
    // Keep current behavior: auto-run when a file is selected
    await runAudit(file);
}

// Exposed for the Search button (index.html onclick)
async function runSearch() {
    const file = fileInput?.files?.[0];
    if (!file) {
        alert('Please choose a PDF first.');
        return;
    }
    await runAudit(file);
}

async function runAudit(file) {
    // Determine Search Mode (read current radio selection each run)
    const searchMode = document.querySelector('input[name="searchMode"]:checked')?.value || 'line';
    if (searchMode === 'valve') {
        // Valve-only: check original first, then alternate
        activeTagPattern = new RegExp(VALVE_TAG_PATTERN.source + "|" + VALVE_TAG_PATTERN_ALT.source, "g");
    } else if (searchMode === 'both') {
        // Combine patterns:
        // 1) Original line pattern (canonical reference)
        // 2) Alternate line pattern (fractions/decimals)
        // 3) Original valve pattern (canonical reference)
        // 4) Alternate valve pattern (fractions/decimals)
        activeTagPattern = new RegExp(
            LINE_TAG_PATTERN.source + "|" + LINE_TAG_PATTERN_ALT.source + "|" + VALVE_TAG_PATTERN.source + "|" + VALVE_TAG_PATTERN_ALT.source,
            "g"
        );
    } else {
        // Line-only: check original first, then alternate
        activeTagPattern = new RegExp(LINE_TAG_PATTERN.source + "|" + LINE_TAG_PATTERN_ALT.source, "g");
    }

    // Reset UI/state so repeated searches don't require a refresh
    pdfWrapper.innerHTML = '';
    resultList.innerHTML = '';
    footerList.innerHTML = '';
    allFoundTags = [];
    currentPageNumber = 1;
    exportBtn.style.display = 'none';
    printBtn.style.display = 'none';

    // Busy UI
    if (searchBtn) searchBtn.disabled = true;
    fileInput.disabled = true;
    statusBar.textContent = 'Loading P&ID...';
    spinner.style.display = 'block';
    if (completionIcon) completionIcon.style.display = 'none';

    // Set initial zoom to 0.8 (80%) which is usually a good fit for 2.0 render scale
    currentZoom = 0.8;
    zoomSlider.value = currentZoom;
    applyZoom();

    try {
        const fileBuffer = await file.arrayBuffer();
        currentPdfBytes = fileBuffer.slice(0); // Clone for saving
        const loadingTask = pdfjsLib.getDocument(fileBuffer);
        pdfDoc = await loadingTask.promise; // Store globally

        statusBar.textContent = `Scanning ${pdfDoc.numPages} sheets...`;

        let totalMatches = 0;
        pdfContentWidth = 0;
        pdfContentHeight = 0;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const matchesOnPage = await processPage(pdfDoc, i);
            totalMatches += matchesOnPage;
        }

        // Set initial dimensions for the wrapper
        pdfWrapper.style.width = `${pdfContentWidth}px`;
        pdfWrapper.style.height = `${pdfContentHeight}px`;

        // Re-apply zoom to set container size
        applyZoom();

        statusBar.textContent = `Audit Complete. Found ${totalMatches} tags.`;
        updateStatusBarCounts(totalMatches);
        if (totalMatches > 0) {
            exportBtn.style.display = 'flex';
            printBtn.style.display = 'flex';
        }
        if (completionIcon) completionIcon.style.display = 'block';
        
        // Collapse the footer by default after PDF loads
        const footer = document.getElementById('sticky-footer');
        if (footer) {
            footer.classList.add('collapsed');
        }

    } catch (err) {
        console.error(err);
        statusBar.textContent = 'Error: ' + err.message;
    } finally {
        spinner.style.display = 'none';
        fileInput.disabled = false;
        if (searchBtn) searchBtn.disabled = false;
    }
}

async function processPage(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.id = `page-${pageNumber}`;
    
    // Track dimensions
    pdfContentWidth = Math.max(pdfContentWidth, viewport.width);
    pdfContentHeight += viewport.height + 20; // +20 for margin-bottom

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    pageDiv.appendChild(canvas);
    pdfWrapper.appendChild(pageDiv);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    const textContent = await page.getTextContent();

    // --- TITLE EXTRACTION LOGIC (UPDATED) ---
    let sheetTitle = "Unknown Title";

    // Loop through all text items to find the label
    for (let i = 0; i < textContent.items.length; i++) {
        const str = textContent.items[i].str.toUpperCase().replace(/\s/g, ''); // Remove spaces for checking

        // Check for "TP-OTC DRAWING NUMBER" (spaces removed)
        if (str.includes("TPOTCDRAWINGNUMBER")) {

            // The title value is likely in the *next* few text items
            // We look ahead up to 10 items to find a string that looks like a drawing number (length > 5)
            for (let j = i + 1; j < Math.min(i + 10, textContent.items.length); j++) {
                const candidate = textContent.items[j].str.trim();
                // Basic validation: Title should be longer than 5 chars
                if (candidate.length > 5) {
                    sheetTitle = candidate;
                    break; // Found it
                }
            }
            break; // Stop searching for label
        }
    }

    // Fallback: If still unknown, check if any item starts with "SC26-3-NOV" directly
    if (sheetTitle === "Unknown Title") {
        for (const item of textContent.items) {
            if (item.str.trim().startsWith("SC26-3-NOV")) {
                sheetTitle = item.str.trim();
                break;
            }
        }
    }

    // --- TAG EXTRACTION LOGIC ---
    let matchesCount = 0;
    for (const item of textContent.items) {
        const text = item.str;
        activeTagPattern.lastIndex = 0;
        let match;

        while ((match = activeTagPattern.exec(text)) !== null) {
            matchesCount++;
            const matchText = match[0];

            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const angleRad = Math.atan2(tx[1], tx[0]);
            const angleDeg = angleRad * (180 / Math.PI);

            const fontHeight = Math.sqrt(tx[2]*tx[2] + tx[3]*tx[3]); 
            const totalItemWidth = item.width * RENDER_SCALE; 
            const matchRatio = matchText.length / text.length;
            const matchWidth = totalItemWidth * matchRatio;

            let x = tx[4];
            let y = tx[5];

            const highlight = document.createElement('div');
            highlight.className = 'highlight-box';
            highlight.title = matchText;
            highlight.id = `hl-${allFoundTags.length}`;

            highlight.style.left = `${x}px`;
            highlight.style.top = `${y}px`;
            highlight.style.width = `${matchWidth}px`;
            highlight.style.height = `${fontHeight}px`;
            highlight.style.transform = `rotate(${angleDeg}deg) translateY(-100%)`;

            // Add click to copy functionality for highlight boxes
            highlight.addEventListener('click', (e) => {
                e.stopPropagation();
                copyToClipboard(matchText);
            });

            // --- PDF COORDINATE CALCULATION FOR PRINTING ---
            // Calculate PDF coordinates for printing
            const pdfTotalWidth = item.width; 
            const pdfMatchWidth = pdfTotalWidth * matchRatio;
            const pdfOffsetRatio = match.index / text.length;
            const pdfOffsetX = pdfTotalWidth * pdfOffsetRatio;
            
            // Rotation angle from transform (PDF space)
            const pdfAngleRad = Math.atan2(item.transform[1], item.transform[0]);
            const pdfAngleDeg = pdfAngleRad * (180 / Math.PI);
            
            // Calculate offset vector (x, y)
            const offsetX = pdfOffsetX * Math.cos(pdfAngleRad);
            const offsetY = pdfOffsetX * Math.sin(pdfAngleRad);
            
            const pdfX = item.transform[4] + offsetX;
            const pdfY = item.transform[5] + offsetY;
            
            // Height in PDF units
            const pdfHeight = Math.sqrt(item.transform[2]*item.transform[2] + item.transform[3]*item.transform[3]);

            const pdfRect = {
                x: pdfX,
                y: pdfY,
                width: pdfMatchWidth,
                height: pdfHeight,
                rotation: pdfAngleDeg
            };

            pageDiv.appendChild(highlight);
            addSidebarItem(matchText, pageNumber, sheetTitle, highlight, pdfRect);
        }
    }
    
    // Update footer initially for page 1
    if (pageNumber === 1) updateFooterList(1);
    
    return matchesCount;
}

function updateFooterForVisiblePage() {
    if (!pdfDoc) return;
    
    const container = document.getElementById('viewer-container');
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + (containerRect.height / 2);

    // Find which page is currently in the center of the view
    const pages = document.querySelectorAll('.pdf-page');
    let bestPage = 1;
    let minDistance = Infinity;

    pages.forEach(page => {
        const rect = page.getBoundingClientRect();
        const pageCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(containerCenter - pageCenter);
        
        if (distance < minDistance) {
            minDistance = distance;
            bestPage = parseInt(page.id.replace('page-', ''));
        }
    });

    if (bestPage !== currentPageNumber) {
        currentPageNumber = bestPage;
        updateFooterList(currentPageNumber);
    }
}

function updateFooterList(pageNum) {
    footerList.innerHTML = '';
    const pageTags = allFoundTags.filter(t => t.page === pageNum);

    if (pageTags.length === 0) {
        footerList.innerHTML = '<li style="padding:10px; color:#666;">No tags on this page.</li>';
        return;
    }

    pageTags.forEach(item => {
        const li = document.createElement('li');
        li.className = 'footer-tag-item';
        if (item.status === 'Correct') li.classList.add('status-correct');
        if (item.status === 'Incorrect') li.classList.add('status-incorrect');

        li.innerHTML = `
            <span class="footer-tag-text">${item.tag}</span>
            <div class="footer-actions">
                <button class="btn-mini correct" title="Approve" onclick="setStatus(event, ${item.id}, 'Correct', this)">✓</button>
                <button class="btn-mini incorrect" title="Reject" onclick="setStatus(event, ${item.id}, 'Incorrect', this)">✗</button>
            </div>
        `;
        
        // Sync selection
        li.addEventListener('click', (e) => {
            // Prevent triggering if clicking buttons
            if (e.target.tagName === 'BUTTON') return;

            // Trigger click on main list item to handle scrolling/highlighting
            const mainLi = resultList.children[item.id]; 
            if(mainLi) mainLi.click();
        });

        footerList.appendChild(li);
    });
}

function addSidebarItem(text, pageNum, title, highlightElement, pdfRect) {
    const id = allFoundTags.length;

    allFoundTags.push({ 
        id: id, 
        tag: text, 
        page: pageNum, 
        title: title,
        status: 'Pending',
        element: highlightElement,
        pdfRect: pdfRect
    });

    // Sidebar rendering is centralized to support duplicate grouping.
    rebuildSidebar();
}

// --- SIDEBAR (RE)RENDERING + DUPLICATE GROUPING ---
// NOTE: These functions are required by addSidebarItem(), setStatus(), and exportToCSV().

function rebuildSidebar() {
    // Keep duplicateMode in sync with the UI on each rebuild.
    const selected = document.querySelector('input[name="dupMode"]:checked')?.value;
    if (selected) duplicateMode = selected;

    resultList.innerHTML = '';

    if (allFoundTags.length === 0) {
        return;
    }

    if (duplicateMode === 'unique') {
        const groups = createGroupedView(allFoundTags);
        groups.forEach(g => renderSidebarGroupedItem(g));
    } else {
        allFoundTags.forEach(item => renderSidebarOccurrenceItem(item));
    }
}

function createGroupedView(tags) {
    // Group by the literal tag string.
    const map = new Map();
    for (const t of tags) {
        const key = t.tag;
        let g = map.get(key);
        if (!g) {
            g = {
                tag: key,
                occurrences: [],
                pages: new Set(),
                titles: new Set()
            };
            map.set(key, g);
        }
        g.occurrences.push(t);
        g.pages.add(t.page);
        if (t.title) g.titles.add(t.title);
    }

    const groups = Array.from(map.values());

    // Determine group status:
    // - Incorrect if any occurrence incorrect
    // - Correct if all occurrences correct
    // - Pending otherwise
    for (const g of groups) {
        const statuses = g.occurrences.map(o => o.status);
        if (statuses.includes('Incorrect')) g.status = 'Incorrect';
        else if (statuses.length > 0 && statuses.every(s => s === 'Correct')) g.status = 'Correct';
        else g.status = 'Pending';
    }

    // Stable sort for nicer UX: by tag, then by first page.
    groups.sort((a, b) => {
        const tagCmp = a.tag.localeCompare(b.tag);
        if (tagCmp !== 0) return tagCmp;
        const aMin = Math.min(...Array.from(a.pages));
        const bMin = Math.min(...Array.from(b.pages));
        return aMin - bMin;
    });

    return groups;
}

function renderSidebarOccurrenceItem(item) {
    const li = document.createElement('li');
    li.className = 'result-item';

    const safeTitle = item.title || 'Unknown Title';
    li.innerHTML = `
        <div class="result-main">
            <div class="tag" title="Click to copy">${item.tag}</div>
            <div class="meta">Sheet: ${escapeHtml(safeTitle)} · Page: ${item.page}</div>
        </div>
        <div class="result-actions">
            <button class="btn-mini correct" title="Approve" onclick="setStatus(event, ${item.id}, 'Correct', this)">✓</button>
            <button class="btn-mini incorrect" title="Reject" onclick="setStatus(event, ${item.id}, 'Incorrect', this)">✗</button>
        </div>
    `;

    // Apply current status styling
    applyStatusClasses(li, item.status);
    updateStatusButtonsForContainer(li, item.status);

    // Add click to copy for the tag element
    const tagElement = li.querySelector('.tag');
    if (tagElement) {
        tagElement.style.cursor = 'pointer';
        tagElement.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(item.tag);
        });
    }

    li.addEventListener('click', () => {
        // Prefer scrolling to the actual hit, not only the page.
        if (item.element) {
            item.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            item.element.classList.add('active');
            setTimeout(() => item.element?.classList.remove('active'), 700);
            return;
        }

        // Fallback: scroll to page container
        const pageDiv = document.getElementById(`page-${item.page}`);
        pageDiv?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    resultList.appendChild(li);
}

function renderSidebarGroupedItem(group) {
    const li = document.createElement('li');
    li.className = 'result-item';

    const titles = Array.from(group.titles);
    const titleLabel = titles.length ? titles.join(' | ') : 'Unknown Title';
    const pages = Array.from(group.pages).sort((a, b) => a - b);

    li.innerHTML = `
        <div class="result-main">
            <div class="tag" title="Click to copy">${group.tag}</div>
            <div class="meta">Sheets: ${escapeHtml(titleLabel)} · Pages: ${pages.join(', ')} · Count: ${group.occurrences.length}</div>
        </div>
        <div class="result-actions">
            <button class="btn-mini correct" title="Approve all" data-tag="${escapeHtml(group.tag)}">✓</button>
            <button class="btn-mini incorrect" title="Reject all" data-tag="${escapeHtml(group.tag)}">✗</button>
        </div>
    `;

    // Wire group buttons without fragile inline JS (handles quotes safely)
    li.querySelector('button.correct')?.addEventListener('click', (e) => {
        const tag = e.currentTarget?.getAttribute('data-tag');
        if (!tag) return;
        setGroupStatus(e, tag, 'Correct');
    });
    li.querySelector('button.incorrect')?.addEventListener('click', (e) => {
        const tag = e.currentTarget?.getAttribute('data-tag');
        if (!tag) return;
        setGroupStatus(e, tag, 'Incorrect');
    });

    applyStatusClasses(li, group.status);
    updateStatusButtonsForContainer(li, group.status);

    // Add click to copy for the tag element
    const tagElement = li.querySelector('.tag');
    if (tagElement) {
        tagElement.style.cursor = 'pointer';
        tagElement.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(group.tag);
        });
    }

    li.addEventListener('click', () => {
        // Jump to first occurrence (best effort: actual highlight if present)
        const first = group.occurrences[0];
        if (!first) return;
        if (first.element) {
            first.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            first.element.classList.add('active');
            setTimeout(() => first.element?.classList.remove('active'), 700);
            return;
        }
        document.getElementById(`page-${first.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    resultList.appendChild(li);
}

function setGroupStatus(e, tagText, newStatus) {
    e.stopPropagation();
    for (const item of allFoundTags) {
        if (item.tag === tagText) {
            setStatusInternal(item.id, newStatus);
        }
    }
    rebuildSidebar();
}

function setStatusInternal(id, newStatus) {
    const item = allFoundTags[id];
    if (!item) return;

    item.status = newStatus;
    updateStatusUI(id, newStatus);
}

function updateStatusButtonsForContainer(containerEl, newStatus) {
    if (!containerEl) return;
    const correctBtn = containerEl.querySelector('button.correct');
    const incorrectBtn = containerEl.querySelector('button.incorrect');

    if (correctBtn) correctBtn.classList.toggle('active', newStatus === 'Correct');
    if (incorrectBtn) incorrectBtn.classList.toggle('active', newStatus === 'Incorrect');
}

function applyStatusClasses(containerEl, newStatus) {
    if (!containerEl) return;
    containerEl.classList.toggle('status-correct', newStatus === 'Correct');
    containerEl.classList.toggle('status-incorrect', newStatus === 'Incorrect');
}

function updateStatusBarCounts(totalTagsOverride) {
    // If totalTagsOverride supplied, it represents total matches found during scan
    const total = typeof totalTagsOverride === 'number' ? totalTagsOverride : allFoundTags.length;

    const correct = allFoundTags.filter(t => t.status === 'Correct').length;
    const incorrect = allFoundTags.filter(t => t.status === 'Incorrect').length;
    const pending = total - correct - incorrect;

    statusBar.textContent = `Audit Complete. Found ${total} tags. Pending ${pending} · Correct ${correct} · Incorrect ${incorrect}`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJs(s) {
    // Safe for wrapping in single quotes inside HTML onclick.
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function setStatus(e, id, newStatus, btn) {
    e.stopPropagation(); 

    setStatusInternal(id, newStatus);

    if (duplicateMode === 'unique') {
        rebuildSidebar();
    }
}

function updateStatusUI(id, newStatus) {
    const item = allFoundTags[id];

    // 1. Update Sidebar Item
    // We need to find the specific LI in the sidebar. 
    // Since we push items in order, index matches ID.
    const sidebarLi = resultList.children[id];
    if (sidebarLi) updateStatusButtonsForContainer(sidebarLi, newStatus);

    // 2. Update Footer Item (if present)
    // Footer is rebuilt dynamically, so we search by text or just rebuild it?
    // Rebuilding is safer but might be slow. Let's try to find it in current footer list.
    // Actually, since footer is filtered by page, we can just refresh the footer list 
    // if the item belongs to the current page.
    if (item.page === currentPageNumber) {
        updateFooterList(currentPageNumber);
    }

    // 3. Update Highlight Box
    if (newStatus === 'Correct') {
        item.element.classList.add('status-correct');
        item.element.classList.remove('status-incorrect');
    } else {
        item.element.classList.add('status-incorrect');
        item.element.classList.remove('status-correct');
    }

    updateStatusBarCounts();
}

function printPDF() {
    if (typeof saveAnnotatedPDF === 'function') {
        saveAnnotatedPDF(currentPdfBytes, allFoundTags);
    } else {
        window.print();
    }
}

function exportToCSV() {
    if (allFoundTags.length === 0) {
        alert("No tags found.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,";
    if (duplicateMode === 'unique') {
        csvContent += "Tag Number,Sheet Title(s),Page Number(s),Occurrences,Review Status\n";
        const groups = createGroupedView(allFoundTags);
        groups.forEach(g => {
            const titles = Array.from(g.titles).join(" | ");
            const pages = Array.from(g.pages).sort((a, b) => a - b).join(";");
            const safeTitles = `"${titles.replace(/"/g, '""')}"`;
            csvContent += `${g.tag},${safeTitles},"${pages}",${g.occurrences.length},${g.status}\n`;
        });
    } else {
        csvContent += "Tag Number,Sheet Title,Page Number,Review Status\n";
        allFoundTags.forEach(row => {
            const safeTitle = `"${row.title.replace(/"/g, '""')}"`;
            csvContent += `${row.tag},${safeTitle},${row.page},${row.status}\n`;
        });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pid_audit_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- COPY TO CLIPBOARD FUNCTIONALITY ---
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showCopyFeedback(text);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        // Fallback method
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showCopyFeedback(text);
        } catch (err) {
            console.error('Fallback: Could not copy text: ', err);
        }
        document.body.removeChild(textArea);
    });
}

function showCopyFeedback(text) {
    // Create temporary tooltip
    const tooltip = document.createElement('div');
    tooltip.textContent = `Copied: ${text}`;
    tooltip.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(40, 167, 69, 0.95);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: none;
        animation: fadeInOut 1.5s ease-in-out;
    `;
    
    document.body.appendChild(tooltip);
    
    setTimeout(() => {
        document.body.removeChild(tooltip);
    }, 1500);
}

function updateFileName(input) {
    const fileNameSpan = document.getElementById('fileName');
    if (input.files && input.files.length > 0) {
        fileNameSpan.textContent = input.files[0].name;
    } else {
        fileNameSpan.textContent = "New Document.pdf";
    }
}

// ============================================
// SYMBOL DETECTION INTEGRATION
// ============================================

// Initialize OpenCV when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Pre-load OpenCV.js in background
    if (window.SymbolDetector) {
        window.SymbolDetector.loadOpenCV().then(() => {
            console.log('OpenCV.js ready for symbol detection');
        }).catch(err => {
            console.warn('OpenCV.js not loaded:', err.message);
        });
    }
});

/**
 * Capture a symbol template from the PDF
 */
function captureSymbolTemplate() {
    const select = document.getElementById('symbolSelect');
    const symbolKey = select.value;
    
    if (!symbolKey) {
        showToast('Please select a symbol type first', 'warning');
        return;
    }
    
    if (!pdfDoc) {
        showToast('Please load a PDF first', 'warning');
        return;
    }
    
    if (window.SymbolDetector) {
        window.SymbolDetector.enableTemplateCaptureMode(symbolKey);
    } else {
        showToast('Symbol detector not loaded', 'error');
    }
}

/**
 * Run symbol detection on all pages
 */
async function runSymbolDetection() {
    if (!window.SymbolDetector) {
        showToast('Symbol detector not loaded', 'error');
        return;
    }
    
    // Check if we have any templates
    const templates = window.SymbolDetector.SYMBOL_TEMPLATES;
    let templateCount = 0;
    for (const key in templates) {
        templateCount += templates[key].templates.length;
    }
    
    if (templateCount === 0) {
        showToast('First capture a symbol: Select type → Draw on PDF', 'info');
        // Highlight the capture button
        const captureBtn = document.getElementById('capture-btn');
        if (captureBtn) {
            captureBtn.style.animation = 'pulse 0.5s ease 3';
            setTimeout(() => captureBtn.style.animation = '', 1500);
        }
        return;
    }
    
    if (!pdfDoc) {
        showToast('Please load a PDF first', 'warning');
        return;
    }
    
    const detectBtn = document.getElementById('detect-symbols-btn');
    const originalText = detectBtn.innerHTML;
    detectBtn.innerHTML = '⏳ Detecting...';
    detectBtn.disabled = true;
    
    // Create and show progress bar
    const progressBar = createProgressBar();
    
    try {
        const results = await window.SymbolDetector.detectSymbolsInAllPages(pdfWrapper, (progress) => {
            updateProgressBar(progressBar, progress);
        });
        
        // Update results display
        updateDetectionResults(results);
        
        if (results.length > 0) {
            showToast(`Found ${results.length} symbol(s)!`, 'success');
        } else {
            showToast('No matches found. Try adjusting the template.', 'info');
        }
    } catch (err) {
        console.error('Symbol detection error:', err);
        showToast('Detection error: ' + err.message, 'error');
    } finally {
        detectBtn.innerHTML = originalText;
        detectBtn.disabled = false;
        removeProgressBar(progressBar);
    }
}

/**
 * Create a progress bar for symbol detection
 */
function createProgressBar() {
    const progressContainer = document.createElement('div');
    progressContainer.id = 'detection-progress';
    progressContainer.className = 'detection-progress-container';
    progressContainer.innerHTML = `
        <div class="progress-header">
            <span class="progress-title">🔍 Detecting Symbols</span>
            <span class="progress-text">Starting...</span>
        </div>
        <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: 0%"></div>
        </div>
        <div class="progress-details">
            <span class="progress-page">Page 0 of 0</span>
            <span class="progress-percentage">0%</span>
        </div>
    `;
    
    // Insert progress bar into detection results area
    const resultsContainer = document.getElementById('detection-results');
    if (resultsContainer) {
        resultsContainer.insertBefore(progressContainer, resultsContainer.firstChild);
    }
    
    return progressContainer;
}

/**
 * Update progress bar
 */
function updateProgressBar(progressBar, progress) {
    if (!progressBar) return;
    
    const fillBar = progressBar.querySelector('.progress-bar-fill');
    const progressText = progressBar.querySelector('.progress-text');
    const progressPage = progressBar.querySelector('.progress-page');
    const progressPercentage = progressBar.querySelector('.progress-percentage');
    
    if (fillBar) fillBar.style.width = progress.percentage + '%';
    if (progressText) progressText.textContent = progress.message;
    if (progressPage) progressPage.textContent = `Page ${progress.current} of ${progress.total}`;
    if (progressPercentage) progressPercentage.textContent = progress.percentage + '%';
}

/**
 * Remove progress bar with fade out animation
 */
function removeProgressBar(progressBar) {
    if (!progressBar) return;
    
    progressBar.style.opacity = '0';
    progressBar.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
        progressBar.remove();
    }, 300);
}

/**
 * Update the template chips display
 */
function updateTemplateStatus() {
    const container = document.getElementById('template-status');
    if (!container || !window.SymbolDetector) return;
    
    const templates = window.SymbolDetector.SYMBOL_TEMPLATES;
    let html = '';
    
    for (const key in templates) {
        const count = templates[key].templates.length;
        if (count > 0) {
            html += `<span class="template-chip">
                ${templates[key].name}
                <span class="chip-count">${count}</span>
                <span class="chip-remove" onclick="removeTemplate('${key}')" title="Remove">×</span>
            </span>`;
        }
    }
    
    container.innerHTML = html;
}

/**
 * Remove a specific template type
 */
function removeTemplate(symbolKey) {
    if (window.SymbolDetector && window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey]) {
        const templates = window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey].templates;
        templates.forEach(t => { if (t.mat) t.mat.delete(); });
        window.SymbolDetector.SYMBOL_TEMPLATES[symbolKey].templates = [];
        updateTemplateStatus();
    }
}

/**
 * Update detection results display with detailed statistics
 */
function updateDetectionResults(results) {
    const container = document.getElementById('detection-results');
    if (!container) return;
    
    if (!results || results.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    // Group by symbol type
    const grouped = {};
    const pageData = {};
    
    for (const r of results) {
        // Group by symbol type
        if (!grouped[r.symbolName]) {
            grouped[r.symbolName] = { 
                count: 0, 
                color: r.color,
                key: r.symbolKey,
                detections: []
            };
        }
        grouped[r.symbolName].count++;
        grouped[r.symbolName].detections.push(r);
        
        // Group by page
        if (!pageData[r.page]) {
            pageData[r.page] = [];
        }
        pageData[r.page].push(r);
    }
    
    // Summary header
    let html = `
        <div class="result-summary-header">
            <div class="result-total">✓ Found ${results.length} symbol(s)</div>
            <button class="btn-view-details" onclick="toggleDetailedReport()">📊 View Details</button>
            <button class="btn-export-report" onclick="exportDetectionReport()" title="Export Report">📄</button>
        </div>
    `;
    
    // Quick summary by type
    html += '<div class="result-quick-summary">';
    for (const name in grouped) {
        html += `
            <div class="result-item" onclick="filterBySymbol('${grouped[name].key}')">
                <span class="symbol-dot" style="background:${grouped[name].color}"></span>
                <span class="symbol-name">${name}</span>
                <strong class="symbol-count">${grouped[name].count}</strong>
            </div>`;
    }
    html += '</div>';
    
    // Detailed report (hidden by default)
    html += '<div id="detailed-report" class="detailed-report" style="display:none;">';
    html += buildDetailedReport(grouped, pageData, results);
    html += '</div>';
    
    container.innerHTML = html;
    
    // Store results globally for export
    window.lastDetectionResults = results;
}

/**
 * Build detailed detection report
 */
function buildDetailedReport(grouped, pageData, allResults) {
    let html = '<div class="report-sections">';
    
    // Section 1: By Symbol Type
    html += '<div class="report-section">';
    html += '<h4>📦 By Symbol Type</h4>';
    for (const name in grouped) {
        const data = grouped[name];
        html += `
            <div class="symbol-detail-block">
                <div class="symbol-detail-header">
                    <span class="symbol-dot" style="background:${data.color}"></span>
                    <strong>${name}</strong> (${data.count} found)
                </div>
                <div class="symbol-locations">
                    ${buildSymbolLocations(data.detections)}
                </div>
            </div>`;
    }
    html += '</div>';
    
    // Section 2: By Page
    html += '<div class="report-section">';
    html += '<h4>📄 By Page</h4>';
    const pages = Object.keys(pageData).sort((a, b) => parseInt(a) - parseInt(b));
    for (const page of pages) {
        const symbols = pageData[page];
        const symbolCounts = {};
        for (const s of symbols) {
            symbolCounts[s.symbolName] = (symbolCounts[s.symbolName] || 0) + 1;
        }
        
        html += `
            <div class="page-detail-block">
                <div class="page-header">
                    <strong>Page ${page}</strong> 
                    <span class="page-count">${symbols.length} symbol(s)</span>
                    <button class="btn-jump-page" onclick="jumpToPage(${page})">Go →</button>
                </div>
                <div class="page-symbols">
                    ${Object.entries(symbolCounts).map(([name, count]) => 
                        `<span class="page-symbol-chip">${name} (${count})</span>`
                    ).join('')}
                </div>
            </div>`;
    }
    html += '</div>';
    
    // Section 3: Confidence Analysis
    html += '<div class="report-section">';
    html += '<h4>🎯 Confidence Analysis</h4>';
    html += buildConfidenceAnalysis(allResults);
    html += '</div>';
    
    html += '</div>'; // close report-sections
    return html;
}

/**
 * Build symbol locations list
 */
function buildSymbolLocations(detections) {
    if (detections.length === 0) return '';
    
    // Group by page
    const byPage = {};
    for (const d of detections) {
        if (!byPage[d.page]) byPage[d.page] = [];
        byPage[d.page].push(d);
    }
    
    let html = '<div class="location-list">';
    for (const page in byPage) {
        const items = byPage[page];
        html += `
            <div class="location-item">
                <span class="location-page" onclick="jumpToPage(${page})">Page ${page}</span>
                <span class="location-count">${items.length}×</span>
                <span class="location-confidence">${getAverageConfidence(items)}% avg</span>
            </div>`;
    }
    html += '</div>';
    return html;
}

/**
 * Build confidence analysis
 */
function buildConfidenceAnalysis(results) {
    if (results.length === 0) return '<p>No data</p>';
    
    // Calculate confidence stats
    const confidences = results.map(r => r.confidence * 100);
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const min = Math.min(...confidences);
    const max = Math.max(...confidences);
    
    // Categorize by confidence level
    const high = results.filter(r => r.confidence >= 0.85).length;
    const medium = results.filter(r => r.confidence >= 0.70 && r.confidence < 0.85).length;
    const low = results.filter(r => r.confidence < 0.70).length;
    
    let html = `
        <div class="confidence-stats">
            <div class="stat-row">
                <span>Average Confidence:</span>
                <strong>${avg.toFixed(1)}%</strong>
            </div>
            <div class="stat-row">
                <span>Range:</span>
                <strong>${min.toFixed(1)}% - ${max.toFixed(1)}%</strong>
            </div>
        </div>
        <div class="confidence-breakdown">
            <div class="confidence-bar">
                <div class="conf-segment conf-high" style="width: ${(high/results.length)*100}%">
                    <span class="conf-label">${high} High (≥85%)</span>
                </div>
                <div class="conf-segment conf-medium" style="width: ${(medium/results.length)*100}%">
                    <span class="conf-label">${medium} Med (70-85%)</span>
                </div>
                <div class="conf-segment conf-low" style="width: ${(low/results.length)*100}%">
                    <span class="conf-label">${low} Low (<70%)</span>
                </div>
            </div>
        </div>
    `;
    
    return html;
}

/**
 * Get average confidence for a list of detections
 */
function getAverageConfidence(detections) {
    if (detections.length === 0) return 0;
    const sum = detections.reduce((acc, d) => acc + (d.confidence * 100), 0);
    return (sum / detections.length).toFixed(0);
}

/**
 * Toggle detailed report visibility
 */
function toggleDetailedReport() {
    const report = document.getElementById('detailed-report');
    if (!report) return;
    
    const isVisible = report.style.display !== 'none';
    report.style.display = isVisible ? 'none' : 'block';
    
    const btn = document.querySelector('.btn-view-details');
    if (btn) {
        btn.textContent = isVisible ? '📊 View Details' : '📊 Hide Details';
    }
}

/**
 * Jump to a specific page
 */
function jumpToPage(pageNumber) {
    const pageContainer = document.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
    if (pageContainer) {
        pageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Flash effect
        pageContainer.style.transition = 'background 0.3s';
        pageContainer.style.background = 'rgba(102, 126, 234, 0.1)';
        setTimeout(() => {
            pageContainer.style.background = '';
        }, 1000);
        
        showToast(`Jumped to page ${pageNumber}`, 'info');
    }
}

/**
 * Filter symbols by type
 */
function filterBySymbol(symbolKey) {
    if (!window.SymbolDetector) return;
    
    // Toggle filter - if clicking the same symbol, clear filter
    if (window.currentSymbolFilter === symbolKey) {
        window.currentSymbolFilter = null;
        window.SymbolDetector.clearSymbolHighlights();
        showToast('Filter cleared', 'info');
    } else {
        window.currentSymbolFilter = symbolKey;
        // Hide other symbols, show only this one
        const overlays = document.querySelectorAll('.symbol-overlay');
        overlays.forEach(overlay => {
            const key = overlay.dataset.symbolKey;
            if (key === symbolKey) {
                overlay.style.display = 'block';
            } else {
                overlay.style.display = 'none';
            }
        });
        showToast(`Showing only ${symbolKey}`, 'info');
    }
}

/**
 * Export detection report
 */
function exportDetectionReport() {
    if (!window.lastDetectionResults || window.lastDetectionResults.length === 0) {
        showToast('No detection results to export', 'warning');
        return;
    }
    
    const results = window.lastDetectionResults;
    const timestamp = new Date().toISOString().split('T')[0];
    const pdfName = window.currentPDFName || 'document';
    
    // Generate CSV content
    let csv = 'Symbol Type,Page,X,Y,Width,Height,Confidence\n';
    for (const r of results) {
        csv += `"${r.symbolName}",${r.page},${r.x},${r.y},${r.width},${r.height},${(r.confidence * 100).toFixed(1)}%\n`;
    }
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdfName}_symbol_report_${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('✓ Report exported', 'success');
}

/**
 * Start custom symbol capture
 */
function startCustomCapture() {
    if (!window.SymbolDetector) {
        showToast('Symbol detector not loaded', 'error');
        return;
    }
    
    if (!pdfDoc) {
        showToast('Please load a PDF first', 'warning');
        return;
    }
    
    // Generate a unique key based on timestamp
    const timestamp = Date.now();
    const symbolKey = `symbol_${timestamp}`;
    const symbolName = `Symbol ${new Date().toLocaleTimeString()}`;
    
    window.SymbolDetector.enableTemplateCaptureMode(symbolKey, symbolName);
}

/**
 * Clear all symbol data
 */
function clearSymbolData() {
    if (window.SymbolDetector) {
        window.SymbolDetector.clearSymbolDetection();
        updateTemplateStatus();
        const resultsContainer = document.getElementById('detection-results');
        if (resultsContainer) resultsContainer.innerHTML = '';
        window.lastDetectionResults = null;
        window.currentSymbolFilter = null;
        showToast('Cleared all templates and results', 'info');
    }
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll('.toast-notification').forEach(t => t.remove());
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span> ${message}`;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type]};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 8px;
        animation: slideUp 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add CSS for toast animations
const toastStyles = document.createElement('style');
toastStyles.textContent = `
    @keyframes slideUp {
        from { transform: translateX(-50%) translateY(20px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes fadeOut {
        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); box-shadow: 0 0 10px rgba(102, 126, 234, 0.5); }
    }
`;
document.head.appendChild(toastStyles);

// Update template status periodically (to catch captures from overlay)
setInterval(() => {
    updateTemplateStatus();
}, 1000);

// ============================================
// PREDEFINED SYMBOL LOADERS
// ============================================

/**
 * Load all valve preset symbols
 */
async function loadPresetValves() {
    if (!window.PredefinedSymbols) {
        showToast('Predefined symbols not loaded', 'error');
        return;
    }
    
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading...';
    }
    
    try {
        showToast('Loading valve templates...', 'info');
        const result = await window.PredefinedSymbols.loadAllValves();
        updateTemplateStatus();
        showToast(`Loaded ${result.loaded.length} valve types!`, 'success');
    } catch (err) {
        console.error('Failed to load valve presets:', err);
        showToast('Failed to load presets', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔧 All Valves';
        }
    }
}

/**
 * Load equipment preset symbols
 */
async function loadPresetEquipment() {
    if (!window.PredefinedSymbols) {
        showToast('Predefined symbols not loaded', 'error');
        return;
    }
    
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading...';
    }
    
    try {
        showToast('Loading equipment templates...', 'info');
        const result = await window.PredefinedSymbols.loadCommonEquipment();
        updateTemplateStatus();
        showToast(`Loaded ${result.loaded.length} equipment types!`, 'success');
    } catch (err) {
        console.error('Failed to load equipment presets:', err);
        showToast('Failed to load presets', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '⚙️ Equipment';
        }
    }
}

/**
 * Show the symbol library modal
 */
function showSymbolLibrary() {
    if (!window.PredefinedSymbols) {
        showToast('Symbol library not loaded', 'error');
        return;
    }
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'symbol-library-modal';
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
    
    const symbols = window.PredefinedSymbols.getAvailablePredefinedSymbols();
    
    // Group by category
    const categories = {};
    for (const sym of symbols) {
        const cat = sym.name.includes('Valve') ? 'Valves' : 
                    sym.name.includes('Actuator') ? 'Actuators' :
                    ['Pump', 'Motor', 'Heat Exchanger', 'Strainer'].some(e => sym.name.includes(e)) ? 'Equipment' :
                    'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(sym);
    }
    
    let gridHtml = '';
    for (const [cat, items] of Object.entries(categories)) {
        gridHtml += `<div class="library-category"><h4>${cat}</h4><div class="library-grid">`;
        for (const sym of items) {
            const svgData = window.PredefinedSymbols.PREDEFINED_SYMBOLS[sym.key]?.svg || '';
            gridHtml += `
                <div class="library-item" data-key="${sym.key}" onclick="loadSymbolFromLibrary('${sym.key}')">
                    <div class="library-preview">${svgData}</div>
                    <div class="library-name">${sym.name}</div>
                </div>
            `;
        }
        gridHtml += '</div></div>';
    }
    
    modal.innerHTML = `
        <div class="library-dialog">
            <div class="library-header">
                <h3>📚 Symbol Library</h3>
                <button class="btn-close" onclick="closeSymbolLibrary()">✕</button>
            </div>
            <p class="library-hint">Click a symbol to load it as a template</p>
            <div class="library-content">
                ${gridHtml}
            </div>
            <div class="library-footer">
                <button class="btn btn-secondary" onclick="loadAllFromLibrary()">Load All</button>
                <button class="btn btn-primary" onclick="closeSymbolLibrary()">Done</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add styles for modal
    if (!document.getElementById('library-styles')) {
        const styles = document.createElement('style');
        styles.id = 'library-styles';
        styles.textContent = `
            .library-dialog {
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 700px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0,0,0,0.4);
            }
            .library-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid #e5e7eb;
            }
            .library-header h3 {
                margin: 0;
                font-size: 18px;
            }
            .btn-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #6b7280;
                padding: 4px 8px;
            }
            .btn-close:hover { color: #111; }
            .library-hint {
                margin: 0;
                padding: 10px 20px;
                background: #f0f9ff;
                color: #0369a1;
                font-size: 13px;
            }
            .library-content {
                flex: 1;
                overflow-y: auto;
                padding: 15px 20px;
            }
            .library-category h4 {
                margin: 15px 0 10px;
                color: #374151;
                font-size: 14px;
                border-bottom: 1px solid #e5e7eb;
                padding-bottom: 5px;
            }
            .library-category:first-child h4 {
                margin-top: 0;
            }
            .library-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                gap: 10px;
            }
            .library-item {
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                padding: 10px;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .library-item:hover {
                border-color: #3b82f6;
                background: #eff6ff;
                transform: translateY(-2px);
            }
            .library-item.loaded {
                border-color: #10b981;
                background: #ecfdf5;
            }
            .library-item.loaded::after {
                content: '✓';
                position: absolute;
                top: 5px;
                right: 5px;
                color: #10b981;
                font-weight: bold;
            }
            .library-preview {
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .library-preview svg {
                max-width: 100%;
                max-height: 100%;
            }
            .library-name {
                font-size: 11px;
                color: #374151;
                margin-top: 6px;
                line-height: 1.2;
            }
            .library-footer {
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

/**
 * Load a single symbol from the library
 */
async function loadSymbolFromLibrary(symbolKey) {
    if (!window.PredefinedSymbols) return;
    
    const item = document.querySelector(`.library-item[data-key="${symbolKey}"]`);
    if (item) {
        item.style.opacity = '0.5';
    }
    
    try {
        await window.PredefinedSymbols.loadPredefinedSymbol(symbolKey);
        if (item) {
            item.classList.add('loaded');
            item.style.opacity = '1';
        }
        updateTemplateStatus();
        showToast(`Loaded ${window.PredefinedSymbols.PREDEFINED_SYMBOLS[symbolKey]?.name}`, 'success');
    } catch (err) {
        console.error('Failed to load symbol:', err);
        if (item) item.style.opacity = '1';
        showToast('Failed to load symbol', 'error');
    }
}

/**
 * Load all symbols from library
 */
async function loadAllFromLibrary() {
    if (!window.PredefinedSymbols) return;
    
    showToast('Loading all symbols...', 'info');
    
    const symbols = window.PredefinedSymbols.getAvailablePredefinedSymbols();
    let loaded = 0;
    
    for (const sym of symbols) {
        try {
            await window.PredefinedSymbols.loadPredefinedSymbol(sym.key);
            const item = document.querySelector(`.library-item[data-key="${sym.key}"]`);
            if (item) item.classList.add('loaded');
            loaded++;
        } catch (err) {
            console.warn(`Failed to load ${sym.key}`);
        }
    }
    
    updateTemplateStatus();
    showToast(`Loaded ${loaded} symbols!`, 'success');
}

/**
 * Close the symbol library modal
 */
function closeSymbolLibrary() {
    const modal = document.getElementById('symbol-library-modal');
    if (modal) modal.remove();
}

/**
 * Show the upload symbols dialog
 */
function showUploadSymbols() {
    if (window.PredefinedSymbols && window.PredefinedSymbols.showImageUploadDialog) {
        window.PredefinedSymbols.showImageUploadDialog();
    } else {
        showToast('Upload feature not available', 'error');
    }
}

// ============================================
// SYMBOL LIBRARY (from /symbols folder)
// ============================================

/**
 * Load valve symbols from the /symbols folder
 */
async function loadLibraryValves() {
    if (!window.SymbolLibrary) {
        showToast('Symbol library not loaded', 'error');
        return;
    }
    
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading...';
    }
    
    try {
        showToast('Loading valve symbols from library...', 'info');
        const result = await window.SymbolLibrary.loadAllLibraryValves();
        updateTemplateStatus();
        
        if (result.loaded.length > 0) {
            showToast(`✓ Loaded ${result.loaded.length} valve(s)!`, 'success');
        } else {
            showToast('No valve symbols found in /symbols folder', 'warning');
        }
    } catch (err) {
        console.error('Failed to load library valves:', err);
        showToast('Failed to load symbols', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔧 Valves';
        }
    }
}

/**
 * Load equipment symbols from the /symbols folder
 */
async function loadLibraryEquipment() {
    if (!window.SymbolLibrary) {
        showToast('Symbol library not loaded', 'error');
        return;
    }
    
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading...';
    }
    
    try {
        showToast('Loading equipment symbols from library...', 'info');
        const result = await window.SymbolLibrary.loadAllLibraryEquipment();
        updateTemplateStatus();
        
        if (result.loaded.length > 0) {
            showToast(`✓ Loaded ${result.loaded.length} equipment item(s)!`, 'success');
        } else {
            showToast('No equipment symbols found in /symbols folder', 'warning');
        }
    } catch (err) {
        console.error('Failed to load library equipment:', err);
        showToast('Failed to load symbols', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '⚙️ Equipment';
        }
    }
}

/**
 * Browse all symbols in the library
 */
function browseSymbolLibrary() {
    if (!window.SymbolLibrary) {
        showToast('Symbol library not loaded', 'error');
        return;
    }
    
    window.SymbolLibrary.showLibraryBrowser();
}