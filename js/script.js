// --- CONFIGURATION ---
// Keep PDF processing fully local. The matching worker is stored in this project.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';

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

// Actuated valve tags
// Examples: 35PSV 9627A, 35TV 9069, 35PCV 9061
// Rule: 2 digits + 2/3 letters ending in V + space + 4 digits + optional suffix letter
const ACTUATED_VALVE_TAG_PATTERN = /\b\d{2}[A-Z]{1,2}V\s+\d{4}[A-Z]?\b/g;
const ACTUATED_PREFIX_PATTERN = /^\d{2}[A-Z]{1,2}V$/;
const ACTUATED_SUFFIX_PATTERN = /^\d{4}[A-Z]?$/;
let activeTagPattern = LINE_TAG_PATTERN;
let currentSearchModes = new Set(['line']);

// Keep the existing combined search behaviour, but retain the kind of each
// match so optional experiments can distinguish line tags from valve tags.
function classifyTagType(tagText) {
    const text = String(tagText || '');
    if (new RegExp(LINE_TAG_PATTERN.source, 'i').test(text) ||
        new RegExp(LINE_TAG_PATTERN_ALT.source, 'i').test(text)) {
        return 'line';
    }
    if (new RegExp(VALVE_TAG_PATTERN.source, 'i').test(text) ||
        new RegExp(VALVE_TAG_PATTERN_ALT.source, 'i').test(text)) {
        return 'valve';
    }
    if (new RegExp(ACTUATED_VALVE_TAG_PATTERN.source, 'i').test(text)) {
        return 'actuated';
    }
    return 'unknown';
}

// P&ID table extraction is intentionally separate from tag/valve searching.
// These aliases are matched against the searchable PDF text layer only.
const PID_TABLE_FIELDS = [
    {
        key: 'itemTag',
        label: 'Item tag',
        colorClass: 'pid-field-red',
        aliases: [
            'ITEM TAG',
            'ITEM TAG NO',
            'ITEM TAG NUMBER',
            'LINE TAG NO',
            'LINE TAG NUMBER',
            'LINE NUMBER',
            'LINE NO',
            'LINE TAG',
            'TAG NO',
            'TAG NUMBER'
        ]
    },
    {
        key: 'description',
        label: 'Description',
        colorClass: 'pid-field-blue',
        aliases: [
            'EQUIPMENT DESCRIPTION',
            'PUMP DESCRIPTION',
            'LINE DESCRIPTION',
            'SERVICE DESCRIPTION',
            'DESCRIPTION',
            'SERVICE'
        ]
    },
    {
        key: 'quantityRedundancy',
        label: 'Quantity x redundancy',
        colorClass: 'pid-field-purple',
        aliases: [
            'QUANTITY X REDUNDANCY',
            'QUANTITYXREDUNDANCY',
            'QUANTITY AND REDUNDANCY',
            'QTY X REDUNDANCY',
            'QUANTITY REDUNDANCY',
            'REDUNDANCY'
        ]
    },
    {
        key: 'ratedFlowRate',
        label: 'Rated flow rate',
        colorClass: 'pid-field-cyan',
        aliases: ['RATED FLOW RATE', 'DESIGN FLOW RATE', 'RATED FLOW', 'FLOW RATE', 'CAPACITY']
    },
    {
        key: 'dischargePressure',
        label: 'Discharge pressure',
        colorClass: 'pid-field-orange',
        aliases: ['DISCHARGE PRESSURE', 'OUTLET PRESSURE', 'DISCHARGE PRESS']
    },
    {
        key: 'differentialHead',
        label: 'Differential head',
        colorClass: 'pid-field-teal',
        aliases: ['TOTAL DIFFERENTIAL HEAD', 'DIFFERENTIAL HEAD', 'DIFFERENTIAL PRESSURE']
    },
    {
        key: 'designTemperature',
        label: 'Design temperature',
        colorClass: 'pid-field-pink',
        aliases: ['DESIGN TEMPERATURE', 'DESIGN TEMP', 'DESIGN T']
    },
    {
        key: 'designPressure',
        label: 'Design pressure',
        colorClass: 'pid-field-indigo',
        aliases: ['DESIGN PRESSURE', 'DESIGN PRESS', 'DESIGN P']
    },
    {
        key: 'operatingTemperature',
        label: 'Operating temperature',
        colorClass: 'pid-field-green',
        aliases: ['OPERATING TEMPERATURE', 'OPERATING TEMP', 'OPERATION TEMPERATURE', 'OPERATING T']
    },
    {
        key: 'motorPower',
        label: 'Motor power',
        colorClass: 'pid-field-brown',
        aliases: ['MOTOR POWER', 'MOTOR RATING', 'MOTOR KW', 'POWER']
    },
    {
        key: 'materialInsulation',
        label: 'Material / insulation',
        colorClass: 'pid-field-olive',
        aliases: [
            'MATERIAL OF CONSTRUCTION',
            'MATERIAL / INSULATION',
            'INSULATION (TYPE/NO)',
            'INSULATION TYPE / NO',
            'MATERIAL INSULATION',
            'MATERIAL',
            'INSULATION'
        ]
    }
];

const TABLE_LINE_TAG_RE = new RegExp(LINE_TAG_PATTERN_ALT.source, 'i');
const GENERIC_ITEM_TAG_RE = /\b[A-Z]{1,8}(?:[-_/]\s*\d{1,8}|\s*\d{1,8}[A-Z]?)(?:[-_/][A-Z0-9]+)*\b/i;
const TABLE_LINE_Y_TOLERANCE = 6;
const TABLE_MAX_HEADER_ITEMS = 5;
const TABLE_MAX_KEY_VALUE_GAP = 140;

const RENDER_SCALE = 2.0; 
let allFoundTags = []; 
const DEFAULT_ZOOM = 0.25;
let currentZoom = DEFAULT_ZOOM;
let currentPdfBytes = null;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_WHEEL_STEP = 0.02;
// Keep the audit readable at its requested 25% default, but give a clicked
// result enough scale to inspect without requiring a manual zoom adjustment.
const TAG_FOCUS_ZOOM = 0.5;
const TAG_FOCUS_FEEDBACK_MS = 900;

// Duplicate handling for sidebar + CSV
// - occurrences: show/count every match
// - unique: combine identical tags across pages
let duplicateMode = 'occurrences';
const DEFAULT_LINE_LIST_LABEL = 'No line list selected';
const UI_PREF_KEYS = {
    lastLineListName: 'pidReader.lastLineListName',
    searchMode: 'pidReader.searchMode',
    duplicateMode: 'pidReader.duplicateMode',
    activeProjectId: 'pidReader.activeProjectId'
};

// DOM Elements
const fileInput = document.getElementById('fileInput');
const lineListInput = document.getElementById('lineListInput');
const pdfWrapper = document.getElementById('pdf-wrapper');
const resultList = document.getElementById('resultList');
const statusBar = document.getElementById('status-bar');
const spinner = document.getElementById('spinner');
const completionIcon = document.getElementById('completion-icon');
const exportBtn = document.getElementById('export-btn');
const printBtn = document.getElementById('print-btn');
const footerList = document.getElementById('footerList');
const stickyFooter = document.getElementById('sticky-footer');
const viewerContainer = document.getElementById('viewer-container');
const viewerEmptyState = document.getElementById('viewer-empty-state');
const zoomContainer = document.getElementById('zoom-container'); // New container
// Search is triggered by the sidebar button after selecting options.
const searchBtn = document.getElementById('search-btn');
const searchAction = document.getElementById('search-action');
const lineListFileName = document.getElementById('lineListFileName');
const compareDrawer = document.getElementById('compare-drawer');
const compareDrawerResizeHandle = document.getElementById('compare-drawer-resize');
const compareDrawerMeta = document.getElementById('compare-drawer-meta');
const compareDrawerContent = document.getElementById('compare-drawer-content');
const compareShowAttributesCheckbox = document.getElementById('compare-show-attrs');
const compareShowPdfAttributesCheckbox = document.getElementById('compare-show-pdf-attrs');
const compareAttributeSelect = document.getElementById('compare-attr-select');
const exportCompareBtn = document.getElementById('export-compare-btn');
const compareAttributeOverlay = document.getElementById('compare-attribute-overlay');
const extractPidTablesBtn = document.getElementById('extract-pid-tables-btn');
const exportPidTablesBtn = document.getElementById('export-pid-tables-btn');
const pidTableExtractionStatus = document.getElementById('pid-table-extraction-status');
const resultsSidebarTitle = document.getElementById('results-sidebar-title');
const showTagsViewBtn = document.getElementById('show-tags-view-btn');
const showValveLineViewBtn = document.getElementById('show-valve-line-view-btn');
const showPidTableViewBtn = document.getElementById('show-pid-table-view-btn');
const tagResultsView = document.getElementById('tag-results-view');
const valveLineResultsView = document.getElementById('valve-line-results-view');
const valveLineResultsSummary = document.getElementById('valve-line-results-summary');
const showAllValveLinksBtn = document.getElementById('show-all-valve-links-btn');
const valveLineResults = document.getElementById('valve-line-results');
const pidTableResultsView = document.getElementById('pid-table-results-view');
const pidTableResultsSummary = document.getElementById('pid-table-results-summary');
const pidTableResults = document.getElementById('pid-table-results');
const traceResultsToolbar = document.getElementById('trace-results-toolbar');
const traceResultsSummary = document.getElementById('trace-results-summary');
const copyTraceResultsBtn = document.getElementById('copy-trace-results-btn');
let pipeTracingEnabled = false;
let valveAssociationCounts = { assigned: 0, review: 0, unassigned: 0 };
let activeResultsView = 'tags';
let activeValveLineFocus = { valveId: null, lineId: null };

