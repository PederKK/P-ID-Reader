// --- CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const TAG_PATTERN = /\b\d+-\d+"-[A-Z]+-[A-Z0-9]+-\d+-[A-Z]+\b/g;
const RENDER_SCALE = 2.0; 
let allFoundTags = []; 
let currentZoom = 1.0;

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

// Track current page for footer updates
let currentPageNumber = 1;
let pdfDoc = null; // Store global PDF reference

fileInput.addEventListener('change', handleFileUpload);

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

function toggleFooter() {
    const footer = document.getElementById('sticky-footer');
    const btn = document.getElementById('toggle-footer-btn');
    footer.classList.toggle('collapsed');
    btn.textContent = footer.classList.contains('collapsed') ? 'Show' : 'Hide';
}

function toggleSidebar() {
    document.body.classList.toggle('sidebar-collapsed');
    // Trigger resize event so PDF viewer can adjust if needed (though we use CSS transform/width)
    // But if we were using canvas width based on container, we might need to re-render.
    // Since we use CSS scaling on a fixed canvas size, it should be fine.
}

zoomSlider.addEventListener('input', (e) => {
    currentZoom = e.target.value;
    zoomValue.textContent = Math.round(currentZoom * 100) + '%';
    pdfWrapper.style.transform = `scale(${currentZoom})`;
    pdfWrapper.style.transformOrigin = 'top center';
});

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    pdfWrapper.innerHTML = '';
    resultList.innerHTML = '';
    allFoundTags = [];
    exportBtn.style.display = 'none';
    printBtn.style.display = 'none';
    statusBar.textContent = 'Loading P&ID...';
    spinner.style.display = 'block';

    currentZoom = 1.0;
    zoomSlider.value = 1.0;
    pdfWrapper.style.transform = 'scale(1)';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument(arrayBuffer);
        pdfDoc = await loadingTask.promise; // Store globally

        statusBar.textContent = `Scanning ${pdfDoc.numPages} sheets...`;

        let totalMatches = 0;
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const matchesOnPage = await processPage(pdfDoc, i);
            totalMatches += matchesOnPage;
        }

        statusBar.textContent = `Audit Complete. Found ${totalMatches} tags.`;
        if (totalMatches > 0) {
            exportBtn.style.display = 'block';
            printBtn.style.display = 'block';
        }

    } catch (err) {
        console.error(err);
        statusBar.textContent = 'Error: ' + err.message;
    } finally {
        spinner.style.display = 'none';
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
        TAG_PATTERN.lastIndex = 0;
        let match;

        while ((match = TAG_PATTERN.exec(text)) !== null) {
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

            pageDiv.appendChild(highlight);
            addSidebarItem(matchText, pageNumber, sheetTitle, highlight);
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
        // Clone the logic from addSidebarItem but append to footer
        const li = document.createElement('li');
        li.className = 'result-item';
        if (item.status === 'Correct') li.classList.add('status-correct'); // Optional styling

        li.innerHTML = `
            <div class="item-info">
                <span class="tag-text">${item.tag}</span>
                <div class="tag-meta">Status: ${item.status}</div>
            </div>
            <div class="review-actions">
                <button class="btn-review correct ${item.status === 'Correct' ? 'active' : ''}" 
                    onclick="setStatus(event, ${item.id}, 'Correct', this)">&#10003;</button>
                <button class="btn-review incorrect ${item.status === 'Incorrect' ? 'active' : ''}" 
                    onclick="setStatus(event, ${item.id}, 'Incorrect', this)">&#10007;</button>
            </div>
        `;
        
        // Sync selection
        li.addEventListener('click', () => {
            // Trigger click on main list item to handle scrolling/highlighting
            const mainLi = resultList.children[item.id]; 
            if(mainLi) mainLi.click();
        });

        footerList.appendChild(li);
    });
}

function addSidebarItem(text, pageNum, title, highlightElement) {
    const id = allFoundTags.length;

    allFoundTags.push({ 
        id: id, 
        tag: text, 
        page: pageNum, 
        title: title,
        status: 'Pending',
        element: highlightElement
    });

    const li = document.createElement('li');
    li.className = 'result-item';

    li.innerHTML = `
        <div class="item-info">
            <span class="tag-text">${text}</span>
            <div class="tag-meta">
                <span class="tag-title">${title}</span> <br>
                Page ${pageNum}
            </div>
        </div>
        <div class="review-actions">
            <button class="btn-review correct" title="Approve" onclick="setStatus(event, ${id}, 'Correct', this)">&#10003;</button>
            <button class="btn-review incorrect" title="Reject" onclick="setStatus(event, ${id}, 'Incorrect', this)">&#10007;</button>
        </div>
    `;

    li.addEventListener('click', () => {
        document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
        li.classList.add('selected');

        document.querySelectorAll('.highlight-box').forEach(h => h.classList.remove('focused'));
        highlightElement.classList.add('focused');

        highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });

    resultList.appendChild(li);
}

function setStatus(e, id, newStatus, btn) {
    e.stopPropagation(); 

    const item = allFoundTags[id];
    item.status = newStatus;

    // Update buttons in BOTH sidebar and footer
    updateStatusUI(id, newStatus);
}

function updateStatusUI(id, newStatus) {
    const item = allFoundTags[id];
    
    // Helper to update a specific button group
    const updateButtons = (container) => {
        if (!container) return;
        const correctBtn = container.querySelector('.correct');
        const incorrectBtn = container.querySelector('.incorrect');
        
        if (newStatus === 'Correct') {
            correctBtn?.classList.add('active');
            incorrectBtn?.classList.remove('active');
        } else {
            incorrectBtn?.classList.add('active');
            correctBtn?.classList.remove('active');
        }
    };

    // 1. Update Sidebar Item
    // We need to find the specific LI in the sidebar. 
    // Since we push items in order, index matches ID.
    const sidebarLi = resultList.children[id];
    if (sidebarLi) updateButtons(sidebarLi);

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
}

function printPDF() {
    window.print();
}

function exportToCSV() {
    if (allFoundTags.length === 0) {
        alert("No tags found.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Tag Number,Sheet Title,Page Number,Review Status\n";

    allFoundTags.forEach(row => {
        const safeTitle = `"${row.title.replace(/"/g, '""')}"`; 
        csvContent += `${row.tag},${safeTitle},${row.page},${row.status}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pid_audit_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}