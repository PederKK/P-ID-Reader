// --- CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const LINE_TAG_PATTERN = /\b\d+-\d+"-[A-Z]+-[A-Z0-9]+-\d+-[A-Z]+\b/g;
const VALVE_TAG_PATTERN = /\b\d+(?:-\d+")?-[A-Z0-9]+-\d+\b/g;
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
const exportBtn = document.getElementById('export-btn');
const printBtn = document.getElementById('print-btn');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const footerList = document.getElementById('footerList');
const stickyFooter = document.getElementById('sticky-footer');
const viewerContainer = document.getElementById('viewer-container');
const zoomContainer = document.getElementById('zoom-container'); // New container

// Track current page for footer updates
let currentPageNumber = 1;
let pdfDoc = null; // Store global PDF reference
let pdfContentWidth = 0; // Max width of pages
let pdfContentHeight = 0; // Total height of pages

// Panning Variables
let isPanning = false;
let startX, startY, scrollLeft, scrollTop;

fileInput.addEventListener('change', handleFileUpload);

// Duplicate mode toggle (sidebar/CSV only)
document.querySelectorAll('input[name="dupMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        duplicateMode = document.querySelector('input[name="dupMode"]:checked')?.value || 'occurrences';
        rebuildSidebar();
        updateFooterList(currentPageNumber);
        updateStatusBarCounts();
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

    // Determine Search Mode
    const searchMode = document.querySelector('input[name="searchMode"]:checked').value;
    if (searchMode === 'valve') {
        activeTagPattern = VALVE_TAG_PATTERN;
    } else if (searchMode === 'both') {
        // Combine patterns: Line tags first (more specific), then Valve tags
        activeTagPattern = new RegExp(LINE_TAG_PATTERN.source + "|" + VALVE_TAG_PATTERN.source, "g");
    } else {
        activeTagPattern = LINE_TAG_PATTERN;
    }

    pdfWrapper.innerHTML = '';
    resultList.innerHTML = '';
    allFoundTags = [];
    exportBtn.style.display = 'none';
    printBtn.style.display = 'none';
    statusBar.textContent = 'Loading P&ID...';
    spinner.style.display = 'block';

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

    } catch (err) {
        console.error(err);
        statusBar.textContent = 'Error: ' + err.message;
    } finally {
        spinner.style.display = 'none';
    }
}

function updateStatusBarCounts(totalOccurrences) {
    const occurrences = typeof totalOccurrences === 'number' ? totalOccurrences : allFoundTags.length;
    const unique = new Set(allFoundTags.map(t => t.tag)).size;

    const current = statusBar.textContent || '';
    if (/^Error:|^Loading|^Scanning/i.test(current)) return;

    if (duplicateMode === 'unique') {
        statusBar.textContent = `Audit Complete. Found ${unique} unique tags (${occurrences} occurrences).`;
    } else {
        statusBar.textContent = `Audit Complete. Found ${occurrences} tags.`;
    }
}

function createGroupedView(tags) {
    const map = new Map();
    for (const t of tags) {
        const key = t.tag;
        if (!map.has(key)) {
            map.set(key, {
                tag: key,
                occurrences: [],
                titles: new Set(),
                pages: new Set(),
                status: 'Pending'
            });
        }
        const g = map.get(key);
        g.occurrences.push(t);
        if (t.title) g.titles.add(t.title);
        g.pages.add(t.page);
    }

    const groups = Array.from(map.values());
    for (const g of groups) {
        const statuses = new Set(g.occurrences.map(o => o.status));
        if (statuses.has('Incorrect')) g.status = 'Incorrect';
        else if (statuses.size === 1 && statuses.has('Correct')) g.status = 'Correct';
        else g.status = 'Pending';
    }

    groups.sort((a, b) => a.tag.localeCompare(b.tag));
    return groups;
}