// Local project library. Files are kept in IndexedDB so projects survive refreshes
// without sending drawings anywhere.
const projectMenu = document.getElementById('project-menu');
const projectFiles = document.getElementById('project-files');
const projectModal = document.getElementById('project-modal');
const projectForm = document.getElementById('project-form');
const projectNameInput = document.getElementById('project-name-input');
const projectFolderStatus = document.getElementById('project-folder-status');
const projectFolderTree = document.getElementById('project-folder-tree');
const projectFolderHelp = document.getElementById('project-folder-help');
const createProjectFolderBtn = document.getElementById('create-project-folder-btn');
const connectProjectFolderBtn = document.getElementById('connect-project-folder-btn');
const disconnectProjectFolderBtn = document.getElementById('disconnect-project-folder-btn');
const useBrowserProjectBtn = document.getElementById('use-browser-project-btn');
const PROJECT_FOLDER_LAYOUT = [
    '01_P&ID',
    '02_Line Lists',
    '03_Reports',
    '04_Exports'
];
let activeProjectId = null;
let selectedProjectFolder = '01_P&ID';
let projectFolderOpen = true;
let projectDbPromise;
function openProjectDb() {
    if (projectDbPromise) return projectDbPromise;
    projectDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('pid-auditor-projects', 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('pdfs')) {
                const store = db.createObjectStore('pdfs', { keyPath: 'id' });
                store.createIndex('projectId', 'projectId');
            }
            if (!db.objectStoreNames.contains('files')) {
                const store = db.createObjectStore('files', { keyPath: 'id' });
                store.createIndex('projectId', 'projectId');
                store.createIndex('projectFolder', ['projectId', 'folder']);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return projectDbPromise;
}
async function projectTransaction(storeName, mode, callback) {
    const db = await openProjectDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode), store = tx.objectStore(storeName);
        const result = callback(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
}
async function getProjects() { return projectTransaction('projects', 'readonly', store => new Promise(r => { const q = store.getAll(); q.onsuccess = () => r(q.result); })); }
async function getProjectPdfs(projectId) { return projectTransaction('pdfs', 'readonly', store => new Promise(r => { const q = store.index('projectId').getAll(projectId); q.onsuccess = () => r(q.result); })); }
async function getProject(projectId) { return projectTransaction('projects', 'readonly', store => new Promise(r => { const q = store.get(projectId); q.onsuccess = () => r(q.result || null); })); }
async function getProjectFiles(projectId, folder) {
    return projectTransaction('files', 'readonly', store => new Promise(r => {
        const q = store.index('projectFolder').getAll([projectId, folder]);
        q.onsuccess = () => r(q.result || []);
    }));
}
async function saveProjectFileRecord(blob, folder, fileName, kind = 'file') {
    if (!activeProjectId || !blob) return;
    await projectTransaction('files', 'readwrite', store => store.put({
        id: crypto.randomUUID(),
        projectId: activeProjectId,
        folder,
        name: fileName,
        kind,
        size: blob.size,
        addedAt: Date.now(),
        blob
    }));
}
async function updateProject(projectId, changes) {
    const project = await getProject(projectId);
    if (!project) return;
    await projectTransaction('projects', 'readwrite', store => store.put({ ...project, ...changes }));
}
async function ensureProjectFolderPermission(directoryHandle, request = false) {
    if (!directoryHandle) return false;
    if (!directoryHandle.queryPermission) return true;
    let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && request && directoryHandle.requestPermission) {
        permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
    }
    return permission === 'granted';
}
async function createProjectFolderLayout(directoryHandle) {
    for (const folderName of PROJECT_FOLDER_LAYOUT) {
        await directoryHandle.getDirectoryHandle(folderName, { create: true });
    }
}
function supportsNativeProjectFolders() {
    return typeof window.showDirectoryPicker === 'function';
}
function getBrowserProjectFolderName(project) {
    return project?.folderName || project?.name || 'Project files';
}
async function activateBrowserProjectFolder(project = null) {
    const currentProject = project || await getProject(activeProjectId);
    if (!currentProject || !activeProjectId) return false;
    const folderName = getBrowserProjectFolderName(currentProject);
    await updateProject(activeProjectId, { directoryHandle: null, folderMode: 'browser', folderName });
    await renderProjectFolderStatus();
    await renderProjectFiles();
    return true;
}
async function useBrowserProjectFolder() {
    if (!activeProjectId) await renderProjects();
    const activated = await activateBrowserProjectFolder();
    if (activated) showToast('Using the browser project library. Files stay on this device.', 'success');
}
async function renderProjectFolderStatus() {
    if (!projectFolderStatus || !activeProjectId) return false;
    const project = await getProject(activeProjectId);
    const directoryHandle = project?.directoryHandle;
    const hasBrowserFolder = project?.folderMode === 'browser';
    const nativeFoldersAvailable = supportsNativeProjectFolders();
    if (!directoryHandle && !hasBrowserFolder) {
        projectFolderStatus.textContent = 'No main folder selected. Choose or create one to show project files.';
        if (projectFolderTree) projectFolderTree.hidden = true;
        if (projectFolderHelp) projectFolderHelp.hidden = true;
        if (projectFiles) projectFiles.hidden = true;
        if (createProjectFolderBtn) createProjectFolderBtn.textContent = nativeFoldersAvailable ? 'Create folder' : 'Create project folders';
        if (connectProjectFolderBtn) connectProjectFolderBtn.textContent = nativeFoldersAvailable ? 'Use existing' : 'Use browser library';
        if (useBrowserProjectBtn) useBrowserProjectBtn.hidden = !nativeFoldersAvailable;
        if (disconnectProjectFolderBtn) disconnectProjectFolderBtn.hidden = true;
        return false;
    }

    if (!directoryHandle && hasBrowserFolder) {
        projectFolderStatus.textContent = `Project folders ready in browser: ${getBrowserProjectFolderName(project)}. Files stay in this project.`;
        if (projectFolderTree) projectFolderTree.hidden = false;
        if (projectFolderHelp) projectFolderHelp.hidden = false;
        if (createProjectFolderBtn) createProjectFolderBtn.textContent = 'Create project folders';
        if (connectProjectFolderBtn) connectProjectFolderBtn.textContent = 'Use browser library';
        if (useBrowserProjectBtn) useBrowserProjectBtn.hidden = true;
        if (disconnectProjectFolderBtn) disconnectProjectFolderBtn.hidden = false;
        return true;
    }

    let permission = false;
    try {
        permission = await ensureProjectFolderPermission(directoryHandle);
    } catch (error) {
        console.warn('Could not query project folder permission', error);
    }
    projectFolderStatus.textContent = permission
        ? `Connected: ${directoryHandle.name}`
        : `Folder saved: ${directoryHandle.name}. Grant access to show its files.`;
    if (projectFolderTree) projectFolderTree.hidden = !permission;
    if (projectFolderHelp) projectFolderHelp.hidden = !permission;
    if (projectFiles && !permission) projectFiles.hidden = true;
    if (createProjectFolderBtn) createProjectFolderBtn.textContent = 'Create folder';
    if (connectProjectFolderBtn) connectProjectFolderBtn.textContent = permission ? 'Change folder' : 'Grant access';
    if (useBrowserProjectBtn) useBrowserProjectBtn.hidden = true;
    if (disconnectProjectFolderBtn) disconnectProjectFolderBtn.hidden = false;
    return permission;
}
async function connectProjectFolder() {
    if (!activeProjectId) await renderProjects();
    const currentProject = await getProject(activeProjectId);
    if (currentProject?.folderMode === 'browser' && !currentProject.directoryHandle) {
        await useBrowserProjectFolder();
        return;
    }
    if (currentProject?.directoryHandle && connectProjectFolderBtn?.textContent !== 'Change folder') {
        try {
            const permissionGranted = await ensureProjectFolderPermission(currentProject.directoryHandle, true);
            if (permissionGranted) {
                await renderProjectFolderStatus();
                await renderProjectFiles();
                showToast(`Project folder ready: ${currentProject.directoryHandle.name}`, 'success');
            } else {
                showToast('Folder permission was not granted', 'warning');
            }
        } catch (error) {
            console.error('Could not grant project folder access', error);
            showToast('Could not access the project folder', 'error');
        }
        return;
    }
    if (!supportsNativeProjectFolders()) {
        await activateBrowserProjectFolder(currentProject);
        showToast('Using the browser project library. Files stay on this device.', 'success');
        return;
    }
    try {
        const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await createProjectFolderLayout(directoryHandle);
        await updateProject(activeProjectId, { directoryHandle, folderMode: 'filesystem', folderName: directoryHandle.name });
        await renderProjectFolderStatus();
        await renderProjectFiles();
        showToast(`Project folder connected: ${directoryHandle.name}`, 'success');
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Could not connect project folder', error);
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError' || error?.name === 'TypeError') {
            await activateBrowserProjectFolder(currentProject);
            showToast('Folder picker is unavailable here. Using the browser project library instead.', 'info');
            return;
        }
        showToast('Could not connect the selected folder', 'error');
    }
}
async function createProjectFolder() {
    if (!activeProjectId) await renderProjects();
    const currentProject = await getProject(activeProjectId);
    if (currentProject?.folderMode === 'browser' && !currentProject.directoryHandle) {
        await activateBrowserProjectFolder(currentProject);
        showToast('Project folders are already ready in the browser library.', 'info');
        return;
    }
    if (!supportsNativeProjectFolders()) {
        await activateBrowserProjectFolder(currentProject);
        showToast('Created project folders in the browser library. Files stay on this device.', 'success');
        return;
    }
    try {
        const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const project = currentProject || await getProject(activeProjectId);
        const directoryName = safeFileName(project?.name || 'PID Project');
        const directoryHandle = await parentHandle.getDirectoryHandle(directoryName, { create: true });
        await createProjectFolderLayout(directoryHandle);
        await updateProject(activeProjectId, { directoryHandle, folderMode: 'filesystem', folderName: directoryHandle.name });
        await renderProjectFolderStatus();
        await renderProjectFiles();
        showToast(`Created project folder: ${directoryHandle.name}`, 'success');
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Could not create project folder', error);
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError' || error?.name === 'TypeError') {
            await activateBrowserProjectFolder(currentProject);
            showToast('Folder picker is unavailable here. Created project folders in the browser library instead.', 'info');
            return;
        }
        showToast('Could not create the project folder', 'error');
    }
}
async function disconnectProjectFolder() {
    if (!activeProjectId) return;
    await updateProject(activeProjectId, { directoryHandle: null, folderMode: null, folderName: null });
    await renderProjectFolderStatus();
    showToast('Project folder disconnected. Browser library is unchanged.', 'info');
}
function safeFileName(fileName) {
    return String(fileName || 'file').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'file';
}
async function getUniqueFileHandle(directoryHandle, fileName) {
    const cleanName = safeFileName(fileName);
    const extensionMatch = cleanName.match(/(\.[^.]*)$/);
    const stem = extensionMatch ? cleanName.slice(0, -extensionMatch[1].length) : cleanName;
    const extension = extensionMatch ? extensionMatch[1] : '';
    for (let index = 1; index <= 100; index += 1) {
        const candidate = index === 1 ? cleanName : `${stem} (${index})${extension}`;
        try {
            await directoryHandle.getFileHandle(candidate);
        } catch (error) {
            if (error?.name === 'NotFoundError') return directoryHandle.getFileHandle(candidate, { create: true });
            throw error;
        }
    }
    throw new Error('Could not create a unique file name');
}
async function saveBlobToProjectFolder(blob, folderName, fileName) {
    if (!activeProjectId || !blob) return false;
    const project = await getProject(activeProjectId);
    const directoryHandle = project?.directoryHandle;
    if (!directoryHandle || !(await ensureProjectFolderPermission(directoryHandle))) return false;
    const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await getUniqueFileHandle(folderHandle, fileName);
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
}
async function saveProjectArtifact(blob, folderName, fileName, kind = 'file') {
    await saveProjectFileRecord(blob, folderName, fileName, kind);
    return saveBlobToProjectFolder(blob, folderName, fileName);
}
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFileName(fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function saveLocalPdf(file) {
    if (!activeProjectId) return;
    await projectTransaction('pdfs', 'readwrite', store => store.put({ id: crypto.randomUUID(), projectId: activeProjectId, name: file.name, size: file.size, addedAt: Date.now(), blob: file }));
    await saveBlobToProjectFolder(file, '01_P&ID', file.name);
    await renderProjectFiles();
}
async function getPhysicalProjectFiles(folderName) {
    const project = await getProject(activeProjectId);
    const directoryHandle = project?.directoryHandle;
    if (!directoryHandle || !(await ensureProjectFolderPermission(directoryHandle))) return null;

    try {
        const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
        const files = [];
        for await (const [name, fileHandle] of folderHandle.entries()) {
            if (fileHandle.kind === 'file') {
                files.push({ id: `physical:${folderName}:${name}`, name, kind: 'physical', fileHandle });
            }
        }
        return files.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        console.warn(`Could not list project folder ${folderName}`, error);
        return null;
    }
}
async function getProjectFolderItems(folderName) {
    const physicalFiles = await getPhysicalProjectFiles(folderName);
    if (physicalFiles !== null) return physicalFiles;
    if (folderName === '01_P&ID') {
        return (await getProjectPdfs(activeProjectId)).map(file => ({ ...file, kind: 'pdf' }));
    }
    return getProjectFiles(activeProjectId, folderName);
}
function getFileIcon(fileName) {
    const extension = String(fileName || '').split('.').pop()?.toLowerCase();
    if (extension === 'pdf') return '📄';
    if (extension === 'csv') return '📊';
    return '📎';
}
async function openProjectFile(fileItem) {
    try {
        const file = fileItem.fileHandle ? await fileItem.fileHandle.getFile() : fileItem.blob;
        if (!file) return;
        if (/\.pdf$/i.test(file.name)) {
            window.currentPDFName = file.name.replace(/\.pdf$/i, '');
            await runAudit(file);
            return;
        }
        if (/\.csv$/i.test(file.name)) {
            downloadBlob(file, file.name);
            showToast(`${file.name} opened via download`, 'info');
            return;
        }
        showToast(`${file.name} is available in the project folder`, 'info');
    } catch (error) {
        console.error('Could not open project file', error);
        showToast('Could not open this project file', 'error');
    }
}
async function renderProjects() {
    if (!projectMenu) return;
    let projects = await getProjects();
    if (!projects.length) {
        const starter = { id: crypto.randomUUID(), name: 'My first project', createdAt: Date.now() };
        await projectTransaction('projects', 'readwrite', store => store.put(starter));
        projects = [starter];
    }
    const rememberedProjectId = readPreference(UI_PREF_KEYS.activeProjectId);
    activeProjectId = activeProjectId || projects.find(project => project.id === rememberedProjectId)?.id || projects[0].id;
    rememberPreference(UI_PREF_KEYS.activeProjectId, activeProjectId);
    projectMenu.innerHTML = projects.map(p => `<li class="project-menu__item ${p.id === activeProjectId ? 'project-menu__item--active' : ''}" data-project-id="${p.id}">${escapeHtml(p.name)}</li>`).join('');
    projectMenu.querySelectorAll('[data-project-id]').forEach(el => el.addEventListener('click', async () => { activeProjectId = el.dataset.projectId; rememberPreference(UI_PREF_KEYS.activeProjectId, activeProjectId); await renderProjects(); }));
    const folderReady = await renderProjectFolderStatus();
    if (folderReady) await renderProjectFiles();
}
async function renderProjectFiles() {
    if (!projectFiles || !activeProjectId) return;
    const selectedFolderButton = Array.from(projectFolderTree?.querySelectorAll('[data-project-folder]') || [])
        .find(button => button.dataset.projectFolder === selectedProjectFolder);
    if (selectedFolderButton) selectedFolderButton.after(projectFiles);
    document.querySelectorAll('[data-project-folder]').forEach(button => {
        button.setAttribute('aria-expanded', button === selectedFolderButton && projectFolderOpen ? 'true' : 'false');
    });

    const project = await getProject(activeProjectId);
    const hasBrowserFolder = project?.folderMode === 'browser';
    if ((!project?.directoryHandle && !hasBrowserFolder) || (project.directoryHandle && !(await ensureProjectFolderPermission(project.directoryHandle)))) {
        projectFiles.hidden = true;
        return;
    }
    const files = await getProjectFolderItems(selectedProjectFolder);
    projectFiles.hidden = false;
    projectFiles.innerHTML = `<div class="project-files__title">${files.length} file${files.length === 1 ? '' : 's'}</div>` + (files.length ? files.map(f => `<button type="button" class="project-file" data-project-file-id="${escapeHtml(f.id)}"><span>${getFileIcon(f.name)} ${escapeHtml(f.name)}</span><small>Open</small></button>`).join('') : `<div class="project-files__empty">No files in this folder yet.</div>`);
    projectFiles.querySelectorAll('[data-project-file-id]').forEach(el => el.addEventListener('click', async () => {
        const file = files.find(candidate => candidate.id === el.dataset.projectFileId);
        if (file) await openProjectFile(file);
    }));
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
document.querySelectorAll('[data-project-folder]').forEach(folderButton => folderButton.addEventListener('click', async () => {
    const nextFolder = folderButton.dataset.projectFolder;
    const isSameFolder = selectedProjectFolder === nextFolder;
    const isClosing = isSameFolder && projectFolderOpen;
    selectedProjectFolder = nextFolder;
    projectFolderOpen = !isClosing;
    document.querySelectorAll('[data-project-folder]').forEach(button => {
        const isActive = button === folderButton;
        button.classList.toggle('project-folder-row--active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.setAttribute('aria-expanded', isActive && projectFolderOpen ? 'true' : 'false');
    });
    if (isClosing) {
        if (projectFiles) projectFiles.hidden = true;
        return;
    }
    await renderProjectFiles();
}));
document.getElementById('cancel-project-btn')?.addEventListener('click', () => { projectModal.hidden = true; });
createProjectFolderBtn?.addEventListener('click', createProjectFolder);
connectProjectFolderBtn?.addEventListener('click', connectProjectFolder);
disconnectProjectFolderBtn?.addEventListener('click', disconnectProjectFolder);
useBrowserProjectBtn?.addEventListener('click', useBrowserProjectFolder);
projectForm?.addEventListener('submit', async e => { e.preventDefault(); const name = projectNameInput.value.trim(); if (!name) return; const project = { id: crypto.randomUUID(), name, createdAt: Date.now() }; await projectTransaction('projects', 'readwrite', store => store.put(project)); activeProjectId = project.id; rememberPreference(UI_PREF_KEYS.activeProjectId, activeProjectId); projectModal.hidden = true; projectNameInput.value = ''; await renderProjects(); });
renderProjects().catch(error => console.warn('Local project storage unavailable', error));

// Track current page for footer updates
let currentPageNumber = 1;
let pdfDoc = null; // Store global PDF reference
let pdfContentWidth = 0; // Max width of pages
let pdfContentHeight = 0; // Total height of pages
const pidPageMeta = new Map();
let pidTableRows = [];
let activePidTableRowId = null;
const compareDrawerState = {
    fileName: '',
    lineColumnLabel: '',
    lineColumnIndex: -1,
    lineHeaders: [],
    pidTagLookup: new Map(),
    lineTagAttributes: new Map(),
    lineRows: [],
    attributeColumns: [],
    selectedAttributeKey: '',
    showAttributes: false,
    showPdfOverlayAttributes: false,
    missing: [],
    extra: [],
    matched: [],
    pidUniqueCount: 0,
    lineUniqueCount: 0,
    jumpCycle: new Map()
};
let compareResizeInProgress = false;
let compareResizeStartY = 0;
let compareResizeStartHeight = 0;
let compareAttributeOverlayTimeout = null;

// Panning Variables
let isPanning = false;
let startX, startY, scrollLeft, scrollTop;

fileInput.addEventListener('change', handleFileUpload);
lineListInput?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        await saveProjectArtifact(file, '02_Line Lists', file.name, 'line-list');
    } catch (error) {
        console.warn('Could not save line list to project folder', error);
    }
});
document.querySelectorAll('input[name="searchMode"]').forEach(input => {
    input.addEventListener('change', () => {
        const selectedModes = Array.from(document.querySelectorAll('input[name="searchMode"]:checked'))
            .map(el => el.value);
        rememberPreference(UI_PREF_KEYS.searchMode, JSON.stringify(selectedModes));
    });
});
if (compareShowAttributesCheckbox) {
    compareShowAttributesCheckbox.addEventListener('change', () => {
        compareDrawerState.showAttributes = !!compareShowAttributesCheckbox.checked;
        renderCompareDrawer();
    });
}
if (compareShowPdfAttributesCheckbox) {
    compareShowPdfAttributesCheckbox.addEventListener('change', () => {
        compareDrawerState.showPdfOverlayAttributes = !!compareShowPdfAttributesCheckbox.checked;
        renderCompareDrawer();
    });
}
if (compareAttributeSelect) {
    compareAttributeSelect.addEventListener('change', () => {
        compareDrawerState.selectedAttributeKey = compareAttributeSelect.value || '';
        renderCompareDrawer();
    });
}
if (compareDrawerContent) {
    compareDrawerContent.addEventListener('click', handleCompareDrawerContentClick);
}
if (compareDrawerResizeHandle) {
    compareDrawerResizeHandle.addEventListener('mousedown', startCompareDrawerResize);
}
document.addEventListener('mousemove', onCompareDrawerResizeMove);
document.addEventListener('mouseup', stopCompareDrawerResize);

if (extractPidTablesBtn) {
    extractPidTablesBtn.addEventListener('click', extractPidTables);
}
if (exportPidTablesBtn) {
    exportPidTablesBtn.addEventListener('click', exportPidTablesToCsv);
}
if (showTagsViewBtn) {
    showTagsViewBtn.addEventListener('click', () => showResultsView('tags'));
}
if (showValveLineViewBtn) {
    showValveLineViewBtn.addEventListener('click', () => showResultsView('valves'));
}
if (showAllValveLinksBtn) {
    showAllValveLinksBtn.addEventListener('click', toggleAllValveLineConnectors);
}
if (showPidTableViewBtn) {
    showPidTableViewBtn.addEventListener('click', () => showResultsView('tables'));
}
if (pidTableResults) {
    pidTableResults.addEventListener('click', (event) => {
        const rowElement = event.target.closest('tbody tr[data-table-row-id]');
        if (!rowElement) return;
        jumpToPidTableRow(Number(rowElement.dataset.tableRowId));
    });
}
if (valveLineResults) {
    valveLineResults.addEventListener('click', (event) => {
        const row = event.target.closest('tbody tr[data-valve-id]');
        const valve = row && allFoundTags.find(item => item.id === Number(row.dataset.valveId));
        if (!valve) return;

        const showLinkButton = event.target.closest('button[data-show-link-line-id]');
        if (showLinkButton) {
            event.stopPropagation();
            const preferredLineId = activeValveLineFocus.valveId === valve.id && activeValveLineFocus.lineId !== null
                ? activeValveLineFocus.lineId
                : Number(showLinkButton.dataset.showLinkLineId);
            const line = allFoundTags.find(item => item.id === Number(preferredLineId));
            focusValveLineConnection(valve, line || null, row, true, false);
            return;
        }

        const lineButton = event.target.closest('button[data-line-id]');
        if (lineButton) {
            event.stopPropagation();
            const line = allFoundTags.find(item => item.id === Number(lineButton.dataset.lineId));
            focusValveLineConnection(valve, line || null, row);
            return;
        }

        const line = valveLineOptions(valve)
            .map(option => allFoundTags.find(item => item.id === Number(option.lineId)))
            .find(Boolean) || null;
        focusValveLineConnection(valve, line, row);
    });
}

// Duplicate mode UI binding (Count all vs Combine)
document.querySelectorAll('input[name="dupMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        duplicateMode = document.querySelector('input[name="dupMode"]:checked')?.value || 'occurrences';
        rememberPreference(UI_PREF_KEYS.duplicateMode, duplicateMode);
        rebuildSidebar();
    });
});
restoreRememberedSelections();

// --- PANNING CONTROLS ---
viewerContainer.addEventListener('mousedown', (e) => {
    // Only pan if left click and not on a highlight box or interactive element
    if (
        e.button !== 0 ||
        e.target.closest('.highlight-box') ||
        e.target.closest('.btn-floating')
    ) return;
    
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
    if (e.key === 'Escape' && compareDrawer?.classList.contains('open')) {
        closeCompareDrawer();
        return;
    }

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
        // Keep the point below the mouse stationary while zooming. A smaller
        // step also makes trackpads and high-resolution mouse wheels easier to
        // control.
        const anchor = getZoomAnchor(e.clientX, e.clientY);
        updateZoom(e.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP, anchor);
    }
}, { passive: false });

function getZoomAnchor(clientX, clientY) {
    const wrapperRect = pdfWrapper?.getBoundingClientRect();
    const zoom = Number(currentZoom) || 1;
    if (!wrapperRect || wrapperRect.width <= 0 || wrapperRect.height <= 0) return null;

    return {
        clientX,
        clientY,
        // Store the point in the wrapper's unscaled coordinate system.
        contentX: (clientX - wrapperRect.left) / zoom,
        contentY: (clientY - wrapperRect.top) / zoom
    };
}

function getViewerCenterAnchor() {
    const viewerRect = viewerContainer?.getBoundingClientRect();
    if (!viewerRect) return null;
    return getZoomAnchor(
        viewerRect.left + viewerRect.width / 2,
        viewerRect.top + viewerRect.height / 2
    );
}

function updateZoom(delta, anchor = null) {
    const zoomAnchor = anchor || getViewerCenterAnchor();
    let newZoom = parseFloat(currentZoom) + delta;
    newZoom = Math.max(ZOOM_MIN, Math.min(newZoom, ZOOM_MAX));
    
    currentZoom = Number(newZoom.toFixed(2));
    applyZoom(zoomAnchor);
}

function applyZoom(anchor = null) {
    const zoom = Number(currentZoom) || 1;
    
    // Scale the inner wrapper. The wrapper remains top-left based; the scroll
    // adjustment below is what makes zooming feel anchored to the pointer.
    pdfWrapper.style.transform = `scale(${zoom})`;
    
    // Resize the outer container to occupy the correct space
    if (pdfContentWidth > 0 && pdfContentHeight > 0) {
        zoomContainer.style.width = `${pdfContentWidth * zoom}px`;
        zoomContainer.style.height = `${pdfContentHeight * zoom}px`;
    }

    if (anchor) {
        const wrapperRect = pdfWrapper.getBoundingClientRect();
        const zoomedPointX = wrapperRect.left + anchor.contentX * zoom;
        const zoomedPointY = wrapperRect.top + anchor.contentY * zoom;

        // Move the scroll position by the amount the anchored point moved.
        // The browser will clamp this naturally at the document edges.
        viewerContainer.scrollLeft += zoomedPointX - anchor.clientX;
        viewerContainer.scrollTop += zoomedPointY - anchor.clientY;
    }
}

function centerViewerOnElement(element, behavior = 'smooth') {
    if (!element || !viewerContainer) return;

    const viewerRect = viewerContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const viewerCenterX = viewerRect.left + viewerRect.width / 2;
    const viewerCenterY = viewerRect.top + viewerRect.height / 2;
    const elementCenterX = elementRect.left + elementRect.width / 2;
    const elementCenterY = elementRect.top + elementRect.height / 2;

    viewerContainer.scrollTo({
        left: viewerContainer.scrollLeft + elementCenterX - viewerCenterX,
        top: viewerContainer.scrollTop + elementCenterY - viewerCenterY,
        behavior
    });
}

/**
 * Focus a PDF result for review. The normal viewer starts at 25% so a whole
 * sheet fits on screen; clicking a result temporarily raises that only as
 * far as 50% (or keeps a user's already higher zoom), then centers the hit.
 */
function focusPdfTag(item) {
    if (!item || !viewerContainer) return;

    const target = item.element || document.getElementById(`page-${item.page}`);
    if (!target) return;

    const zoom = Number(currentZoom) || DEFAULT_ZOOM;
    if (zoom < TAG_FOCUS_ZOOM) {
        const anchor = getViewerCenterAnchor();
        currentZoom = TAG_FOCUS_ZOOM;
        applyZoom(anchor);
    }

    target.classList.add('active');
    // Let the transformed layout settle before measuring the target. This is
    // more reliable than scrollIntoView when the PDF is scaled from its origin.
    requestAnimationFrame(() => {
        centerViewerOnElement(target, 'smooth');
    });
    window.setTimeout(() => target.classList.remove('active'), TAG_FOCUS_FEEDBACK_MS);
}

function clearValveLineConnectors(resetButton = true) {
    document.querySelectorAll('.valve-line-connector-overlay').forEach(element => element.remove());
    if (resetButton && showAllValveLinksBtn) {
        showAllValveLinksBtn.setAttribute('aria-pressed', 'false');
        showAllValveLinksBtn.textContent = showAllValveLinksBtn.dataset.defaultLabel || 'Show links';
        showAllValveLinksBtn.title = '';
    }
}

function clearValveLineConnectionFocus() {
    clearValveLineConnectors();
    document.querySelectorAll('.highlight-box.connection-focus-valve, .highlight-box.connection-focus-line')
        .forEach(element => {
            element.classList.remove('connection-focus-valve', 'connection-focus-line');
            element.removeAttribute('data-connection-focus');
        });
    valveLineResults?.querySelectorAll('tbody tr.is-selected')
        .forEach(row => row.classList.remove('is-selected'));
}

function drawValveLineConnector(valve, line, options = {}) {
    if (!valve?.element || !line?.element || valve.page !== line.page) return false;
    const pageDiv = document.getElementById(`page-${valve.page}`);
    if (!pageDiv) return false;

    const preserveExisting = Boolean(options.preserveExisting);
    const showAll = Boolean(options.showAll);
    if (!preserveExisting) clearValveLineConnectors();
    const pageRect = pageDiv.getBoundingClientRect();
    const pageWidth = pageDiv.clientWidth || Number.parseFloat(pageDiv.style.width) || 0;
    const pageHeight = pageDiv.clientHeight || Number.parseFloat(pageDiv.style.height) || 0;
    if (!pageWidth || !pageHeight) return false;

    const toPagePoint = (element) => {
        const rect = element.getBoundingClientRect();
        if (pageRect.width && pageRect.height && rect.width && rect.height) {
            return {
                x: ((rect.left + rect.width / 2) - pageRect.left) * (pageWidth / pageRect.width),
                y: ((rect.top + rect.height / 2) - pageRect.top) * (pageHeight / pageRect.height)
            };
        }
        return {
            x: (Number.parseFloat(element.style.left) || 0) + (Number.parseFloat(element.style.width) || 0) / 2,
            y: (Number.parseFloat(element.style.top) || 0) + (Number.parseFloat(element.style.height) || 0) / 2
        };
    };
    const valvePoint = toPagePoint(valve.element);
    const linePoint = toPagePoint(line.element);
    const deltaX = linePoint.x - valvePoint.x;
    const deltaY = linePoint.y - valvePoint.y;
    const length = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(length) || length < 1) return false;

    const overlay = document.createElement('div');
    overlay.className = `valve-line-connector-overlay${showAll ? ' is-all' : ''}`;
    overlay.setAttribute('aria-hidden', 'true');

    const connector = document.createElement('div');
    connector.className = 'valve-line-connector-stroke';
    connector.style.left = `${valvePoint.x}px`;
    connector.style.top = `${valvePoint.y}px`;
    connector.style.width = `${length}px`;
    connector.style.transform = `translateY(-50%) rotate(${Math.atan2(deltaY, deltaX)}rad)`;

    const makeEndpoint = (point, role, label) => {
        const endpoint = document.createElement('span');
        endpoint.className = `valve-line-connector-endpoint is-${role}`;
        endpoint.style.left = `${point.x}px`;
        endpoint.style.top = `${point.y}px`;
        endpoint.textContent = label;
        return endpoint;
    };

    overlay.append(
        connector,
        makeEndpoint(valvePoint, 'valve', 'V'),
        makeEndpoint(linePoint, 'line', 'L')
    );
    if (!showAll) {
        const label = document.createElement('span');
        label.className = 'valve-line-connector-label';
        label.style.left = `${(valvePoint.x + linePoint.x) / 2}px`;
        label.style.top = `${(valvePoint.y + linePoint.y) / 2}px`;
        label.textContent = 'Valve → Line';
        overlay.appendChild(label);
    }
    pageDiv.appendChild(overlay);
    return true;
}

function valveLinePairs() {
    return allFoundTags.filter(isValveAuditTag).map(valve => {
        const option = valveLineOptions(valve)[0];
        const line = option && allFoundTags.find(item => item.id === Number(option.lineId));
        return line ? { valve, line } : null;
    }).filter(Boolean);
}

function showAllValveLineConnectors() {
    clearValveLineConnectionFocus();
    const pairs = valveLinePairs();
    let shown = 0;
    for (const { valve, line } of pairs) {
        if (drawValveLineConnector(valve, line, { preserveExisting: true, showAll: true })) shown += 1;
    }
    if (showAllValveLinksBtn) {
        showAllValveLinksBtn.setAttribute('aria-pressed', shown ? 'true' : 'false');
        showAllValveLinksBtn.textContent = shown ? 'Hide links' : (showAllValveLinksBtn.dataset.defaultLabel || 'Show links');
        showAllValveLinksBtn.title = shown ? `${shown} links shown` : '';
    }
    return shown;
}

function toggleAllValveLineConnectors() {
    if (showAllValveLinksBtn?.getAttribute('aria-pressed') === 'true') {
        clearValveLineConnectors();
        return;
    }
    showAllValveLineConnectors();
}

function focusValveLineConnection(valve, line = null, row = null, showConnector = false, retraceLine = true) {
    if (!valve) return;

    clearValveLineConnectionFocus();
    activeValveLineFocus = {
        valveId: valve.id,
        lineId: line?.id ?? null
    };

    if (row) row.classList.add('is-selected');
    if (valve.element) {
        valve.element.classList.add('connection-focus-valve');
        valve.element.dataset.connectionFocus = 'VALVE';
    }
    if (line?.element) {
        line.element.classList.add('connection-focus-line');
        line.element.dataset.connectionFocus = 'LINE';
    }

    if (line && retraceLine) window.PipeTracing?.selectTag?.(line);
    focusPdfTag(valve);
    if (showConnector && line) requestAnimationFrame(() => drawValveLineConnector(valve, line));
}