function updateStatusButtonsForContainer(container, newStatus) {
    if (!container) return;
    const correctBtn = container.querySelector('.correct');
    const incorrectBtn = container.querySelector('.incorrect');

    if (newStatus === 'Correct') {
        correctBtn?.classList.add('active');
        incorrectBtn?.classList.remove('active');
    } else if (newStatus === 'Incorrect') {
        incorrectBtn?.classList.add('active');
        correctBtn?.classList.remove('active');
    } else {
        correctBtn?.classList.remove('active');
        incorrectBtn?.classList.remove('active');
    }
}

function setStatusInternal(id, newStatus) {
    const item = allFoundTags[id];
    if (!item) return;
    item.status = newStatus;
    updateStatusUI(id, newStatus);
}

function rebuildSidebar() {
    resultList.innerHTML = '';
    if (allFoundTags.length === 0) return;

    if (duplicateMode === 'unique') {
        const groups = createGroupedView(allFoundTags);
        groups.forEach(group => {
            const li = document.createElement('li');
            li.className = 'result-item';
            if (group.status === 'Correct') li.classList.add('status-correct');
            if (group.status === 'Incorrect') li.classList.add('status-incorrect');

            const pages = Array.from(group.pages).sort((a, b) => a - b);
            const titles = Array.from(group.titles);
            const metaTitle = titles.length === 1 ? titles[0] : (titles.length > 1 ? `${titles[0]} (+${titles.length - 1} more)` : '');
            const pageLabel = pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(', ')}`;
            const countLabel = `${group.occurrences.length}x`;

            li.innerHTML = `
                <div class="item-info">
                    <span class="tag-text">${group.tag} <span class="tag-count">(${countLabel})</span></span>
                    <span class="tag-meta">${metaTitle}</span>
                    <span class="tag-page">${pageLabel}</span>
                </div>
                <div class="review-actions">
                    <button class="btn-review correct" title="Approve all">✓</button>
                    <button class="btn-review incorrect" title="Reject all">✕</button>
                </div>
            `;

            li.addEventListener('click', (e) => {
                if (e.target?.tagName === 'BUTTON') return;
                document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
                li.classList.add('selected');
                const occ = group.occurrences[0];
                if (!occ?.element) return;
                document.querySelectorAll('.highlight-box').forEach(h => h.classList.remove('focused'));
                occ.element.classList.add('focused');
                occ.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            });

            li.querySelector('.btn-review.correct')?.addEventListener('click', (ev) => {
                ev.stopPropagation();
                group.occurrences.forEach(o => setStatusInternal(o.id, 'Correct'));
                rebuildSidebar();
                updateFooterList(currentPageNumber);
            });
            li.querySelector('.btn-review.incorrect')?.addEventListener('click', (ev) => {
                ev.stopPropagation();
                group.occurrences.forEach(o => setStatusInternal(o.id, 'Incorrect'));
                rebuildSidebar();
                updateFooterList(currentPageNumber);
            });

            resultList.appendChild(li);
        });
        return;
    }

    // occurrences mode
    allFoundTags.forEach(item => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.innerHTML = `
            <div class="item-info">
                <span class="tag-text">${item.tag}</span>
                <span class="tag-meta">${item.title}</span>
                <span class="tag-page">Page ${item.page}</span>
            </div>
            <div class="review-actions">
                <button class="btn-review correct" title="Approve">✓</button>
                <button class="btn-review incorrect" title="Reject">✕</button>
            </div>
        `;

        li.addEventListener('click', () => {
            document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
            li.classList.add('selected');
            document.querySelectorAll('.highlight-box').forEach(h => h.classList.remove('focused'));
            item.element.classList.add('focused');
            item.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        });

        li.querySelector('.btn-review.correct')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setStatusInternal(item.id, 'Correct');
        });
        li.querySelector('.btn-review.incorrect')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setStatusInternal(item.id, 'Incorrect');
        });

        updateStatusButtonsForContainer(li, item.status);
        resultList.appendChild(li);
    });
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

function updateFileName(input) {
    const fileNameSpan = document.getElementById('fileName');
    if (input.files && input.files.length > 0) {
        fileNameSpan.textContent = input.files[0].name;
    } else {
        fileNameSpan.textContent = "New Document.pdf";
    }
}