function setViewerEmptyState(visible) {
    if (!viewerEmptyState) return;
    viewerEmptyState.hidden = !visible;
    viewerEmptyState.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

// Scroll listener to update footer based on visible page
document.getElementById('viewer-container').addEventListener('scroll', debounce(updateFooterForVisiblePage, 200));
document.getElementById('viewer-container').addEventListener('scroll', () => {
    if (compareAttributeOverlay?.classList.contains('visible')) {
        hideCompareAttributeOverlay();
    }
}, { passive: true });

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

function toggleLineListTools() {
    const tools = document.getElementById('line-list-tools');
    const btn = document.getElementById('toggle-line-list-btn');
    if (!tools || !btn) return;

    tools.classList.toggle('collapsed');
    const isCollapsed = tools.classList.contains('collapsed');
    btn.textContent = isCollapsed ? 'Show' : 'Hide';
    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

function toggleSidebarSection(contentId, buttonId) {
    const content = document.getElementById(contentId);
    const btn = document.getElementById(buttonId);
    if (!content || !btn) return;

    content.classList.toggle('collapsed');
    const isCollapsed = content.classList.contains('collapsed');
    btn.textContent = isCollapsed ? 'Show' : 'Hide';
    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
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

function syncSidebarRail(isOpen, activeButtonId = null) {
    const sidebar = document.getElementById('sidebar');
    const title = document.getElementById('sidebar-view-title');
    const railButtons = document.querySelectorAll('#tool-rail > .tool-rail__button');
    const open = !!isOpen;

    if (sidebar) {
        sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (title) sidebar.setAttribute('aria-label', title.textContent.trim());
    }

    railButtons.forEach(button => {
        const isActive = open && button.id === activeButtonId;
        button.setAttribute('aria-expanded', isActive ? 'true' : 'false');
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

const SIDEBAR_VIEW_TITLES = {
    search: 'Search tools',
    projects: 'Projects and files',
    compare: 'Line list compare',
    table: 'P&ID table extraction',
    pipe: 'Pipe tracing'
};

function ensureSidebarSectionOpen(contentId, buttonId) {
    const content = document.getElementById(contentId);
    const button = document.getElementById(buttonId);
    if (!content || !button) return;

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        button.textContent = 'Hide';
        button.setAttribute('aria-expanded', 'true');
    }
}

function applySidebarViewSections(view) {
    document.querySelectorAll('#sidebar .sidebar-section[data-sidebar-view]').forEach(section => {
        const allowedViews = (section.dataset.sidebarView || '').split(/\s+/).filter(Boolean);
        section.hidden = !allowedViews.includes(view);
    });
}

function setSidebarView(view, railButtonId = null) {
    if (!SIDEBAR_VIEW_TITLES[view]) return;

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const isOpen = !document.body.classList.contains('sidebar-collapsed');
    const currentView = sidebar.dataset.toolView || 'search';
    if (isOpen && currentView === view) {
        toggleSidebar();
        return;
    }

    document.body.classList.remove('sidebar-collapsed');
    sidebar.dataset.toolView = view;
    applySidebarViewSections(view);

    const title = document.getElementById('sidebar-view-title');
    if (title) title.textContent = SIDEBAR_VIEW_TITLES[view];

    syncSidebarRail(true, railButtonId || `tool-rail-${view === 'search' ? 'search' : view}-btn`);

    if (view === 'compare') {
        ensureSidebarSectionOpen('line-list-tools', 'toggle-line-list-btn');
    } else if (view === 'table') {
        ensureSidebarSectionOpen('pid-table-extraction-tools', 'toggle-pid-table-extraction-btn');
    } else if (view === 'pipe') {
        ensureSidebarSectionOpen('pipe-tracing-tools', 'toggle-pipe-tracing-btn');
    } else if (view === 'projects') {
        projectMenu?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function toggleSidebar() {
    const isOpen = !document.body.classList.contains('sidebar-collapsed');
    if (isOpen) {
        document.body.classList.add('sidebar-collapsed');
        syncSidebarRail(false);
        return;
    }

    setSidebarView('search', 'tool-rail-search-btn');
}

function getActiveResultsRailButtonId() {
    return activeResultsView === 'valves' ? 'tool-rail-lists-btn' : 'tool-rail-found-tags-btn';
}

function hasValveLineResults() {
    const hasValves = allFoundTags.some(isValveAuditTag);
    const hasCompletedTrace = allFoundTags.some(item =>
        isTraceLineTag(item) && ['yes', 'review', 'no'].includes(item.traceStatus)
    );
    return hasValves && hasCompletedTrace;
}

function syncResultsRail(isOpen, activeButtonId = null) {
    const railButtons = document.querySelectorAll('#tool-rail .tool-rail__button--results');
    const hasValveLinks = hasValveLineResults();
    const open = !!isOpen;

    railButtons.forEach(button => {
        const isActive = open && button.id === activeButtonId;
        button.disabled = button.id === 'tool-rail-lists-btn' && !hasValveLinks;
        button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
        button.setAttribute('aria-expanded', isActive ? 'true' : 'false');
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setResultsSidebarOpen(isOpen) {
    document.body.classList.toggle('results-sidebar-collapsed', !isOpen);
    syncResultsRail(isOpen, isOpen ? getActiveResultsRailButtonId() : null);
}

function setResultsRailView(view, railButtonId = null) {
    if (view === 'valves' && !hasValveLineResults()) return;
    if (view === 'tables' && !pidTableRows.length) return;

    const isOpen = !document.body.classList.contains('results-sidebar-collapsed');
    const targetButtonId = railButtonId || (view === 'valves' ? 'tool-rail-lists-btn' : 'tool-rail-found-tags-btn');
    if (isOpen && getActiveResultsRailButtonId() === targetButtonId) {
        setResultsSidebarOpen(false);
        return;
    }

    showResultsView(view);
    setResultsSidebarOpen(true);
}

function toggleResultsSidebar() {
    const shouldOpen = document.body.classList.contains('results-sidebar-collapsed');
    setResultsSidebarOpen(shouldOpen);
}

const initialSidebarView = document.getElementById('sidebar')?.dataset.toolView || 'projects';
syncSidebarRail(!document.body.classList.contains('sidebar-collapsed'), `tool-rail-${initialSidebarView}-btn`);
applySidebarViewSections(initialSidebarView);
syncResultsRail(!document.body.classList.contains('results-sidebar-collapsed'));

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.body.classList.contains('sidebar-collapsed')) {
        toggleSidebar();
    }
});

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Store PDF name for export feature
    window.currentPDFName = file.name.replace(/\.pdf$/i, '');
    try {
        if (!activeProjectId) await renderProjects();
        await saveLocalPdf(file);
    } catch (storageError) {
        console.warn('Could not save PDF to local project library', storageError);
    }
    if (completionIcon) completionIcon.style.display = 'none';
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
    // Determine selected search modes (checkboxes; one or more).
    const selectedModes = Array.from(document.querySelectorAll('input[name="searchMode"]:checked'))
        .map(el => el.value);
    currentSearchModes = new Set(selectedModes);

    const patternSources = [];
    if (currentSearchModes.has('line')) {
        patternSources.push(LINE_TAG_PATTERN.source, LINE_TAG_PATTERN_ALT.source);
    }
    if (currentSearchModes.has('valve')) {
        patternSources.push(VALVE_TAG_PATTERN.source, VALVE_TAG_PATTERN_ALT.source);
    }
    if (currentSearchModes.has('actuated')) {
        patternSources.push(ACTUATED_VALVE_TAG_PATTERN.source);
    }

    if (patternSources.length === 0) {
        // Safe fallback if nothing is selected.
        patternSources.push(LINE_TAG_PATTERN.source, LINE_TAG_PATTERN_ALT.source);
    }

    activeTagPattern = new RegExp(patternSources.join('|'), 'g');

    // Reset UI/state so repeated searches don't require a refresh
    clearValveLineConnectionFocus();
    activeValveLineFocus = { valveId: null, lineId: null };
    pdfWrapper.innerHTML = '';
    setViewerEmptyState(false);
    resultList.innerHTML = '';
    footerList.innerHTML = '';
    allFoundTags = [];
    window.PipeTracing?.reset?.();
    resetCompareDrawerState();
    closeCompareDrawer();
    pidPageMeta.clear();
    pidTableRows = [];
    activePidTableRowId = null;
    clearPidTableHighlights();
    renderPidTableResults();
    showResultsView('tags');
    pdfDoc = null;
    currentPageNumber = 1;
    exportBtn.style.display = 'none';
    printBtn.style.display = 'none';
    if (extractPidTablesBtn) extractPidTablesBtn.disabled = true;
    if (exportPidTablesBtn) exportPidTablesBtn.disabled = true;
    setPidTableExtractionStatus('Reading the P&ID text layer is in progress.');

    // Busy UI
    if (searchAction) searchAction.hidden = true;
    if (searchBtn) searchBtn.disabled = true;
    fileInput.disabled = true;
    statusBar.textContent = 'Loading P&ID...';
    spinner.style.display = 'block';
    if (completionIcon) completionIcon.style.display = 'none';

    // Start each P&ID at the requested default zoom.
    currentZoom = DEFAULT_ZOOM;
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

        // Pipe tracing is opt-in and does not run here. This only gives the
        // tracing experiment access to the completed audit results.
        window.PipeTracing?.setDocumentReady?.(pdfDoc, allFoundTags);

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
            setResultsSidebarOpen(true);
        }
        if (completionIcon) completionIcon.style.display = 'block';
        if (extractPidTablesBtn) extractPidTablesBtn.disabled = false;
        
        // Collapse the footer by default after PDF loads
        const footer = document.getElementById('sticky-footer');
        if (footer) {
            footer.classList.add('collapsed');
        }

    } catch (err) {
        console.error(err);
        statusBar.textContent = 'Error: ' + err.message;
        setViewerEmptyState(true);
    } finally {
        spinner.style.display = 'none';
        fileInput.disabled = false;
        if (searchBtn) searchBtn.disabled = false;
        if (searchAction) searchAction.hidden = !pdfDoc;
        if (!pdfDoc && extractPidTablesBtn) extractPidTablesBtn.disabled = true;
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

    // --- REVISION EXTRACTION ---
    const REVISION_PATTERN = /^R\d{2,3}$/i;
    let sheetRevision = "";
    for (const item of textContent.items) {
        if (REVISION_PATTERN.test(item.str.trim())) {
            sheetRevision = item.str.trim().toUpperCase();
            break;
        }
    }

    pidPageMeta.set(pageNumber, {
        title: sheetTitle,
        revision: sheetRevision
    });

    // --- TAG EXTRACTION LOGIC ---
    let matchesCount = 0;
    for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
        const item = textContent.items[itemIndex];
        const text = item.str;
        activeTagPattern.lastIndex = 0;
        let match;
        let foundMatchInItem = false;

        while ((match = activeTagPattern.exec(text)) !== null) {
            foundMatchInItem = true;
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
            addSidebarItem(matchText, pageNumber, sheetTitle, sheetRevision, highlight, pdfRect, classifyTagType(matchText));
        }

        // Actuated valve fallback for split text items, e.g. "35PSV" on one line and "9015A" on the next.
        if (!foundMatchInItem && currentSearchModes.has('actuated') && itemIndex < textContent.items.length - 1) {
            const prefixToken = String(item.str || '').toUpperCase().replace(/\s+/g, '');
            const nextItem = textContent.items[itemIndex + 1];
            const suffixToken = String(nextItem?.str || '').toUpperCase().replace(/\s+/g, '');

            if (ACTUATED_PREFIX_PATTERN.test(prefixToken) && ACTUATED_SUFFIX_PATTERN.test(suffixToken)) {
                matchesCount++;
                const matchText = `${prefixToken} ${suffixToken}`;

                const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                const angleRad = Math.atan2(tx[1], tx[0]);
                const angleDeg = angleRad * (180 / Math.PI);

                const fontHeight = Math.sqrt(tx[2]*tx[2] + tx[3]*tx[3]);
                const totalItemWidth = item.width * RENDER_SCALE;

                const x = tx[4];
                const y = tx[5];

                const highlight = document.createElement('div');
                highlight.className = 'highlight-box';
                highlight.title = matchText;
                highlight.id = `hl-${allFoundTags.length}`;

                highlight.style.left = `${x}px`;
                highlight.style.top = `${y}px`;
                highlight.style.width = `${totalItemWidth}px`;
                highlight.style.height = `${fontHeight}px`;
                highlight.style.transform = `rotate(${angleDeg}deg) translateY(-100%)`;

                const pdfAngleRad = Math.atan2(item.transform[1], item.transform[0]);
                const pdfAngleDeg = pdfAngleRad * (180 / Math.PI);
                const pdfHeight = Math.sqrt(item.transform[2]*item.transform[2] + item.transform[3]*item.transform[3]);

                const pdfRect = {
                    x: item.transform[4],
                    y: item.transform[5],
                    width: item.width,
                    height: pdfHeight,
                    rotation: pdfAngleDeg
                };

                pageDiv.appendChild(highlight);
                addSidebarItem(matchText, pageNumber, sheetTitle, sheetRevision, highlight, pdfRect, classifyTagType(matchText));
            }
        }
    }
    
    // Update footer initially for page 1
    if (pageNumber === 1) updateFooterList(1);
    
    return matchesCount;
}

// ============================================
// P&ID TABLE EXTRACTION
// ============================================

function setPidTableExtractionStatus(text, state = '') {
    if (!pidTableExtractionStatus) return;
    pidTableExtractionStatus.textContent = text;
    pidTableExtractionStatus.className = `pid-table-extraction-status ${state}`.trim();
}

function showResultsView(view) {
    const previousView = activeResultsView;
    const showTables = view === 'tables' && pidTableRows.length > 0;
    const showValves = view === 'valves' && hasValveLineResults();
    activeResultsView = showTables ? 'tables' : showValves ? 'valves' : 'tags';
    document.body.classList.toggle('results-view-valves', showValves);

    if (tagResultsView) tagResultsView.hidden = showTables || showValves;
    if (valveLineResultsView) valveLineResultsView.hidden = !showValves;
    if (pidTableResultsView) pidTableResultsView.hidden = !showTables;
    if (resultsSidebarTitle) {
        resultsSidebarTitle.textContent = showTables
            ? 'P&ID table values'
            : showValves ? 'Valve–line connections' : 'Found tags';
    }

    if (showTagsViewBtn) {
        showTagsViewBtn.classList.toggle('active', !showTables && !showValves);
        showTagsViewBtn.setAttribute('aria-selected', !showTables && !showValves ? 'true' : 'false');
    }
    if (showValveLineViewBtn) {
        showValveLineViewBtn.classList.toggle('active', showValves);
        showValveLineViewBtn.setAttribute('aria-selected', showValves ? 'true' : 'false');
        showValveLineViewBtn.disabled = !hasValveLineResults();
    }
    if (showPidTableViewBtn) {
        showPidTableViewBtn.classList.toggle('active', showTables);
        showPidTableViewBtn.setAttribute('aria-selected', showTables ? 'true' : 'false');
        showPidTableViewBtn.disabled = pidTableRows.length === 0;
    }

    if (showValves) renderValveLineResults();
    if (previousView !== activeResultsView) {
        const resultsContainer = document.getElementById('results-container');
        if (resultsContainer) resultsContainer.scrollTop = 0;
    }

    syncResultsRail(
        !document.body.classList.contains('results-sidebar-collapsed'),
        getActiveResultsRailButtonId()
    );
}

function valveLineOptions(item) {
    if (!item || item.associationStatus === 'unassigned') return [];

    const options = [];
    const seen = new Set();
    const addOption = (label, lineId) => {
        const normalizedLabel = String(label || '').trim();
        const normalizedId = Number(lineId);
        if (!normalizedLabel || !Number.isInteger(normalizedId) || seen.has(normalizedLabel)) return;
        seen.add(normalizedLabel);
        options.push({ label: normalizedLabel, lineId: normalizedId });
    };

    addOption(item.associatedLineTag, item.associatedLineId);
    for (const candidate of item.associationCandidates || []) {
        addOption(candidate.lineTag, candidate.lineOccurrenceId);
    }
    return options.slice(0, item.associationStatus === 'review' ? 2 : 1);
}

function renderValveLineResults() {
    const tbody = valveLineResults?.querySelector('tbody');
    if (!tbody) return;
    tbody.replaceChildren();

    const valves = allFoundTags.filter(isValveAuditTag).sort((a, b) => {
        const order = { review: 0, unassigned: 1, assigned: 2 };
        return (order[a.associationStatus] ?? 3) - (order[b.associationStatus] ?? 3) || a.tag.localeCompare(b.tag);
    });
    if (valveLineResultsSummary) {
        valveLineResultsSummary.textContent = `${valveAssociationCounts.assigned} linked · ${valveAssociationCounts.review} review · ${valveAssociationCounts.unassigned} no link`;
    }
    const linkableCount = valves.filter(item => valveLineOptions(item).length).length;
    if (showAllValveLinksBtn) {
        const label = linkableCount ? `Show ${linkableCount} links` : 'Show links';
        showAllValveLinksBtn.dataset.defaultLabel = label;
        showAllValveLinksBtn.textContent = showAllValveLinksBtn.getAttribute('aria-pressed') === 'true' ? 'Hide links' : label;
        showAllValveLinksBtn.disabled = linkableCount === 0;
    }
    if (!linkableCount) clearValveLineConnectors();

    for (const item of valves) {
        const tr = document.createElement('tr');
        tr.dataset.valveId = String(item.id);
        tr.className = `valve-line-row status-${item.associationStatus || 'unassigned'}`;
        tr.classList.toggle('is-selected', item.id === activeValveLineFocus.valveId);
        tr.title = 'Show valve and line on P&ID';

        const valveCell = document.createElement('td');
        const valveTag = document.createElement('strong');
        valveTag.textContent = item.tag;
        const page = document.createElement('small');
        page.textContent = `Page ${item.page}`;
        valveCell.append(valveTag, page);

        const lineCell = document.createElement('td');
        const lineOptions = valveLineOptions(item);
        if (lineOptions.length) {
            lineOptions.forEach((line, index) => {
                if (index > 0) lineCell.appendChild(document.createElement('br'));
                const lineButton = document.createElement('button');
                lineButton.type = 'button';
                lineButton.dataset.lineId = String(line.lineId);
                lineButton.textContent = line.label;
                lineButton.title = 'Show this valve and line on P&ID';
                lineCell.appendChild(lineButton);
            });
        } else {
            lineCell.textContent = '—';
        }
        if (item.associationStatus !== 'unassigned' && item.associationConfidence !== null && Number.isFinite(Number(item.associationConfidence))) {
            const confidence = document.createElement('small');
            confidence.textContent = `${Math.round(Number(item.associationConfidence) * 100)}%`;
            lineCell.appendChild(confidence);
        }

        const statusCell = document.createElement('td');
        const info = valveAssociationStatusInfo(item.associationStatus, item.associationReason);
        const badge = document.createElement('span');
        badge.className = `trace-status-badge valve-status-${info.status}`;
        badge.textContent = info.label;
        badge.title = info.title;
        statusCell.appendChild(badge);
        if (lineOptions.length) {
            const showLinkButton = document.createElement('button');
            showLinkButton.type = 'button';
            showLinkButton.className = 'valve-line-show-link';
            showLinkButton.dataset.showLinkLineId = String(lineOptions[0].lineId);
            showLinkButton.textContent = 'Show link';
            showLinkButton.title = 'Draw valve-to-line guide';
            showLinkButton.setAttribute('aria-label', `Show link from ${item.tag} to ${lineOptions[0].label}`);
            statusCell.appendChild(showLinkButton);
        }

        tr.append(valveCell, lineCell, statusCell);
        tbody.appendChild(tr);
    }
}

function getPidTableTextBox(item) {
    const transform = item.transform || [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);
    const width = Number(item.width || 0);
    const height = Math.abs(Number(transform[3] || 0)) || Number(item.height || 0) || 10;

    return {
        text: String(item.str || ''),
        x,
        y,
        right: x + width,
        centerX: x + (width / 2),
        centerY: y,
        height
    };
}

function normalizePidTableText(text) {
    return String(text || '')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function compactPidTableText(text) {
    return normalizePidTableText(text).replace(/[^A-Z0-9]/g, '');
}

function buildPidTableLines(textItems) {
    const boxes = (textItems || [])
        .map(getPidTableTextBox)
        .filter(item => item.text.trim())
        .sort((a, b) => {
            if (Math.abs(a.centerY - b.centerY) > TABLE_LINE_Y_TOLERANCE) {
                return b.centerY - a.centerY;
            }
            return a.x - b.x;
        });

    const lines = [];
    for (const item of boxes) {
        let line = lines.find(candidate =>
            Math.abs(candidate.centerY - item.centerY) <= TABLE_LINE_Y_TOLERANCE
        );

        if (!line) {
            line = { centerY: item.centerY, items: [] };
            lines.push(line);
        }

        line.items.push(item);
        line.centerY = line.items.reduce((sum, entry) => sum + entry.centerY, 0) / line.items.length;
    }

    for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x);
        line.text = line.items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
    }

    return lines.sort((a, b) => b.centerY - a.centerY);
}

function findPidTableHeaderMatches(line) {
    const matches = [];

    for (const field of PID_TABLE_FIELDS) {
        const aliases = field.aliases
            .slice()
            .sort((a, b) => compactPidTableText(b).length - compactPidTableText(a).length);
        let found = null;

        for (const alias of aliases) {
            const aliasText = compactPidTableText(alias);

            for (let start = 0; start < line.items.length && !found; start++) {
                let combined = '';

                for (
                    let end = start;
                    end < Math.min(line.items.length, start + TABLE_MAX_HEADER_ITEMS);
                    end++
                ) {
                    combined += compactPidTableText(line.items[end].text);

                    if (combined === aliasText) {
                        found = {
                            fieldKey: field.key,
                            label: field.label,
                            startIndex: start,
                            endIndex: end,
                            left: line.items[start].x,
                            right: line.items[end].right,
                            center: (line.items[start].x + line.items[end].right) / 2
                        };
                        break;
                    }

                    if (combined.length > aliasText.length && !aliasText.startsWith(combined)) {
                        break;
                    }
                }
            }

            // Some PDF generators return the whole header plus punctuation
            // as one item. Accept that item when an exact sequence was not found.
            if (!found) {
                const item = line.items.find(entry => compactPidTableText(entry.text).includes(aliasText));
                if (item) {
                    found = {
                        fieldKey: field.key,
                        label: field.label,
                        startIndex: line.items.indexOf(item),
                        endIndex: line.items.indexOf(item),
                        left: item.x,
                        right: item.right,
                        center: (item.x + item.right) / 2
                    };
                }
            }

            if (found) break;
        }

        if (found) matches.push(found);
    }

    return matches;
}

function findPidTableHeaders(lines) {
    return lines
        .map((line, index) => ({
            index,
            line,
            matches: findPidTableHeaderMatches(line)
        }))
        .filter(header =>
            header.matches.some(match => match.fieldKey === 'itemTag') &&
            header.matches.some(match => match.fieldKey !== 'itemTag')
        );
}

function splitPidValueGroups(items) {
    const groups = [];
    const usableItems = (items || []).filter(item =>
        item.text.trim() && !isPidRevisionMarker(item.text)
    );

    for (const item of usableItems) {
        const previousGroup = groups[groups.length - 1];
        const previousItem = previousGroup?.items?.[previousGroup.items.length - 1];
        const gap = previousItem ? item.x - previousItem.right : Infinity;

        if (previousGroup && gap <= 35) {
            previousGroup.items.push(item);
        } else {
            groups.push({ items: [item] });
        }
    }

    return groups.map(group => ({
        items: group.items,
        text: group.items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()
    }));
}

function isPidRevisionMarker(text) {
    return /^R\d{1,3}$/i.test(String(text || '').trim());
}

function choosePidValueGroup(items, bounds = null) {
    let groups = splitPidValueGroups(items)
        .filter(group => group.text && !isPidRevisionMarker(group.text));

    if (!groups.length) return null;

    if (bounds) {
        groups = groups.filter(group => {
            const firstItem = group.items[0];
            return firstItem && firstItem.x >= bounds.left && firstItem.x <= bounds.right;
        });
    }

    // The first group after the label is the table value. Later groups are
    // often revision bubbles or notes elsewhere on the drawing.
    return groups[0] || null;
}

function findPidKeyValueOccurrences(lines) {
    const occurrences = [];

    lines.forEach((line, lineIndex) => {
        const matches = findPidTableHeaderMatches(line);

        // A key/value table has one recognized label per visual row. A line
        // containing several labels is treated as a horizontal table header.
        if (matches.length !== 1) return;

        occurrences.push({
            line,
            lineIndex,
            ...matches[0]
        });
    });

    return occurrences;
}

function findPidKeyValueBlocks(lines) {
    const occurrences = findPidKeyValueOccurrences(lines);
    const blocks = [];

    for (const occurrence of occurrences) {
        let block = blocks[blocks.length - 1];
        const previous = block?.occurrences?.[block.occurrences.length - 1];
        const sameLabelColumn = previous && Math.abs(previous.left - occurrence.left) <= 28;
        const verticalGap = previous
            ? Math.abs(previous.line.centerY - occurrence.line.centerY)
            : Infinity;
        const startsAnotherTable = previous &&
            verticalGap > 60 && occurrence.fieldKey === 'itemTag';
        const closeVertically = previous &&
            verticalGap <= TABLE_MAX_KEY_VALUE_GAP && !startsAnotherTable;

        if (!block || !sameLabelColumn || !closeVertically) {
            block = { occurrences: [] };
            blocks.push(block);
        }

        block.occurrences.push(occurrence);
    }

    return blocks
        .filter(block => {
            const fields = new Set(block.occurrences.map(occurrence => occurrence.fieldKey));
            const lineIndexes = new Set(block.occurrences.map(occurrence => occurrence.lineIndex));
            return fields.size >= 3 && lineIndexes.size >= 3;
        })
        .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

function getPidKeyValueBounds(block, lines = []) {
    let candidateGroups = block.occurrences
        .map(occurrence => choosePidValueGroup(occurrence.line.items.slice(occurrence.endIndex + 1)))
        .filter(Boolean);

    const labelRight = Math.max(...block.occurrences.map(occurrence => occurrence.right));

    // Some PDF generators place the value on the next text line instead of
    // sharing the label line. In that case, infer the value column from the
    // nearest right-side group in the block's vertical span.
    if (candidateGroups.length < 2 && lines.length) {
        const centers = block.occurrences.map(occurrence => occurrence.line.centerY);
        const minCenter = Math.min(...centers) - TABLE_MAX_KEY_VALUE_GAP;
        const maxCenter = Math.max(...centers) + TABLE_MAX_KEY_VALUE_GAP;
        const fallbackGroups = lines
            .filter(line => line.centerY <= maxCenter && line.centerY >= minCenter)
            .map(line => choosePidValueGroup(
                line.items.filter(item => item.x >= labelRight + 8)
            ))
            .filter(Boolean);
        const nearestValueStart = Math.min(
            ...fallbackGroups.map(group => group.items[0]?.x).filter(Number.isFinite)
        );
        candidateGroups = candidateGroups.concat(fallbackGroups.filter(group =>
            group.items[0]?.x <= nearestValueStart + 140
        ));
    }

    if (!candidateGroups.length) {
        return {
            left: labelRight + 4,
            right: labelRight + 4,
            labelRight
        };
    }

    const starts = candidateGroups
        .map(group => group.items[0]?.x)
        .filter(value => Number.isFinite(value))
        .sort((a, b) => a - b);
    const rights = candidateGroups
        .map(group => group.items[group.items.length - 1]?.right)
        .filter(value => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (!starts.length || !rights.length) return null;

    // The first value group on each known label row gives us the value
    // column. Use the outer observed edges rather than a fixed page-wide
    // range so nearby drawing notes cannot become table values.
    return {
        left: Math.min(...starts) - 24,
        right: Math.max(...rights) + 24,
        labelRight: Math.max(...block.occurrences.map(occurrence => occurrence.right))
    };
}

function findPidKeyValueRowAnchors(lines, block, valueBounds) {
    const occurrencesByLine = new Map(
        block.occurrences.map(occurrence => [occurrence.lineIndex, occurrence])
    );
    const labelLeft = Math.min(...block.occurrences.map(occurrence => occurrence.left));
    const knownLabelRight = Math.max(...block.occurrences.map(occurrence => occurrence.right));
    const labelRight = Math.max(knownLabelRight, (valueBounds?.left ?? knownLabelRight) - 8);
    const knownCenters = block.occurrences.map(occurrence => occurrence.line.centerY);
    const knownGaps = [];

    for (let index = 1; index < knownCenters.length; index++) {
        const gap = Math.abs(knownCenters[index - 1] - knownCenters[index]);
        if (gap > TABLE_LINE_Y_TOLERANCE) knownGaps.push(gap);
    }

    const median = values => values[Math.floor(values.length / 2)];
    const defaultGap = knownGaps.length
        ? Math.max(18, Math.min(60, median(knownGaps)))
        : 28;
    const minCenter = Math.min(...knownCenters) - defaultGap;
    const maxCenter = Math.max(...knownCenters) + defaultGap;
    const anchors = block.occurrences.map(occurrence => ({
        lineIndex: occurrence.lineIndex,
        centerY: occurrence.line.centerY,
        known: true
    }));

    // Use every left-column text row as a boundary, even when its label is
    // not in PID_TABLE_FIELDS. This prevents an unknown field between two
    // known fields from being swallowed by the previous field's value.
    lines.forEach((line, lineIndex) => {
        if (occurrencesByLine.has(lineIndex) || line.centerY > maxCenter || line.centerY < minCenter) return;

        const hasLeftColumnText = line.items.some(item =>
            item.x >= labelLeft - 45 &&
            item.x <= labelLeft + 55 &&
            item.right <= labelRight
        );

        if (hasLeftColumnText) {
            anchors.push({
                lineIndex,
                centerY: line.centerY,
                known: false
            });
        }
    });

    return anchors.sort((a, b) => b.centerY - a.centerY);
}

function buildPidKeyValueRowBands(lines, block, valueBounds) {
    const anchors = findPidKeyValueRowAnchors(lines, block, valueBounds);
    const gaps = [];

    for (let index = 1; index < anchors.length; index++) {
        const gap = Math.abs(anchors[index - 1].centerY - anchors[index].centerY);
        if (gap > TABLE_LINE_Y_TOLERANCE) gaps.push(gap);
    }

    const median = values => values[Math.floor(values.length / 2)];
    const defaultGap = gaps.length
        ? Math.max(18, Math.min(60, median(gaps)))
        : 28;
    const bands = new Map();

    anchors.forEach((anchor, index) => {
        const previous = anchors[index - 1];
        const next = anchors[index + 1];
        const top = previous
            ? (previous.centerY + anchor.centerY) / 2
            : anchor.centerY + (defaultGap / 2);
        const bottom = next
            ? (anchor.centerY + next.centerY) / 2
            : anchor.centerY - (defaultGap / 2);

        bands.set(anchor.lineIndex, { top, bottom });
    });

    return bands;
}

function collectPidKeyValueCell(lines, occurrence, valueBounds, rowBand) {
    const valueItems = [];
    const valueLeft = Math.max(
        valueBounds?.left ?? occurrence.right + 20,
        valueBounds?.labelRight ? valueBounds.labelRight + 4 : occurrence.right + 20
    );
    const valueRight = valueBounds?.right ?? Infinity;
    const top = rowBand?.top ?? occurrence.line.centerY + 36;
    const bottom = rowBand?.bottom ?? occurrence.line.centerY - 36;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (!line) continue;

        if (line.centerY > top || line.centerY < bottom) continue;

        for (let itemIndex = 0; itemIndex < line.items.length; itemIndex++) {
            const item = line.items[itemIndex];
            if (lineIndex === occurrence.lineIndex && itemIndex <= occurrence.endIndex) continue;
            if (item.x < valueLeft || item.x > valueRight) continue;
            if (isPidRevisionMarker(item.text)) continue;
            valueItems.push(item);
        }
    }

    return {
        items: valueItems,
        text: valueItems.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()
    };
}

function extractPidKeyValueRows(lines, pageNumber, pageLabel) {
    const blocks = findPidKeyValueBlocks(lines);
    const rows = [];

    for (const block of blocks) {
        const values = {};
        const boxes = {};
        const labelBoxes = {};
        for (const field of PID_TABLE_FIELDS) {
            values[field.key] = '';
            boxes[field.key] = [];
            labelBoxes[field.key] = [];
        }

        const blockOccurrences = block.occurrences;
        const valueBounds = getPidKeyValueBounds(block, lines);
        const rowBands = buildPidKeyValueRowBands(lines, block, valueBounds);
        for (const occurrence of blockOccurrences) {
            const cell = collectPidKeyValueCell(
                lines,
                occurrence,
                valueBounds,
                rowBands.get(occurrence.lineIndex)
            );
            labelBoxes[occurrence.fieldKey].push(
                ...occurrence.line.items.slice(occurrence.startIndex, occurrence.endIndex + 1)
            );
            if (!cell.items.length) continue;

            if (values[occurrence.fieldKey] && cell.text) {
                values[occurrence.fieldKey] = `${values[occurrence.fieldKey]} ${cell.text}`
                    .replace(/\s+/g, ' ')
                    .trim();
            } else {
                values[occurrence.fieldKey] = cell.text;
            }
            boxes[occurrence.fieldKey].push(...cell.items);
        }

        if (!values.itemTag) continue;

        const row = {
            id: -1,
            page: pageNumber,
            pid: pageLabel,
            values,
            boxes,
            labelBoxes,
            flags: [],
            status: 'complete',
            anchorY: blockOccurrences[0].line.centerY,
            rawText: blockOccurrences.map(occurrence => occurrence.line.text).join(' '),
            tagMatchCount: 1,
            headerIndex: blockOccurrences[0].lineIndex
        };

        refreshPidTableRowStatus(row);
        rows.push(row);
    }

    return rows;
}

function buildPidTableColumns(header) {
    const matches = header.matches
        .slice()
        .sort((a, b) => a.center - b.center);

    return matches.map((match, index) => ({
        fieldKey: match.fieldKey,
        label: match.label,
        left: index === 0 ? -Infinity : (matches[index - 1].center + match.center) / 2,
        right: index === matches.length - 1 ? Infinity : (match.center + matches[index + 1].center) / 2
    }));
}

function assignPidTableLineToColumns(line, columns) {
    const cells = {};
    for (const field of PID_TABLE_FIELDS) {
        cells[field.key] = { items: [], text: '' };
    }

    for (const item of line.items) {
        const column = columns.find(candidate =>
            item.centerX >= candidate.left && item.centerX < candidate.right
        );
        if (!column || !cells[column.fieldKey]) continue;
        cells[column.fieldKey].items.push(item);
    }

    for (const field of PID_TABLE_FIELDS) {
        cells[field.key].text = cells[field.key].items
            .map(item => item.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return cells;
}

function extractPidTableTags(text, allowPlainValue = false) {
    const candidate = normalizePidTableText(text).replace(/\s+/g, '');
    const lineTagPattern = new RegExp(TABLE_LINE_TAG_RE.source, 'ig');
    const lineTags = candidate.match(lineTagPattern) || [];
    if (lineTags.length) return lineTags;

    const genericCandidate = normalizePidTableText(text);
    const genericPattern = new RegExp(GENERIC_ITEM_TAG_RE.source, 'ig');
    const genericTags = genericCandidate.match(genericPattern) || [];
    if (!allowPlainValue) return genericTags;

    const plainValue = genericCandidate.trim();
    return plainValue && !isPidRevisionMarker(plainValue) ? [plainValue] : [];
}

function appendPidTableCell(row, fieldKey, cell) {
    if (!cell || !cell.items.length) return;

    const value = cell.text.trim();
    if (value && row.values[fieldKey] && row.values[fieldKey] !== value) {
        row.values[fieldKey] = `${row.values[fieldKey]} ${value}`.replace(/\s+/g, ' ').trim();
    } else if (value && !row.values[fieldKey]) {
        row.values[fieldKey] = value;
    }

    row.boxes[fieldKey].push(...cell.items);
}

function createPidTableRow(pageNumber, header, line, cells, tagMatches, pageLabel) {
    const values = {};
    const boxes = {};
    const labelBoxes = {};
    for (const field of PID_TABLE_FIELDS) {
        values[field.key] = '';
        boxes[field.key] = [];
        labelBoxes[field.key] = [];

        const headerMatch = header.matches.find(match => match.fieldKey === field.key);
        if (headerMatch) {
            labelBoxes[field.key].push(
                ...header.line.items.slice(headerMatch.startIndex, headerMatch.endIndex + 1)
            );
        }
    }

    const row = {
        id: -1,
        page: pageNumber,
        pid: pageLabel,
        values,
        boxes,
        labelBoxes,
        flags: [],
        status: 'complete',
        anchorY: line.centerY,
        rawText: line.text,
        tagMatchCount: tagMatches.length,
        headerIndex: header.index
    };

    for (const field of PID_TABLE_FIELDS) {
        appendPidTableCell(row, field.key, cells[field.key]);
    }

    row.values.itemTag = tagMatches[0] || row.values.itemTag;

    for (const field of PID_TABLE_FIELDS) {
        if (!row.values[field.key]) row.flags.push(`${field.label} missing`);
    }
    if (tagMatches.length > 1) row.flags.push('Multiple item tags in row');

    if (tagMatches.length > 1) row.status = 'ambiguous';
    else if (row.flags.length) row.status = 'review';

    return row;
}

function refreshPidTableRowStatus(row) {
    row.flags = [];
    for (const field of PID_TABLE_FIELDS) {
        if (!row.values[field.key]) row.flags.push(`${field.label} missing`);
    }

    if (row.tagMatchCount > 1) row.flags.push('Multiple item tags in row');

    if (row.tagMatchCount > 1) row.status = 'ambiguous';
    else if (row.flags.length) row.status = 'review';
    else row.status = 'complete';
}

function collectPidTableRowsForHeader(lines, header, pageNumber, pageLabel, nextHeader) {
    const columns = buildPidTableColumns(header);
    const rows = [];
    let currentRow = null;
    const endIndex = nextHeader ? nextHeader.index : lines.length;

    for (let index = header.index + 1; index < endIndex; index++) {
        const line = lines[index];
        if (!line || line.centerY >= header.line.centerY - TABLE_LINE_Y_TOLERANCE) continue;

        const cells = assignPidTableLineToColumns(line, columns);
        const cellTagMatches = extractPidTableTags(cells.itemTag.text, true);
        const fullLineMatches = extractPidTableTags(line.text);
        const tagMatches = cellTagMatches.length ? cellTagMatches : fullLineMatches;

        if (tagMatches.length) {
            currentRow = createPidTableRow(pageNumber, header, line, cells, tagMatches, pageLabel);
            rows.push(currentRow);
            continue;
        }

        if (!currentRow) continue;

        const verticalDistance = currentRow.anchorY - line.centerY;
        const hasContinuationText = PID_TABLE_FIELDS
            .filter(field => field.key !== 'itemTag')
            .some(field => cells[field.key].text);

        // A wrapped cell belongs to the previous row only when it is close to
        // that row and has content in one of the recognized table columns.
        if (verticalDistance >= 0 && verticalDistance <= 24 && hasContinuationText) {
            for (const field of PID_TABLE_FIELDS) {
                if (field.key !== 'itemTag') {
                    appendPidTableCell(currentRow, field.key, cells[field.key]);
                }
            }
            currentRow.rawText = `${currentRow.rawText} ${line.text}`.replace(/\s+/g, ' ').trim();
        } else if (verticalDistance > 24) {
            currentRow = null;
        }
    }

    rows.forEach(refreshPidTableRowStatus);
    return rows;
}

function dedupePidTableRows(rows) {
    const unique = new Map();

    for (const row of rows) {
        const key = `${row.page}|${normalizeTagValue(row.values.itemTag)}|${Math.round(row.anchorY / 4)}`;
        const previous = unique.get(key);
        if (!previous || row.rawText.length > previous.rawText.length) {
            unique.set(key, row);
        }
    }

    return Array.from(unique.values())
        .sort((a, b) => (a.page - b.page) || (b.anchorY - a.anchorY))
        .map((row, index) => ({ ...row, id: index }));
}

function getPidPageLabel(pageNumber) {
    const title = pidPageMeta.get(pageNumber)?.title;
    if (title && title !== 'Unknown Title') return title;
    return `${window.currentPDFName || 'P&ID'} - page ${pageNumber}`;
}

async function extractPidTables() {
    if (!pdfDoc) {
        showToast('Load and scan a P&ID before extracting tables', 'warning');
        return;
    }

    if (extractPidTablesBtn) extractPidTablesBtn.disabled = true;
    if (exportPidTablesBtn) exportPidTablesBtn.disabled = true;
    pidTableRows = [];
    activePidTableRowId = null;
    clearPidTableHighlights();
    renderPidTableResults();
    setPidTableExtractionStatus('Starting table extraction...');

    try {
        const extractedRows = [];

        for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
            setPidTableExtractionStatus(`Reading table text from page ${pageNumber} of ${pdfDoc.numPages}...`);
            const page = await pdfDoc.getPage(pageNumber);
            const content = await page.getTextContent();
            const lines = buildPidTableLines(content.items || []);
            const headers = findPidTableHeaders(lines);
            const pageLabel = getPidPageLabel(pageNumber);

            // Support vertical two-column attribute tables where each label
            // is on its own row and its value is on the right.
            const keyValueRows = extractPidKeyValueRows(lines, pageNumber, pageLabel);
            extractedRows.push(...keyValueRows);

            // A page with a recognized key/value table should not also be
            // interpreted as a horizontal row table; that can create a
            // duplicate row with values taken from unrelated drawing notes.
            if (!keyValueRows.length) {
                for (let headerIndex = 0; headerIndex < headers.length; headerIndex++) {
                    const header = headers[headerIndex];
                    const nextHeader = headers.find(candidate => candidate.index > header.index);
                    extractedRows.push(...collectPidTableRowsForHeader(
                        lines,
                        header,
                        pageNumber,
                        pageLabel,
                        nextHeader
                    ));
                }
            }
        }

        pidTableRows = dedupePidTableRows(extractedRows);
        renderPidTableResults();

        if (!pidTableRows.length) {
            setPidTableExtractionStatus(
                'No matching table headers and line-tag rows were found. The PDF must contain searchable text.',
                'warning'
            );
            showResultsView('tags');
            return;
        }

        if (exportPidTablesBtn) exportPidTablesBtn.disabled = false;
        setResultsSidebarOpen(true);
        showResultsView('tables');

        const reviewCount = pidTableRows.filter(row => row.status !== 'complete').length;
        const pageCount = new Set(pidTableRows.map(row => row.page)).size;
        setPidTableExtractionStatus(
            `Found ${pidTableRows.length} row(s) on ${pageCount} page(s). ${reviewCount} row(s) need review.`,
            reviewCount ? 'warning' : 'ok'
        );
    } catch (error) {
        console.error('P&ID table extraction failed:', error);
        setPidTableExtractionStatus(`Table extraction failed: ${error.message || error}`, 'error');
        showToast('P&ID table extraction failed', 'error');
    } finally {
        if (extractPidTablesBtn) extractPidTablesBtn.disabled = false;
    }
}

function renderPidTableResults() {
    if (!pidTableResults) return;
    const thead = pidTableResults.querySelector('thead');
    const tbody = pidTableResults.querySelector('tbody');
    if (!thead || !tbody) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    const headerRow = document.createElement('tr');
    for (const label of ['P&ID', 'Page', ...PID_TABLE_FIELDS.map(field => field.label), 'Status']) {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const completeCount = pidTableRows.filter(row => row.status === 'complete').length;
    const reviewCount = pidTableRows.length - completeCount;
    if (pidTableResultsSummary) {
        pidTableResultsSummary.textContent = pidTableRows.length
            ? `${pidTableRows.length} row(s) | ${completeCount} complete | ${reviewCount} for review`
            : 'No P&ID table data loaded.';
    }

    for (const row of pidTableRows) {
        const tr = document.createElement('tr');
        tr.dataset.tableRowId = String(row.id);
        tr.className = row.status === 'complete' ? '' : 'review';
        if (row.id === activePidTableRowId) tr.classList.add('active');
        tr.title = row.flags.length ? row.flags.join(' | ') : 'Click to locate this row on the P&ID';

        const values = [row.pid, String(row.page), ...PID_TABLE_FIELDS.map(field => row.values[field.key])];
        for (const value of values) {
            const td = document.createElement('td');
            td.textContent = value || '—';
            tr.appendChild(td);
        }

        const statusCell = document.createElement('td');
        const status = document.createElement('span');
        status.className = `pid-table-status ${row.status}`;
        status.textContent = row.status === 'complete'
            ? 'Complete'
            : row.status === 'ambiguous'
                ? 'Ambiguous'
                : 'Review';
        statusCell.appendChild(status);
        tr.appendChild(statusCell);
        tbody.appendChild(tr);
    }

    if (showPidTableViewBtn) showPidTableViewBtn.disabled = pidTableRows.length === 0;
}

function clearPidTableHighlights() {
    document.querySelectorAll('.pid-table-highlight').forEach(element => element.remove());
}

function getPidTableViewportRect(box, viewport) {
    const rect = viewport.convertToViewportRectangle([
        box.x,
        box.y,
        box.right,
        box.y + box.height
    ]);

    return {
        left: Math.min(rect[0], rect[2]),
        top: Math.min(rect[1], rect[3]),
        width: Math.abs(rect[2] - rect[0]),
        height: Math.abs(rect[3] - rect[1])
    };
}

async function renderPidTableRowHighlight(row) {
    clearPidTableHighlights();
    if (!row || !pdfDoc) return null;

    const pageDiv = document.getElementById(`page-${row.page}`);
    if (!pageDiv) return null;

    const page = await pdfDoc.getPage(row.page);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    let firstHighlight = null;

    for (const field of PID_TABLE_FIELDS) {
        const boxes = [
            ...(row.labelBoxes?.[field.key] || []).map(box => ({ box, kind: 'label' })),
            ...(row.boxes?.[field.key] || []).map(box => ({ box, kind: 'value' }))
        ];

        for (const entry of boxes) {
            const box = entry.box;
            const rect = getPidTableViewportRect(box, viewport);
            const highlight = document.createElement('div');
            highlight.className = `pid-table-highlight ${field.colorClass} pid-table-${entry.kind}-highlight`;
            highlight.title = `${field.label}: ${entry.kind === 'label' ? 'attribute label' : (row.values[field.key] || 'value')}`;
            highlight.style.left = `${rect.left}px`;
            highlight.style.top = `${rect.top}px`;
            highlight.style.width = `${Math.max(3, rect.width)}px`;
            highlight.style.height = `${Math.max(3, rect.height)}px`;
            pageDiv.appendChild(highlight);
            if (!firstHighlight) firstHighlight = highlight;
        }
    }

    return firstHighlight;
}

async function jumpToPidTableRow(rowId) {
    const row = pidTableRows.find(candidate => candidate.id === rowId);
    if (!row) return;

    activePidTableRowId = row.id;
    renderPidTableResults();
    showResultsView('tables');

    const pageDiv = document.getElementById(`page-${row.page}`);
    if (pageDiv) {
        pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pageDiv.style.transition = 'box-shadow 0.25s ease';
        pageDiv.style.boxShadow = '0 0 0 4px rgba(37, 99, 235, 0.65), 0 8px 24px rgba(23, 38, 53, 0.16)';
        setTimeout(() => {
            pageDiv.style.boxShadow = '';
        }, 1200);
    }

    const firstHighlight = await renderPidTableRowHighlight(row);
    if (firstHighlight) {
        firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function exportPidTablesToCsv() {
    if (!pidTableRows.length) {
        showToast('Extract P&ID table data first', 'warning');
        return;
    }

    const rows = [[
        'P&ID',
        'Page',
        ...PID_TABLE_FIELDS.map(field => field.label),
        'Status',
        'Review notes'
    ]];

    for (const row of pidTableRows) {
        rows.push([
            row.pid,
            row.page,
            ...PID_TABLE_FIELDS.map(field => row.values[field.key]),
            row.status,
            row.flags.join('; ')
        ]);
    }

    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const fileName = `${window.currentPDFName || 'pid'}_table_values.csv`;
    downloadBlob(blob, fileName);
    try {
        const savedToFolder = await saveProjectArtifact(blob, '03_Reports', fileName, 'report');
        showToast(`Exported ${pidTableRows.length} table row(s)${savedToFolder ? ' and saved to project Reports' : ''}`, 'success');
    } catch (error) {
        console.warn('Could not save table report to project folder', error);
        showToast(`Exported ${pidTableRows.length} table row(s)`, 'success');
    }
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

function addSidebarItem(text, pageNum, title, revision, highlightElement, pdfRect, tagType = 'unknown') {
    const id = allFoundTags.length;
    if (highlightElement) highlightElement.classList.add(`tag-type-${tagType}`);

    allFoundTags.push({ 
        id: id, 
        tag: text, 
        page: pageNum, 
        title: title,
        revision: revision,
        tagType: tagType,
        status: 'Pending',
        traceStatus: 'untraced',
        traceSummary: '',
        traceReason: '',
        traceDetails: null,
        traceComment: '',
        associationStatus: tagType === 'valve' || tagType === 'actuated' ? 'unassigned' : '',
        associatedLineTag: '',
        associatedLineId: null,
        associationConfidence: null,
        associationReason: '',
        associationMethod: '',
        associationCandidates: [],
        associatedValves: [],
        valvesForReview: [],
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

    renderSidebarSheetGroups(allFoundTags);
}

function renderSidebarSheetGroups(tags) {
    const sheets = new Map();

    for (const item of tags) {
        const sheetTitle = item.title || 'Unknown Title';
        let sheet = sheets.get(sheetTitle);
        if (!sheet) {
            sheet = { title: sheetTitle, pages: new Map() };
            sheets.set(sheetTitle, sheet);
        }

        let pageTags = sheet.pages.get(item.page);
        if (!pageTags) {
            pageTags = [];
            sheet.pages.set(item.page, pageTags);
        }
        pageTags.push(item);
    }

    const orderedSheets = Array.from(sheets.values()).sort((a, b) => {
        const aPage = Math.min(...Array.from(a.pages.keys()));
        const bPage = Math.min(...Array.from(b.pages.keys()));
        return aPage - bPage || a.title.localeCompare(b.title);
    });

    for (const sheet of orderedSheets) {
        const sheetGroup = document.createElement('li');
        sheetGroup.className = 'sheet-group';

        const totalTags = Array.from(sheet.pages.values())
            .reduce((count, pageTags) => count + pageTags.length, 0);

        sheetGroup.innerHTML = `
            <div class="sheet-group-header">
                <span class="sheet-group-title">${escapeHtml(sheet.title)}</span>
                <span class="sheet-group-count">${totalTags} tag${totalTags === 1 ? '' : 's'}</span>
            </div>
        `;

        const pagesList = document.createElement('div');
        pagesList.className = 'sheet-pages';

        const orderedPages = Array.from(sheet.pages.entries()).sort(([a], [b]) => a - b);
        for (const [page, pageTags] of orderedPages) {
            const pageGroup = document.createElement('section');
            pageGroup.className = 'sheet-page-group';
            pageGroup.innerHTML = `<div class="sheet-page-label">Page ${page}</div>`;

            const tagList = document.createElement('ul');
            tagList.className = 'sheet-tag-list';
            if (duplicateMode === 'unique') {
                createGroupedView(pageTags)
                    .forEach(group => renderSidebarGroupedItem(group, tagList, false));
            } else {
                pageTags.forEach(item => renderSidebarOccurrenceItem(item, tagList, false));
            }
            pageGroup.appendChild(tagList);
            pagesList.appendChild(pageGroup);
        }

        sheetGroup.appendChild(pagesList);
        resultList.appendChild(sheetGroup);
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
                titles: new Set(),
                revisions: new Set()
            };
            map.set(key, g);
        }
        g.occurrences.push(t);
        g.pages.add(t.page);
        if (t.title) g.titles.add(t.title);
        if (t.revision) g.revisions.add(t.revision);
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
        g.traceStatus = summarizeTraceStatus(g.occurrences);
        g.associationStatus = summarizeValveAssociationStatus(g.occurrences);
        g.traceCommentCount = g.occurrences.filter(o => String(o.traceComment || '').trim()).length;
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

function isTraceLineTag(item) {
    return item && (item.tagType === 'line' || TABLE_LINE_TAG_RE.test(String(item.tag || '')));
}

function isValveAuditTag(item) {
    return item && (item.tagType === 'valve' || item.tagType === 'actuated');
}

function summarizeValveAssociationStatus(items) {
    const valves = (items || []).filter(isValveAuditTag);
    if (!valves.length) return '';
    const statuses = valves.map(item => item.associationStatus || 'unassigned');
    if (statuses.includes('review')) return 'review';
    if (statuses.includes('unassigned')) return 'unassigned';
    return statuses.every(status => status === 'assigned') ? 'assigned' : 'unassigned';
}

function summarizeTraceStatus(items) {
    const statuses = (items || []).map(item => item.traceStatus || 'untraced');
    if (statuses.includes('no')) return 'no';
    if (statuses.includes('review')) return 'review';
    if (statuses.includes('running')) return 'running';
    if (statuses.length > 0 && statuses.every(status => status === 'yes')) return 'yes';
    return 'untraced';
}

function traceStatusInfo(status, reason = '') {
    const normalized = ['yes', 'review', 'no', 'running'].includes(status) ? status : 'untraced';
    const values = {
        yes: { label: 'YES', title: 'Line tracing completed without an ambiguity stop.' },
        review: { label: 'REVIEW', title: 'Line tracing reached a tee, crossing, or uncertain continuation.' },
        no: { label: 'NO', title: 'No usable line geometry was found, or tracing failed.' },
        running: { label: 'RUN', title: 'Line tracing is in progress.' },
        untraced: { label: '—', title: 'Line tracing has not been run.' }
    };
    const info = values[normalized];
    return {
        status: normalized,
        label: info.label,
        title: reason ? `${info.title} ${reason}` : info.title
    };
}

function traceStatusBadgeMarkup(status, reason = '', extraAttributes = '') {
    const info = traceStatusInfo(status, reason);
    return `<span class="trace-status-badge trace-status-${info.status}" title="${escapeHtml(info.title)}" ${extraAttributes}>${info.label}</span>`;
}

function valveAssociationStatusInfo(status, reason = '') {
    const normalized = ['assigned', 'review', 'unassigned'].includes(status) ? status : 'unassigned';
    const values = {
        assigned: { label: 'LINKED', title: 'Valve is linked to one uniquely nearest traced line.' },
        review: { label: 'REVIEW', title: 'Valve-to-line association needs engineering review.' },
        unassigned: { label: 'NO LINK', title: 'Valve is not linked to a traced line.' }
    };
    const info = values[normalized];
    return {
        status: normalized,
        label: info.label,
        title: reason ? `${info.title} ${String(reason).replace(/-/g, ' ')}.` : info.title
    };
}

function valveAssociationBadgeMarkup(status, reason = '', extraAttributes = '') {
    const info = valveAssociationStatusInfo(status, reason);
    return `<span class="trace-status-badge valve-status-${info.status}" title="${escapeHtml(info.title)}" ${extraAttributes}>${info.label}</span>`;
}

function analysisBadgeMarkup(item) {
    if (isTraceLineTag(item)) {
        return traceStatusBadgeMarkup(item.traceStatus, item.traceReason, `data-trace-status-badge="${item.id}"`);
    }
    if (isValveAuditTag(item)) {
        return valveAssociationBadgeMarkup(
            item.associationStatus,
            item.associationReason,
            `data-valve-status-badge="${item.id}"`
        );
    }
    return '';
}

function itemAnalysisSummary(item) {
    if (isTraceLineTag(item)) {
        const parts = [];
        const traceSummary = String(item.traceSummary || '').trim();
        if (traceSummary) parts.push(traceSummary);
        const assignedCount = item.associatedValves?.length || 0;
        const reviewCount = item.valvesForReview?.length || 0;
        if (assignedCount || reviewCount) {
            parts.push(`Valves: ${assignedCount} linked${reviewCount ? `, ${reviewCount} review` : ''}`);
        }
        return parts.join(' · ');
    }

    if (isValveAuditTag(item)) {
        if (item.associationStatus === 'assigned') {
            const confidence = Number.isFinite(Number(item.associationConfidence))
                ? ` · ${Math.round(Number(item.associationConfidence) * 100)}%`
                : '';
            return `Line ${item.associatedLineTag || 'unknown'}${confidence}`;
        }
        const candidateNames = Array.from(new Set((item.associationCandidates || [])
            .map(candidate => candidate.lineTag)
            .filter(Boolean)));
        if (item.associationStatus === 'review' && candidateNames.length) {
            return `Candidate lines: ${candidateNames.slice(0, 3).join(', ')}`;
        }
        return 'No traced line association';
    }

    return '';
}

function groupedAnalysisSummary(group) {
    if (group.occurrences.some(isTraceLineTag)) {
        const summaries = Array.from(new Set(group.occurrences.map(itemAnalysisSummary).filter(Boolean)));
        return summaries.length === 1
            ? summaries[0]
            : summaries.length > 1
                ? `${summaries.length} trace/valve results — use Count all for details`
                : '';
    }
    if (group.occurrences.some(isValveAuditTag)) {
        const lines = Array.from(new Set(group.occurrences.map(item => item.associatedLineTag).filter(Boolean)));
        if (group.associationStatus === 'assigned' && lines.length === 1) return `Line ${lines[0]}`;
        if (lines.length) return `Line candidates: ${lines.join(', ')}`;
        return 'No traced line association';
    }
    return '';
}

function traceCommentButtonMarkup(item) {
    const comment = String(item.traceComment || '');
    const hasComment = Boolean(comment.trim());
    const label = hasComment ? 'Edit trace comment' : 'Add trace comment';
    return `<button class="trace-comment-toggle${hasComment ? ' has-comment' : ''}" type="button" data-tag-id="${item.id}" aria-expanded="${hasComment ? 'true' : 'false'}" aria-label="${label}" title="${label}">💬</button>`;
}

function traceCommentEditorMarkup(item, placeholder = 'Add a note about this trace') {
    const comment = String(item.traceComment || '');
    const hasComment = Boolean(comment.trim());
    return `
        <div class="trace-comment-editor" data-trace-comment-editor="${item.id}"${hasComment ? '' : ' hidden'}>
            <input class="trace-comment-input" type="text" data-tag-id="${item.id}" value="${escapeHtml(comment)}" placeholder="${escapeHtml(placeholder)}" aria-label="Comment for ${escapeHtml(item.tag)}">
        </div>
    `;
}

function wireTraceCommentEditor(container, item) {
    const toggle = container.querySelector('.trace-comment-toggle');
    const editor = container.querySelector(`[data-trace-comment-editor="${item.id}"]`);
    const input = editor?.querySelector('.trace-comment-input');
    if (!toggle || !editor || !input) return;

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = !editor.hidden;
        editor.hidden = isOpen;
        toggle.setAttribute('aria-expanded', String(!isOpen));
        if (!isOpen) input.focus();
    });

    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            editor.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
            event.stopPropagation();
        }
    });
    input.addEventListener('input', () => {
        item.traceComment = input.value;
        const hasComment = Boolean(input.value.trim());
        toggle.classList.toggle('has-comment', hasComment);
        toggle.title = hasComment ? 'Edit trace comment' : 'Add trace comment';
        updateTraceResultsToolbar();
    });
}

function renderSidebarOccurrenceItem(item, targetList = resultList, showMeta = true) {
    const li = document.createElement('li');
    li.className = 'result-item';
    li.dataset.tagId = item.id;

    const safeTitle = item.title || 'Unknown Title';
    const analysisSummary = itemAnalysisSummary(item);
    li.innerHTML = `
        <div class="result-main">
            <div class="tag-line">
                <div class="tag" title="Click to jump to this tag in the PDF">${escapeHtml(item.tag)}</div>
            </div>
            <div class="meta">Sheet: ${escapeHtml(safeTitle)} · Page: ${item.page}</div>
            <div class="trace-summary" data-trace-summary="${item.id}"${analysisSummary ? '' : ' hidden'}>${escapeHtml(analysisSummary)}</div>
        </div>
        <div class="result-actions">
            ${analysisBadgeMarkup(item)}
            ${traceCommentButtonMarkup(item)}
            <button class="btn-mini correct" title="Approve" onclick="setStatus(event, ${item.id}, 'Correct', this)">✓</button>
            <button class="btn-mini incorrect" title="Reject" onclick="setStatus(event, ${item.id}, 'Incorrect', this)">✗</button>
        </div>
        ${traceCommentEditorMarkup(item)}
    `;

    if (!showMeta) li.querySelector('.meta')?.remove();

    // Apply current status styling
    applyStatusClasses(li, item.status);
    updateStatusButtonsForContainer(li, item.status);
    wireTraceCommentEditor(li, item);

    li.addEventListener('click', () => {
        window.PipeTracing?.selectTag?.(item);
        focusPdfTag(item);
    });

    targetList.appendChild(li);
}

function renderSidebarGroupedItem(group, targetList = resultList, showMeta = true) {
    const li = document.createElement('li');
    li.className = 'result-item';
    const firstOccurrence = group.occurrences[0];
    const commentLabel = group.traceCommentCount
        ? `${group.traceCommentCount} trace comment${group.traceCommentCount === 1 ? '' : 's'}`
        : 'Add trace comment';
    const analysisSummary = groupedAnalysisSummary(group);
    const groupBadge = firstOccurrence && isTraceLineTag(firstOccurrence)
        ? traceStatusBadgeMarkup(group.traceStatus, '', `data-trace-group-status="${escapeHtml(group.tag)}"`)
        : firstOccurrence && isValveAuditTag(firstOccurrence)
            ? valveAssociationBadgeMarkup(group.associationStatus, '', `data-valve-group-status="${escapeHtml(group.tag)}"`)
            : '';

    const titles = Array.from(group.titles);
    const titleLabel = titles.length ? titles.join(' | ') : 'Unknown Title';
    const pages = Array.from(group.pages).sort((a, b) => a - b);

    li.innerHTML = `
        <div class="result-main">
            <div class="tag-line">
                <div class="tag" title="Click to jump to this tag in the PDF">${escapeHtml(group.tag)}</div>
            </div>
            <div class="meta">Sheets: ${escapeHtml(titleLabel)} · Pages: ${pages.join(', ')} · Count: ${group.occurrences.length}</div>
            <div class="trace-summary"${analysisSummary ? '' : ' hidden'}>${escapeHtml(analysisSummary)}</div>
        </div>
        <div class="result-actions">
            ${groupBadge}
            ${firstOccurrence ? `<button class="trace-comment-toggle${group.traceCommentCount ? ' has-comment' : ''}" type="button" data-tag-id="${firstOccurrence.id}" aria-expanded="${group.traceCommentCount ? 'true' : 'false'}" aria-label="${commentLabel}" title="${commentLabel}">💬</button>` : ''}
            <button class="btn-mini correct" title="Approve all" data-tag="${escapeHtml(group.tag)}">✓</button>
            <button class="btn-mini incorrect" title="Reject all" data-tag="${escapeHtml(group.tag)}">✗</button>
        </div>
        ${firstOccurrence ? traceCommentEditorMarkup(firstOccurrence, 'Comment on this line occurrence') : ''}
    `;

    if (!showMeta) li.querySelector('.meta')?.remove();

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
    if (firstOccurrence) wireTraceCommentEditor(li, firstOccurrence);

    li.addEventListener('click', () => {
        window.PipeTracing?.selectTag?.(group.occurrences[0]);
        const first = group.occurrences[0];
        focusPdfTag(first);
    });

    targetList.appendChild(li);
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

function updateTraceResultsToolbar() {
    if (!traceResultsToolbar || !traceResultsSummary) return;

    const lineTags = allFoundTags.filter(isTraceLineTag);
    const valveTags = allFoundTags.filter(isValveAuditTag);
    if (!pipeTracingEnabled || (!lineTags.length && !valveTags.length)) {
        traceResultsToolbar.hidden = true;
        if (copyTraceResultsBtn) copyTraceResultsBtn.disabled = true;
        syncResultsRail(!document.body.classList.contains('results-sidebar-collapsed'), getActiveResultsRailButtonId());
        return;
    }

    const counts = lineTags.reduce((result, item) => {
        const status = item.traceStatus || 'untraced';
        result[status] = (result[status] || 0) + 1;
        return result;
    }, { yes: 0, review: 0, no: 0, running: 0, untraced: 0 });

    valveAssociationCounts = valveTags.reduce((result, item) => {
        const status = item.associationStatus || 'unassigned';
        result[status] = (result[status] || 0) + 1;
        return result;
    }, { assigned: 0, review: 0, unassigned: 0 });

    traceResultsToolbar.hidden = false;
    const lineParts = [
        counts.yes ? `${counts.yes} yes` : '',
        counts.review ? `${counts.review} review` : '',
        counts.no ? `${counts.no} no` : '',
        counts.untraced ? `${counts.untraced} pending` : ''
    ].filter(Boolean);
    const valveParts = [
        valveAssociationCounts.assigned ? `${valveAssociationCounts.assigned} linked` : '',
        valveAssociationCounts.review ? `${valveAssociationCounts.review} review` : '',
        valveAssociationCounts.unassigned ? `${valveAssociationCounts.unassigned} no link` : ''
    ].filter(Boolean);
    const lineSummary = lineTags.length ? `Lines ${lineParts.join(' · ')}` : 'Lines none';
    const valveSummary = valveTags.length ? `Valves ${valveParts.join(' · ')}` : 'Valves none';
    traceResultsSummary.textContent = `${lineSummary} | ${valveSummary}`;
    if (copyTraceResultsBtn) {
        copyTraceResultsBtn.disabled = !valveTags.length && !lineTags.some(item =>
            (item.traceStatus && item.traceStatus !== 'untraced') || String(item.traceComment || '').trim()
        );
    }
    if (showValveLineViewBtn) showValveLineViewBtn.disabled = !hasValveLineResults();
    renderValveLineResults();
    syncResultsRail(!document.body.classList.contains('results-sidebar-collapsed'), getActiveResultsRailButtonId());
}

function updateTraceStatusUI(item) {
    if (!item) return;
    const row = resultList?.querySelector(`[data-tag-id="${item.id}"]`);
    if (!row) {
        if (duplicateMode === 'unique') rebuildSidebar();
        updateTraceResultsToolbar();
        return;
    }

    const badge = row.querySelector(`[data-trace-status-badge="${item.id}"]`);
    if (badge) {
        const info = traceStatusInfo(item.traceStatus, item.traceReason);
        badge.className = `trace-status-badge trace-status-${info.status}`;
        badge.textContent = info.label;
        badge.title = info.title;
    }
    const summary = row.querySelector(`[data-trace-summary="${item.id}"]`);
    if (summary) {
        const text = itemAnalysisSummary(item);
        summary.textContent = text;
        summary.hidden = !text;
    }
    updateTraceResultsToolbar();
}

function handlePipeTraceResult(event) {
    const detail = event?.detail || {};
    const item = allFoundTags.find(candidate => candidate.id === Number(detail.tagId));
    if (!item) return;

    item.traceStatus = detail.status || 'untraced';
    item.traceSummary = detail.summary || '';
    item.traceReason = detail.reason || '';
    item.traceDetails = detail;
    updateTraceStatusUI(item);
}

function handlePipeTraceReset() {
    clearValveLineConnectionFocus();
    activeValveLineFocus = { valveId: null, lineId: null };
    for (const item of allFoundTags) {
        item.traceStatus = 'untraced';
        item.traceSummary = '';
        item.traceReason = '';
        item.traceDetails = null;
        item.traceComment = '';
        item.associationStatus = isValveAuditTag(item) ? 'unassigned' : '';
        item.associatedLineTag = '';
        item.associatedLineId = null;
        item.associationConfidence = null;
        item.associationReason = '';
        item.associationMethod = '';
        item.associationCandidates = [];
        item.associatedValves = [];
        item.valvesForReview = [];
    }
    valveAssociationCounts = { assigned: 0, review: 0, unassigned: allFoundTags.filter(isValveAuditTag).length };
    rebuildSidebar();
    updateTraceResultsToolbar();
    if (activeResultsView === 'valves') showResultsView('tags');
}

function handlePipeTracingState(event) {
    pipeTracingEnabled = Boolean(event?.detail?.enabled);
    updateTraceResultsToolbar();
}

function handlePipeValveAssociations(event) {
    const detail = event?.detail || {};
    const associations = Array.isArray(detail.associations) ? detail.associations : [];
    const byValveId = new Map(associations.map(association => [Number(association.occurrenceId), association]));

    for (const item of allFoundTags) {
        if (isValveAuditTag(item)) {
            const association = byValveId.get(item.id);
            item.associationStatus = association?.status || 'unassigned';
            item.associatedLineTag = association?.lineTag || '';
            item.associatedLineId = association?.lineOccurrenceId ?? null;
            item.associationConfidence = association?.confidence ?? null;
            item.associationReason = association?.reason || '';
            item.associationMethod = association?.method || '';
            item.associationCandidates = Array.isArray(association?.candidates) ? association.candidates : [];
        }
        if (isTraceLineTag(item)) {
            item.associatedValves = [];
            item.valvesForReview = [];
        }
    }

    for (const lineSummary of detail.lineSummaries || []) {
        const lineItem = allFoundTags.find(item => item.id === Number(lineSummary.occurrenceId));
        if (!lineItem) continue;
        lineItem.associatedValves = (lineSummary.assignedValveIds || [])
            .map(id => byValveId.get(Number(id)))
            .filter(Boolean);
        lineItem.valvesForReview = (lineSummary.reviewValveIds || [])
            .map(id => byValveId.get(Number(id)))
            .filter(Boolean);
    }

    valveAssociationCounts = {
        assigned: Number(detail.counts?.assigned) || 0,
        review: Number(detail.counts?.review) || 0,
        unassigned: Number(detail.counts?.unassigned) || 0
    };
    rebuildSidebar();
    updateTraceResultsToolbar();
    renderValveLineResults();
}

function buildTraceReport() {
    const lineTags = allFoundTags.filter(isTraceLineTag);
    const valveTags = allFoundTags.filter(isValveAuditTag);
    const counts = lineTags.reduce((result, item) => {
        const status = item.traceStatus || 'untraced';
        result[status] = (result[status] || 0) + 1;
        return result;
    }, { yes: 0, review: 0, no: 0, untraced: 0 });
    const title = window.currentPDFName || 'P&ID';
    const valveCounts = valveTags.reduce((result, item) => {
        const status = item.associationStatus || 'unassigned';
        result[status] = (result[status] || 0) + 1;
        return result;
    }, { assigned: 0, review: 0, unassigned: 0 });
    const lines = [
        `P&ID line and valve report — ${title}`,
        `LINES | YES: ${counts.yes} | REVIEW: ${counts.review} | NO: ${counts.no} | PENDING: ${counts.untraced}`,
        `VALVES | LINKED: ${valveCounts.assigned} | REVIEW: ${valveCounts.review} | UNLINKED: ${valveCounts.unassigned}`,
        ''
    ];

    lines.push('Line register');
    lineTags.forEach((item, index) => {
        const info = traceStatusInfo(item.traceStatus, item.traceReason);
        const summary = String(item.traceSummary || 'Not checked').replace(/\s+/g, ' ').trim();
        const comment = String(item.traceComment || '').replace(/\s+/g, ' ').trim();
        const linkedValves = (item.associatedValves || []).map(valve => valve.valveTag).join(', ') || 'none';
        const reviewValves = (item.valvesForReview || []).map(valve => valve.valveTag).join(', ') || 'none';
        lines.push(`${index + 1}. ${item.tag} | ${info.label} | Page ${item.page} | ${summary} | Linked valves: ${linkedValves} | Valve review: ${reviewValves}${comment ? ` | Comment: ${comment}` : ''}`);
    });

    lines.push('', 'Valve register');
    valveTags.forEach((item, index) => {
        const info = valveAssociationStatusInfo(item.associationStatus, item.associationReason);
        const candidates = Array.from(new Set((item.associationCandidates || [])
            .map(candidate => candidate.lineTag)
            .filter(Boolean)))
            .join(', ') || 'none';
        const confidence = item.associationConfidence !== null && Number.isFinite(Number(item.associationConfidence))
            ? `${Math.round(Number(item.associationConfidence) * 100)}%`
            : 'n/a';
        const comment = String(item.traceComment || '').replace(/\s+/g, ' ').trim();
        lines.push(`${index + 1}. ${item.tag} | ${item.tagType} | ${info.label} | Page ${item.page} | Line: ${item.associatedLineTag || 'unassigned'} | Confidence: ${confidence} | Candidates: ${candidates} | Reason: ${item.associationReason || 'not evaluated'}${comment ? ` | Comment: ${comment}` : ''}`);
    });
    return lines.join('\n');
}

async function copyTraceReport() {
    const report = buildTraceReport();
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(report);
        } else {
            const helper = document.createElement('textarea');
            helper.value = report;
            helper.setAttribute('readonly', '');
            helper.style.position = 'fixed';
            helper.style.opacity = '0';
            document.body.appendChild(helper);
            helper.select();
            document.execCommand('copy');
            helper.remove();
        }
        showToast('Trace report copied to clipboard', 'success');
    } catch (error) {
        console.error('Could not copy trace report:', error);
        showToast('Could not copy trace report', 'error');
    }
}

window.addEventListener('pipe-trace-result', handlePipeTraceResult);
window.addEventListener('pipe-trace-reset', handlePipeTraceReset);
window.addEventListener('pipe-tracing-state', handlePipeTracingState);
window.addEventListener('pipe-valve-associations', handlePipeValveAssociations);
if (copyTraceResultsBtn) copyTraceResultsBtn.addEventListener('click', copyTraceReport);

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
    const sidebarLi = resultList.querySelector(`[data-tag-id="${id}"]`);
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

async function exportToCSV() {
    if (allFoundTags.length === 0) {
        alert("No tags found.");
        return;
    }
    const header = [
        'Tag Number',
        'Tag Type',
        'Sheet Title',
        'Page Number',
        'Occurrences',
        'Revision',
        'Review Status',
        'Line Trace Status',
        'Associated Line',
        'Valve Association Status',
        'Association Confidence',
        'Association Method',
        'Association Reason',
        'Candidate Lines',
        'Linked Valves',
        'Trace / Association Summary',
        'Comment'
    ];
    const rows = [header];
    if (duplicateMode === 'unique') {
        const groups = createGroupedView(allFoundTags);
        groups.forEach(g => {
            const titles = Array.from(g.titles).join(" | ");
            const pages = Array.from(g.pages).sort((a, b) => a - b).join(";");
            const revisions = Array.from(g.revisions).join(" | ");
            const tagTypes = Array.from(new Set(g.occurrences.map(item => item.tagType).filter(Boolean))).join(' | ');
            const associatedLines = Array.from(new Set(g.occurrences.map(item => item.associatedLineTag).filter(Boolean))).join(' | ');
            const confidences = g.occurrences
                .filter(item => item.associationConfidence !== null && item.associationConfidence !== '')
                .map(item => Number(item.associationConfidence))
                .filter(Number.isFinite);
            const linkedValves = Array.from(new Set(g.occurrences
                .flatMap(item => item.associatedValves || [])
                .map(valve => valve.valveTag)
                .filter(Boolean)))
                .join(' | ');
            const comments = Array.from(new Set(g.occurrences.map(item => String(item.traceComment || '').trim()).filter(Boolean))).join(' | ');
            rows.push([
                g.tag,
                tagTypes,
                titles,
                pages,
                g.occurrences.length,
                revisions,
                g.status,
                g.traceStatus === 'untraced' ? '' : g.traceStatus,
                associatedLines,
                g.associationStatus,
                confidences.length ? Math.max(...confidences).toFixed(3) : '',
                Array.from(new Set(g.occurrences.map(item => item.associationMethod).filter(Boolean))).join(' | '),
                Array.from(new Set(g.occurrences.map(item => item.associationReason).filter(Boolean))).join(' | '),
                Array.from(new Set(g.occurrences
                    .flatMap(item => item.associationCandidates || [])
                    .map(candidate => candidate.lineTag)
                    .filter(Boolean)))
                    .join(' | '),
                linkedValves,
                groupedAnalysisSummary(g),
                comments
            ]);
        });
    } else {
        allFoundTags.forEach(item => {
            rows.push([
                item.tag,
                item.tagType,
                item.title,
                item.page,
                1,
                item.revision || '',
                item.status,
                isTraceLineTag(item) && item.traceStatus !== 'untraced' ? item.traceStatus : '',
                item.associatedLineTag || '',
                isValveAuditTag(item) ? item.associationStatus || 'unassigned' : '',
                item.associationConfidence !== null && Number.isFinite(Number(item.associationConfidence))
                    ? Number(item.associationConfidence).toFixed(3)
                    : '',
                item.associationMethod || '',
                item.associationReason || '',
                Array.from(new Set((item.associationCandidates || [])
                    .map(candidate => candidate.lineTag)
                    .filter(Boolean)))
                    .join(' | '),
                (item.associatedValves || []).map(valve => valve.valveTag).join(' | '),
                itemAnalysisSummary(item),
                item.traceComment || ''
            ]);
        });
    }

    const csvContent = rows.map(row => row.map(csvCell).join(',')).join('\r\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8' });
    const fileName = `${window.currentPDFName || 'pid'}_audit_results.csv`;
    downloadBlob(blob, fileName);
    try {
        const savedToFolder = await saveProjectArtifact(blob, '03_Reports', fileName, 'report');
        showToast(`Audit CSV exported${savedToFolder ? ' and saved to project Reports' : ''}`, 'success');
    } catch (error) {
        console.warn('Could not save audit report to project folder', error);
        showToast('Audit CSV exported', 'success');
    }
}

function updateLineListFileName(input) {
    if (!lineListFileName) return;

    if (input.files && input.files.length > 0) {
        const selectedName = input.files[0].name;
        lineListFileName.textContent = selectedName;
        rememberPreference(UI_PREF_KEYS.lastLineListName, selectedName);
    } else {
        lineListFileName.textContent = DEFAULT_LINE_LIST_LABEL;
        forgetPreference(UI_PREF_KEYS.lastLineListName);
    }
}

function rememberPreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (err) {
        // Ignore storage errors (private mode/blocked storage) without breaking UI behavior.
    }
}

function readPreference(key) {
    try {
        return localStorage.getItem(key);
    } catch (err) {
        return null;
    }
}

function forgetPreference(key) {
    try {
        localStorage.removeItem(key);
    } catch (err) {
        // Ignore storage errors safely.
    }
}

function restoreRememberedSelections() {
    const savedLineListName = readPreference(UI_PREF_KEYS.lastLineListName);
    if (lineListFileName && savedLineListName) {
        lineListFileName.textContent = `${savedLineListName} (last used)`;
    }

    const savedSearchModeRaw = readPreference(UI_PREF_KEYS.searchMode);
    if (savedSearchModeRaw) {
        let savedModes = [];
        try {
            const parsed = JSON.parse(savedSearchModeRaw);
            if (Array.isArray(parsed)) {
                savedModes = parsed.filter(mode => ['line', 'valve', 'actuated'].includes(mode));
            }
        } catch {
            if (['line', 'valve', 'actuated'].includes(savedSearchModeRaw)) {
                savedModes = [savedSearchModeRaw];
            }
        }

        if (savedModes.length > 0) {
            document.querySelectorAll('input[name="searchMode"]').forEach(input => {
                input.checked = savedModes.includes(input.value);
            });
        }
    }

    const savedDuplicateMode = readPreference(UI_PREF_KEYS.duplicateMode);
    if (savedDuplicateMode) {
        const duplicateModeRadio = document.querySelector(`input[name="dupMode"][value="${savedDuplicateMode}"]`);
        if (duplicateModeRadio) {
            duplicateModeRadio.checked = true;
            duplicateMode = savedDuplicateMode;
        }
    }
}

function normalizeHeaderCell(value) {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function normalizeTagValue(value) {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\s+/g, '');
}

function resetCompareDrawerState() {
    compareDrawerState.fileName = '';
    compareDrawerState.lineColumnLabel = '';
    compareDrawerState.lineColumnIndex = -1;
    compareDrawerState.lineHeaders = [];
    compareDrawerState.pidTagLookup = new Map();
    compareDrawerState.lineTagAttributes = new Map();
    compareDrawerState.lineRows = [];
    compareDrawerState.attributeColumns = [];
    compareDrawerState.selectedAttributeKey = '';
    compareDrawerState.showAttributes = false;
    compareDrawerState.showPdfOverlayAttributes = false;
    compareDrawerState.missing = [];
    compareDrawerState.extra = [];
    compareDrawerState.matched = [];
    compareDrawerState.pidUniqueCount = 0;
    compareDrawerState.lineUniqueCount = 0;
    compareDrawerState.jumpCycle = new Map();

    if (compareShowAttributesCheckbox) compareShowAttributesCheckbox.checked = false;
    if (compareShowPdfAttributesCheckbox) {
        compareShowPdfAttributesCheckbox.checked = false;
        compareShowPdfAttributesCheckbox.disabled = true;
    }
    if (compareAttributeSelect) {
        compareAttributeSelect.innerHTML = '<option value="">None</option>';
        compareAttributeSelect.disabled = true;
    }
    if (compareDrawerMeta) compareDrawerMeta.textContent = 'No comparison loaded';
    if (compareDrawerContent) compareDrawerContent.innerHTML = '<div class="compare-empty">Run a compare to view results.</div>';
    if (exportCompareBtn) exportCompareBtn.disabled = true;

    hideCompareAttributeOverlay();
    clearPdfAttributeOverlays();
}

function buildTagStats(rawTags) {
    const counts = new Map();

    for (const rawTag of rawTags) {
        const normalizedTag = normalizeTagValue(rawTag);
        if (!normalizedTag) continue;
        counts.set(normalizedTag, (counts.get(normalizedTag) || 0) + 1);
    }

    const unique = new Set(counts.keys());
    const duplicates = Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => a.tag.localeCompare(b.tag));

    return { unique, duplicates, counts };
}

function findLineNumberColumn(rows) {
    const maxScanRows = Math.min(rows.length, 30);

    for (let rowIndex = 0; rowIndex < maxScanRows; rowIndex++) {
        const row = rows[rowIndex] || [];

        for (let colIndex = 0; colIndex < row.length; colIndex++) {
            const header = normalizeHeaderCell(row[colIndex]);

            if (
                header === 'LINENUMBER' ||
                header.endsWith('LINENUMBER') ||
                header === 'LINETAG' ||
                header === 'LINETAGNUMBER'
            ) {
                return {
                    headerRowIndex: rowIndex,
                    columnIndex: colIndex,
                    columnLabel: String(row[colIndex] ?? '').trim() || 'Line Number'
                };
            }
        }
    }

    return null;
}

function chooseDefaultAttributeKey(columns) {
    if (!columns.length) return '';

    const preferred = [
        'NOMINALPIPESIZE',
        'PIPINGSPECIFICATION',
        'FLUIDCODE',
        'DISPLAYNAME'
    ];

    for (const wanted of preferred) {
        const found = columns.find(col => col.key === wanted || col.key.startsWith(`${wanted}_`));
        if (found) return found.key;
    }

    return columns[0].key;
}

function buildAttributeColumns(headerRow, lineColumnIndex) {
    const usedKeys = new Set();
    const columns = [];

    for (let colIndex = 0; colIndex < headerRow.length; colIndex++) {
        if (colIndex === lineColumnIndex) continue;

        const label = String(headerRow[colIndex] ?? '').trim();
        if (!label) continue;

        const baseKey = normalizeHeaderCell(label) || `COLUMN${colIndex + 1}`;
        let key = baseKey;
        let suffix = 2;
        while (usedKeys.has(key)) {
            key = `${baseKey}_${suffix}`;
            suffix++;
        }
        usedKeys.add(key);

        columns.push({ key, label, index: colIndex });
    }

    return columns;
}

function buildPidTagLookup() {
    const lookup = new Map();

    for (const item of allFoundTags) {
        const normalizedTag = normalizeTagValue(item.tag);
        if (!normalizedTag) continue;

        if (!lookup.has(normalizedTag)) {
            lookup.set(normalizedTag, []);
        }
        lookup.get(normalizedTag).push(item);
    }

    for (const occurrences of lookup.values()) {
        occurrences.sort((a, b) => (a.page - b.page) || (a.id - b.id));
    }

    return lookup;
}

function detectCsvDelimiter(text) {
    const firstLine = String(text ?? '').split(/\r\n|\n|\r/, 10).find(line => line.trim()) || '';
    const delimiters = [',', ';', '\t'];
    const counts = new Map(delimiters.map(delimiter => [delimiter, 0]));
    let inQuotes = false;

    for (let index = 0; index < firstLine.length; index++) {
        const character = firstLine[index];
        if (character === '"') {
            if (inQuotes && firstLine[index + 1] === '"') {
                index++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (!inQuotes && counts.has(character)) {
            counts.set(character, counts.get(character) + 1);
        }
    }

    return delimiters.reduce((best, delimiter) =>
        counts.get(delimiter) > counts.get(best) ? delimiter : best, ',');
}

function parseCsvRows(text) {
    const source = String(text ?? '').replace(/^\uFEFF/, '');
    const delimiter = detectCsvDelimiter(source);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < source.length; index++) {
        const character = source[index];

        if (inQuotes) {
            if (character === '"' && source[index + 1] === '"') {
                cell += '"';
                index++;
            } else if (character === '"') {
                inQuotes = false;
            } else {
                cell += character;
            }
        } else if (character === '"' && cell === '') {
            inQuotes = true;
        } else if (character === delimiter && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((character === '\n' || character === '\r') && !inQuotes) {
            if (character === '\r' && source[index + 1] === '\n') {
                index++;
            }
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += character;
        }
    }

    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

async function extractLineListTagsFromFile(file) {
    if (!/\.csv$/i.test(file?.name || '')) {
        throw new Error('Only CSV line lists are supported.');
    }

    const rows = parseCsvRows(await file.text());

    if (!rows.length) {
        throw new Error('The line list file is empty.');
    }

    const columnInfo = findLineNumberColumn(rows);
    if (!columnInfo) {
        throw new Error('Could not find a "Line Number" column in the first sheet.');
    }

    const headerRow = rows[columnInfo.headerRowIndex] || [];
    const lineHeaders = headerRow.map((cell, index) => {
        const label = String(cell ?? '').trim();
        return label || `Column ${index + 1}`;
    });
    const attributeColumns = buildAttributeColumns(headerRow, columnInfo.columnIndex);

    const tags = [];
    const lineRows = [];
    const lineTagAttributes = new Map();
    for (let rowIndex = columnInfo.headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex] || [];
        const rowCells = lineHeaders.map((_, colIndex) => String(row[colIndex] ?? ''));
        const value = row[columnInfo.columnIndex];
        const normalizedTag = normalizeTagValue(value);
        const rowAttributes = {};
        for (const col of attributeColumns) {
            const attributeValue = String(row[col.index] ?? '').trim();
            if (!attributeValue) continue;
            rowAttributes[col.key] = attributeValue;
        }
        lineRows.push({ tag: normalizedTag, cells: rowCells, attributes: rowAttributes });

        if (!normalizedTag) continue;
        tags.push(normalizedTag);

        if (!lineTagAttributes.has(normalizedTag)) {
            lineTagAttributes.set(normalizedTag, {});
        }

        const mergedAttributes = lineTagAttributes.get(normalizedTag);
        for (const [attributeKey, attributeValue] of Object.entries(rowAttributes)) {
            if (!mergedAttributes[attributeKey]) {
                mergedAttributes[attributeKey] = attributeValue;
            }
        }
    }

    if (tags.length === 0) {
        throw new Error('No line tags found under the selected line number column.');
    }

    return {
        fileName: file.name,
        columnLabel: columnInfo.columnLabel,
        columnIndex: columnInfo.columnIndex,
        lineHeaders,
        tags,
        lineRows,
        lineTagAttributes,
        attributeColumns
    };
}

function getAttributeLabel(attributeKey) {
    const col = compareDrawerState.attributeColumns.find(column => column.key === attributeKey);
    return col ? col.label : attributeKey;
}

function renderCompareList(tags, listType) {
    if (!tags.length) {
        return '<div class="compare-empty">No tags in this list.</div>';
    }

    const selectedAttributeKey = compareDrawerState.showAttributes ? compareDrawerState.selectedAttributeKey : '';
    const attributeLabel = selectedAttributeKey ? getAttributeLabel(selectedAttributeKey) : '';

    const items = tags.map(tag => {
        const jumpable = compareDrawerState.pidTagLookup.has(tag);
        const occurrences = jumpable ? compareDrawerState.pidTagLookup.get(tag).length : 0;

        let note = '';
        if (listType === 'extra') {
            note = 'Only in line list (not in P&ID).';
        } else if (jumpable && occurrences > 1) {
            note = `Click to locate (${occurrences} hits, cycles each click).`;
        } else if (jumpable) {
            note = 'Click to locate on P&ID.';
        } else {
            note = 'No P&ID location found.';
        }

        const attributeValue = selectedAttributeKey
            ? (compareDrawerState.lineTagAttributes.get(tag)?.[selectedAttributeKey] || '')
            : '';

        return `
            <li class="compare-item ${jumpable ? 'jumpable' : ''}" data-tag="${escapeHtml(tag)}" data-jump="${jumpable ? '1' : '0'}">
                <span class="compare-item-main">${escapeHtml(tag)}</span>
                ${attributeValue ? `<div class="compare-item-attr">${escapeHtml(attributeLabel)}: ${escapeHtml(attributeValue)}</div>` : ''}
                <div class="compare-item-note">${escapeHtml(note)}</div>
            </li>
        `;
    }).join('');

    return `<ul class="compare-list">${items}</ul>`;
}

function hideCompareAttributeOverlay() {
    if (!compareAttributeOverlay) return;

    compareAttributeOverlay.classList.remove('visible');
    compareAttributeOverlay.setAttribute('aria-hidden', 'true');
    if (compareAttributeOverlayTimeout) {
        clearTimeout(compareAttributeOverlayTimeout);
        compareAttributeOverlayTimeout = null;
    }
}

function clearPdfAttributeOverlays() {
    document.querySelectorAll('.compare-pdf-attr-label').forEach(el => el.remove());
}

function updatePdfAttributeOverlays() {
    clearPdfAttributeOverlays();

    if (!compareDrawerState.showAttributes || !compareDrawerState.showPdfOverlayAttributes) {
        return;
    }

    const attributeKey = compareDrawerState.selectedAttributeKey;
    if (!attributeKey) {
        return;
    }

    const seen = new Set();
    for (const item of allFoundTags) {
        if (!item?.element || !item.element.parentElement) continue;

        const normalizedTag = normalizeTagValue(item.tag);
        if (!normalizedTag) continue;

        // Avoid stacking repeated labels for the same tag on the same page.
        const uniqueOnPageKey = `${item.page}|${normalizedTag}`;
        if (seen.has(uniqueOnPageKey)) continue;

        const attributeValue = compareDrawerState.lineTagAttributes.get(normalizedTag)?.[attributeKey];
        if (!attributeValue) continue;

        seen.add(uniqueOnPageKey);

        const label = document.createElement('div');
        label.className = 'compare-pdf-attr-label';
        label.textContent = attributeValue;
        label.title = `${item.tag} | ${getAttributeLabel(attributeKey)}: ${attributeValue}`;

        const left = parseFloat(item.element.style.left || '0');
        const top = parseFloat(item.element.style.top || '0');
        const height = parseFloat(item.element.style.height || '0');
        label.style.left = `${Math.max(0, left)}px`;
        label.style.top = `${Math.max(0, top + height + 2)}px`;

        item.element.parentElement.appendChild(label);
    }
}

function showCompareAttributeOverlay(targetItem, normalizedTag) {
    const attributeKey = compareDrawerState.selectedAttributeKey;
    if (!compareDrawerState.showAttributes || !attributeKey || !compareAttributeOverlay) {
        hideCompareAttributeOverlay();
        return;
    }

    const attributeValue = compareDrawerState.lineTagAttributes.get(normalizedTag)?.[attributeKey];
    if (!attributeValue) {
        hideCompareAttributeOverlay();
        return;
    }

    const attributeLabel = getAttributeLabel(attributeKey);
    compareAttributeOverlay.textContent = `${targetItem.tag} | ${attributeLabel}: ${attributeValue}`;

    let left = 16;
    let top = 16;
    if (targetItem?.element) {
        const rect = targetItem.element.getBoundingClientRect();
        left = Math.max(12, Math.min(window.innerWidth - 300, rect.left));
        top = Math.max(12, Math.min(window.innerHeight - 56, rect.bottom + 8));
    }

    compareAttributeOverlay.style.left = `${left}px`;
    compareAttributeOverlay.style.top = `${top}px`;
    compareAttributeOverlay.classList.add('visible');
    compareAttributeOverlay.setAttribute('aria-hidden', 'false');

    if (compareAttributeOverlayTimeout) {
        clearTimeout(compareAttributeOverlayTimeout);
    }
    compareAttributeOverlayTimeout = setTimeout(() => {
        hideCompareAttributeOverlay();
    }, 3500);
}

function renderCompareDrawer() {
    if (!compareDrawerContent) return;

    if (!compareDrawerState.showAttributes) {
        hideCompareAttributeOverlay();
    }

    if (!compareDrawerState.fileName) {
        compareDrawerContent.innerHTML = '<div class="compare-empty">Run a compare to view results.</div>';
        if (exportCompareBtn) exportCompareBtn.disabled = true;
        return;
    }
    if (exportCompareBtn) exportCompareBtn.disabled = false;

    if (compareDrawerMeta) {
        compareDrawerMeta.textContent = `File: ${compareDrawerState.fileName} | Column: ${compareDrawerState.lineColumnLabel}`;
    }

    if (compareShowAttributesCheckbox) {
        compareShowAttributesCheckbox.checked = compareDrawerState.showAttributes;
    }
    if (compareShowPdfAttributesCheckbox) {
        compareShowPdfAttributesCheckbox.checked = compareDrawerState.showPdfOverlayAttributes;
        compareShowPdfAttributesCheckbox.disabled =
            compareDrawerState.attributeColumns.length === 0 || !compareDrawerState.showAttributes;
    }

    if (compareAttributeSelect) {
        compareAttributeSelect.innerHTML = '';
        compareAttributeSelect.disabled = compareDrawerState.attributeColumns.length === 0 || !compareDrawerState.showAttributes;

        if (compareDrawerState.attributeColumns.length === 0) {
            compareAttributeSelect.innerHTML = '<option value="">No attributes found</option>';
            compareDrawerState.selectedAttributeKey = '';
        } else {
            for (const column of compareDrawerState.attributeColumns) {
                const option = document.createElement('option');
                option.value = column.key;
                option.textContent = column.label;
                compareAttributeSelect.appendChild(option);
            }

            const validKey = compareDrawerState.attributeColumns.some(col => col.key === compareDrawerState.selectedAttributeKey);
            if (!validKey) {
                compareDrawerState.selectedAttributeKey = chooseDefaultAttributeKey(compareDrawerState.attributeColumns);
            }
            compareAttributeSelect.value = compareDrawerState.selectedAttributeKey;
        }
    }

    compareDrawerContent.innerHTML = `
        <div class="compare-summary">
            <div class="compare-stat">
                <div class="compare-stat-label">P&ID Unique Tags</div>
                <div class="compare-stat-value">${compareDrawerState.pidUniqueCount}</div>
            </div>
            <div class="compare-stat">
                <div class="compare-stat-label">Line List Unique Tags</div>
                <div class="compare-stat-value">${compareDrawerState.lineUniqueCount}</div>
            </div>
            <div class="compare-stat">
                <div class="compare-stat-label">Missing In Line List</div>
                <div class="compare-stat-value">${compareDrawerState.missing.length}</div>
            </div>
            <div class="compare-stat">
                <div class="compare-stat-label">Extra In Line List</div>
                <div class="compare-stat-value">${compareDrawerState.extra.length}</div>
            </div>
        </div>

        <div class="compare-columns">
            <section class="compare-column">
                <div class="compare-column-header missing">Missing In Line List (${compareDrawerState.missing.length})</div>
                ${renderCompareList(compareDrawerState.missing, 'missing')}
            </section>
            <section class="compare-column">
                <div class="compare-column-header extra">Extra In Line List (${compareDrawerState.extra.length})</div>
                ${renderCompareList(compareDrawerState.extra, 'extra')}
            </section>
            <section class="compare-column">
                <div class="compare-column-header matched">Matched (${compareDrawerState.matched.length})</div>
                ${renderCompareList(compareDrawerState.matched, 'matched')}
            </section>
        </div>
    `;

    updatePdfAttributeOverlays();
}

function openCompareDrawer() {
    if (!compareDrawer) return;
    compareDrawer.classList.add('open');
    compareDrawer.classList.remove('minimized');
    compareDrawer.setAttribute('aria-hidden', 'false');
    stickyFooter?.classList.add('collapsed');
}

function closeCompareDrawer() {
    if (!compareDrawer) return;
    compareDrawer.classList.remove('open');
    compareDrawer.classList.remove('minimized');
    compareDrawer.style.height = '';
    compareDrawer.setAttribute('aria-hidden', 'true');
    hideCompareAttributeOverlay();
    clearPdfAttributeOverlays();
}

function toggleCompareDrawerMinimize() {
    if (!compareDrawer || !compareDrawer.classList.contains('open')) return;
    compareDrawer.classList.toggle('minimized');
}

function startCompareDrawerResize(event) {
    if (!compareDrawer || !compareDrawer.classList.contains('open') || compareDrawer.classList.contains('minimized')) {
        return;
    }

    compareResizeInProgress = true;
    compareResizeStartY = event.clientY;
    compareResizeStartHeight = compareDrawer.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
}

function onCompareDrawerResizeMove(event) {
    if (!compareResizeInProgress || !compareDrawer) return;

    const deltaY = compareResizeStartY - event.clientY;
    const nextHeight = compareResizeStartHeight + deltaY;
    const minHeight = 220;
    const maxHeight = Math.round(window.innerHeight * 0.85);
    const clamped = Math.max(minHeight, Math.min(maxHeight, nextHeight));
    compareDrawer.style.height = `${clamped}px`;
}

function stopCompareDrawerResize() {
    if (!compareResizeInProgress) return;
    compareResizeInProgress = false;
    document.body.style.userSelect = '';
}

function jumpToTagFromCompare(normalizedTag) {
    const occurrences = compareDrawerState.pidTagLookup.get(normalizedTag);
    if (!occurrences || occurrences.length === 0) {
        showToast('Tag not found in the loaded P&ID', 'warning');
        return;
    }

    const cycleIndex = compareDrawerState.jumpCycle.get(normalizedTag) || 0;
    const target = occurrences[cycleIndex % occurrences.length];
    const nextIndex = (cycleIndex + 1) % occurrences.length;
    compareDrawerState.jumpCycle.set(normalizedTag, nextIndex);

    focusPdfTag(target);

    showCompareAttributeOverlay(target, normalizedTag);
}

function handleCompareDrawerContentClick(event) {
    const row = event.target.closest('.compare-item');
    if (!row) return;

    const canJump = row.getAttribute('data-jump') === '1';
    if (!canJump) return;

    const normalizedTag = normalizeTagValue(row.getAttribute('data-tag'));
    if (!normalizedTag) return;

    jumpToTagFromCompare(normalizedTag);
}

async function openLineListCompareModal() {
    if (!allFoundTags.length) {
        showToast('Load and scan a PDF first', 'warning');
        return;
    }

    const lineListFile = lineListInput?.files?.[0];
    if (!lineListFile) {
        showToast('Select a CSV line list first', 'warning');
        return;
    }

    let lineListData;
    try {
        lineListData = await extractLineListTagsFromFile(lineListFile);
    } catch (err) {
        console.error('Line list parse failed:', err);
        showToast(err.message || 'Failed to read line list file', 'error');
        return;
    }

    const pidStats = buildTagStats(allFoundTags.map(item => item.tag));
    const lineStats = buildTagStats(lineListData.tags);

    const missing = Array.from(pidStats.unique).filter(tag => !lineStats.unique.has(tag)).sort((a, b) => a.localeCompare(b));
    const extra = Array.from(lineStats.unique).filter(tag => !pidStats.unique.has(tag)).sort((a, b) => a.localeCompare(b));
    const matched = Array.from(pidStats.unique).filter(tag => lineStats.unique.has(tag)).sort((a, b) => a.localeCompare(b));

    compareDrawerState.fileName = lineListData.fileName;
    compareDrawerState.lineColumnLabel = lineListData.columnLabel;
    compareDrawerState.lineColumnIndex = lineListData.columnIndex;
    compareDrawerState.lineHeaders = lineListData.lineHeaders;
    compareDrawerState.pidTagLookup = buildPidTagLookup();
    compareDrawerState.lineTagAttributes = lineListData.lineTagAttributes;
    compareDrawerState.lineRows = lineListData.lineRows;
    compareDrawerState.attributeColumns = lineListData.attributeColumns;
    compareDrawerState.selectedAttributeKey = chooseDefaultAttributeKey(lineListData.attributeColumns);
    compareDrawerState.showAttributes = false;
    compareDrawerState.showPdfOverlayAttributes = false;
    compareDrawerState.missing = missing;
    compareDrawerState.extra = extra;
    compareDrawerState.matched = matched;
    compareDrawerState.pidUniqueCount = pidStats.unique.size;
    compareDrawerState.lineUniqueCount = lineStats.unique.size;
    compareDrawerState.jumpCycle = new Map();

    renderCompareDrawer();
    openCompareDrawer();
    hideCompareAttributeOverlay();
}

function buildCompareExportRows() {
    const sourceHeaders = compareDrawerState.lineHeaders.length
        ? compareDrawerState.lineHeaders.slice()
        : [compareDrawerState.lineColumnLabel || 'Line Number'];
    const inPidHeader = 'In PID?';
    const rows = [[...sourceHeaders, inPidHeader]];
    const seenLineTags = new Set();

    for (const lineRow of compareDrawerState.lineRows) {
        const normalizedTag = normalizeTagValue(lineRow?.tag);
        if (normalizedTag) {
            seenLineTags.add(normalizedTag);
        }

        const sourceCells = sourceHeaders.map((_, colIndex) => String(lineRow?.cells?.[colIndex] ?? ''));
        const inPidValue = normalizedTag
            ? (compareDrawerState.pidTagLookup.has(normalizedTag) ? 'Yes' : 'No')
            : '';
        rows.push([...sourceCells, inPidValue]);
    }

    for (const missingTag of compareDrawerState.missing) {
        if (seenLineTags.has(missingTag)) continue;

        const sourceCells = new Array(sourceHeaders.length).fill('');
        const lineColumnIndex = Number.isInteger(compareDrawerState.lineColumnIndex)
            ? compareDrawerState.lineColumnIndex
            : 0;
        if (lineColumnIndex >= 0 && lineColumnIndex < sourceCells.length) {
            sourceCells[lineColumnIndex] = missingTag;
        } else if (sourceCells.length > 0) {
            sourceCells[0] = missingTag;
        }

        rows.push([...sourceCells, 'Yes']);
    }

    return rows;
}

async function exportLineListCompareToCsv() {
    const selectedLineListName = lineListInput?.files?.[0]?.name || '';
    const compareNeedsRefresh =
        !compareDrawerState.fileName ||
        (selectedLineListName && compareDrawerState.fileName !== selectedLineListName);
    if (compareNeedsRefresh) {
        await openLineListCompareModal();
        if (!compareDrawerState.fileName) {
            return;
        }
    }

    const tableRows = buildCompareExportRows();
    if (tableRows.length <= 1) {
        showToast('No compare rows to export', 'warning');
        return;
    }

    const baseName = compareDrawerState.fileName.replace(/\.[^/.]+$/, '') || 'line_list';
    const exportName = `${baseName}_pid_compare.csv`;
    const csv = tableRows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const csvBlob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    downloadBlob(csvBlob, exportName);
    try {
        const savedToFolder = await saveProjectArtifact(csvBlob, '03_Reports', exportName, 'report');
        showToast(`Exported ${tableRows.length - 1} rows to ${exportName}${savedToFolder ? ' and saved to project Reports' : ''}`, 'success');
    } catch (error) {
        console.warn('Could not save compare report to project folder', error);
        showToast(`Exported ${tableRows.length - 1} rows to ${exportName}`, 'success');
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
`;
document.head.appendChild(toastStyles);
