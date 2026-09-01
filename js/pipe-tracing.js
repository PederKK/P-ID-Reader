/*
 * Local P&ID pipe topology and valve-to-line association.
 *
 * The tracer is intentionally opt-in and page-local. It uses only the PDF.js
 * vector/text data already loaded by the audit and never calls an external
 * service. Ambiguous topology is retained as REVIEW evidence instead of being
 * guessed away.
 */
(function () {
    'use strict';

    const RENDER_SCALE = 2.0;
    const LINE_TAG_RE = /\b\d+-\d+(?:\.\d+)?(?:\/\d+)?"-[A-Z]+-[A-Z0-9]+-(?:\d{4}|XXXX)-[A-Z]+\b/i;

    // Small, explainable signatures for vector-only inline objects. This is
    // deliberately an internal catalog rather than an image/database lookup:
    // PDF symbol blocks vary between CAD exports, while their local geometry
    // (closed shape, curves, compact short strokes) remains useful evidence.
    const INLINE_OBJECT_CATALOG = Object.freeze([
        {
            id: 'instrument-or-control-like',
            label: 'instrument/control-like',
            matches: signature => signature.curvedPathCount > 0 || signature.closedShapePathCount >= 2
        },
        {
            id: 'valve-or-fitting-like',
            label: 'valve/fitting-like',
            matches: signature => signature.closedShapePathCount >= 1 && signature.compactSpan <= signature.symbolScale * 2
        },
        {
            id: 'inline-connector-like',
            label: 'connector/fitting-like',
            matches: signature => signature.shortStrokeCount >= 2 && signature.compactSpan <= signature.symbolScale * 2
        },
        {
            id: 'unclassified-inline-object',
            label: 'unclassified inline object',
            matches: () => true
        }
    ]);

    const ui = {
        toggle: document.getElementById('pipe-tracing-toggle-btn'),
        setupToggle: document.getElementById('pipe-tracing-toggle-setup-btn'),
        section: document.getElementById('pipe-tracing-section'),
        sectionToggle: document.getElementById('toggle-pipe-tracing-btn'),
        sectionTools: document.getElementById('pipe-tracing-tools'),
        controls: document.getElementById('pipe-tracing-controls'),
        traceAllButton: document.getElementById('pipe-trace-all-btn'),
        progress: document.getElementById('pipe-tracing-progress'),
        progressBar: document.getElementById('pipe-tracing-progress-bar'),
        progressLabel: document.getElementById('pipe-tracing-progress-label'),
        debugCheckbox: document.getElementById('pipe-tracing-debug-checkbox'),
        debugInspector: document.getElementById('pipe-tracing-debug-inspector'),
        debugSummary: document.getElementById('pipe-tracing-debug-summary'),
        debugDecisions: document.getElementById('pipe-tracing-debug-decisions'),
        debugExpandButton: document.getElementById('pipe-tracing-expand-debug-btn'),
        debugFirstIssueButton: document.getElementById('pipe-tracing-first-issue-btn'),
        debugPreviousIssueButton: document.getElementById('pipe-tracing-previous-issue-btn'),
        debugNextIssueButton: document.getElementById('pipe-tracing-next-issue-btn'),
        debugIssueNav: document.getElementById('pipe-tracing-debug-issue-nav'),
        debugIssuePosition: document.getElementById('pipe-tracing-debug-issue-position'),
        debugMagnifier: document.getElementById('pipe-tracing-debug-magnifier'),
        debugMagnifierCanvas: document.getElementById('pipe-tracing-debug-magnifier-canvas'),
        debugMagnifierTitle: document.getElementById('pipe-tracing-debug-magnifier-title'),
        debugMagnifierMeta: document.getElementById('pipe-tracing-debug-magnifier-meta'),
        debugFocusRouteButton: document.getElementById('pipe-tracing-focus-route-btn'),
        debugCopyButton: document.getElementById('pipe-tracing-copy-debug-btn'),
        debugFilteredCheckbox: document.getElementById('pipe-tracing-layer-filtered'),
        debugCandidatesCheckbox: document.getElementById('pipe-tracing-layer-candidates'),
        debugLabelsCheckbox: document.getElementById('pipe-tracing-layer-labels'),
        debugSeedCheckbox: document.getElementById('pipe-tracing-layer-seed'),
        status: document.getElementById('pipe-tracing-status'),
        technicalDetails: document.getElementById('pipe-tracing-technical-details'),
        diagnostics: document.getElementById('pipe-tracing-diagnostics')
    };

    const state = {
        enabled: false,
        pdfDoc: null,
        tags: [],
        selectedTagId: null,
        trace: null,
        traceGeometry: null,
        debugBundle: null,
        geometryCache: new Map(),
        traceResults: new Map(),
        valveAssociations: new Map(),
        requestId: 0,
        batchRunning: false,
        batchCompleted: 0,
        batchTotal: 0,
        traceRunning: false,
        debugIssues: [],
        debugIssueCursor: -1,
        debugPreviewRequestId: 0
    };

    function setStatus(message, stateName = '') {
        if (!ui.status) return;
        ui.status.textContent = message;
        ui.status.className = `pid-table-extraction-status ${stateName}`.trim();
    }

    function updateBatchProgress(complete = false) {
        if (!ui.progress || !ui.progressBar || !ui.progressLabel) return;
        const total = Math.max(0, Number(state.batchTotal) || 0);
        const completed = Math.max(0, Math.min(total, Number(state.batchCompleted) || 0));
        if (!state.enabled || !total) {
            ui.progress.hidden = true;
            ui.progress.classList.remove('is-complete');
            ui.progressBar.max = 1;
            ui.progressBar.value = 0;
            return;
        }

        ui.progress.hidden = false;
        ui.progress.classList.toggle('is-complete', complete);
        ui.progressBar.max = total;
        ui.progressBar.value = completed;
        ui.progressLabel.textContent = `${complete ? 'Complete' : 'Checking'} ${completed}/${total}`;
    }

    function setDiagnostics(value) {
        state.debugBundle = value || null;
        if (!ui.diagnostics) return;
        if (!value) {
            if (ui.technicalDetails) {
                ui.technicalDetails.hidden = true;
                ui.technicalDetails.open = false;
            }
            ui.diagnostics.hidden = true;
            ui.diagnostics.textContent = '';
            return;
        }
        if (ui.technicalDetails) {
            ui.technicalDetails.hidden = false;
            ui.technicalDetails.open = false;
        }
        ui.diagnostics.hidden = false;
        ui.diagnostics.textContent = JSON.stringify(value, null, 2);
    }

    function setDebugExpanded(expanded) {
        const next = Boolean(expanded && ui.debugCheckbox?.checked);
        document.body.classList.toggle('pipe-tracing-debug-expanded', next);
        if (ui.debugExpandButton) {
            ui.debugExpandButton.textContent = next ? 'Compact' : 'Expand';
            ui.debugExpandButton.setAttribute('aria-pressed', String(next));
            ui.debugExpandButton.title = next
                ? 'Return the trace inspector to compact width'
                : 'Give the trace inspector more workspace';
        }
    }

    function setSetupHidden(hidden) {
        const next = Boolean(hidden);
        ui.section?.classList.toggle('pipe-tracing-setup-hidden', next);
        if (ui.setupToggle) {
            ui.setupToggle.textContent = next ? 'Show setup' : 'Hide setup';
            ui.setupToggle.setAttribute('aria-pressed', String(next));
            ui.setupToggle.title = next
                ? 'Show tracing rules, status and actions'
                : 'Hide tracing setup and keep the inspector visible';
        }
    }

    function emitTraceEvent(name, detail = {}) {
        if (typeof window.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
        window.dispatchEvent(new window.CustomEvent(name, { detail }));
    }

    function emitTracingState() {
        emitTraceEvent('pipe-tracing-state', {
            enabled: state.enabled,
            debug: Boolean(ui.debugCheckbox?.checked),
            batchRunning: state.batchRunning,
            batchCompleted: state.batchCompleted,
            batchTotal: state.batchTotal
        });
    }

    function isLineTag(tag) {
        return tag && (tag.tagType === 'line' || LINE_TAG_RE.test(String(tag.tag || '')));
    }

    function getLineTags() {
        return state.tags.filter(isLineTag);
    }

    function getValveTags() {
        return state.tags.filter(isValveTag);
    }

    function clearTraceOverlays() {
        document.querySelectorAll('.pipe-trace-overlay').forEach(element => element.remove());
    }

    function clearTrace() {
        state.requestId += 1;
        state.trace = null;
        state.traceGeometry = null;
        state.debugBundle = null;
        clearTraceOverlays();
        setDiagnostics(null);
        renderDebugInspector(null, null, null);
    }

    function getDebugViewConfig() {
        return {
            enabled: Boolean(ui.debugCheckbox?.checked),
            filtered: ui.debugFilteredCheckbox ? ui.debugFilteredCheckbox.checked : true,
            candidates: ui.debugCandidatesCheckbox ? ui.debugCandidatesCheckbox.checked : true,
            labels: ui.debugLabelsCheckbox ? ui.debugLabelsCheckbox.checked : true,
            seed: ui.debugSeedCheckbox ? ui.debugSeedCheckbox.checked : true
        };
    }

    function roundedDebugPoint(point) {
        return Array.isArray(point)
            ? point.map(value => Number(Number(value || 0).toFixed(2)))
            : null;
    }

    function debugActionLabel(action) {
        const labels = {
            continue: 'CONTINUE',
            'pass-inline-object': 'PASS INLINE',
            'pass-tee-main': 'PASS TEE MAIN',
            'pass-crossing': 'PASS CROSSING',
            'stop-tee': 'STOP TEE',
            'stop-ambiguous-tee': 'STOP AMBIGUOUS TEE',
            'stop-ambiguous-junction': 'STOP COMPLEX JUNCTION',
            'stop-ambiguous-continuation': 'STOP AMBIGUOUS',
            'stop-endpoint': 'STOP ENDPOINT',
            'stop-loop': 'STOP LOOP',
            'stop-no-valid-continuation': 'STOP NO CONTINUATION',
            'stop-safety-limit': 'STOP SAFETY LIMIT'
        };
        return labels[action] || String(action || 'DECISION').replace(/-/g, ' ').toUpperCase();
    }

    function debugActionClass(action) {
        return String(action || 'unknown').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    }

    function debugReasonLabel(reason) {
        const labels = {
            'symmetric-inline-object': 'Continues through a recognised inline object.',
            'compact-inline-object': 'Continues through a compact inline object.',
            'aligned-inline-continuation': 'Continues through an aligned inline object.',
            'aligned-continuation': 'Continues along the clearly aligned pipe.',
            'best aligned continuation': 'Continues along the best supported pipe direction.',
            'one clearly aligned main continuation': 'Continues on the clearly aligned main run.',
            'straight pipe continuation past short symbol stroke': 'Continues straight past a short symbol stroke.',
            endpoint: 'The drawn pipe ends at this node.',
            'cross-or-complex-junction': 'Stops because several continuations compete at this junction.',
            'different-line-tag-ahead': 'Stops before a different tagged line.',
            'tee-junction': 'Stops at a tee without enough evidence to choose a continuation.',
            'competing-tee-continuations': 'Stops because two tee continuations are plausible.',
            'no-valid-continuation': 'Stops because no supported pipe continuation was found.',
            'safety-distance-limit': 'Stops at the tracing safety limit.'
        };
        return labels[reason] || String(reason || 'No reason recorded.').replace(/-/g, ' ');
    }

    function addDebugStat(parent, text, className = '') {
        const stat = document.createElement('span');
        stat.className = `pipe-tracing-debug-stat ${className}`.trim();
        stat.textContent = text;
        parent.appendChild(stat);
        return stat;
    }

    function focusDebugPoint(point) {
        const tag = selectedTag();
        const geometry = state.traceGeometry;
        if (!tag || !geometry || !Array.isArray(point) || !state.pdfDoc) return;

        state.pdfDoc.getPage(tag.page).then(page => {
            const pageDiv = document.getElementById(`page-${tag.page}`);
            const viewer = document.getElementById('viewer-container');
            if (!pageDiv || !viewer) return;

            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const localPoint = viewportPoint(viewport, point);
            const pageRect = pageDiv.getBoundingClientRect();
            const baseWidth = Number(pageDiv.offsetWidth) || Number(viewport.width) || 1;
            const pageScale = pageRect.width / baseWidth || 1;
            const clientX = pageRect.left + localPoint[0] * pageScale;
            const clientY = pageRect.top + localPoint[1] * pageScale;
            const viewerRect = viewer.getBoundingClientRect();
            const sidebarRect = document.getElementById('sidebar')?.getBoundingClientRect();
            const resultsRect = document.getElementById('results-sidebar')?.getBoundingClientRect();
            let visibleLeft = viewerRect.left;
            let visibleRight = viewerRect.right;
            if (sidebarRect && sidebarRect.width > 20 && sidebarRect.right > viewerRect.left) {
                visibleLeft = Math.min(viewerRect.right, Math.max(visibleLeft, sidebarRect.right + 12));
            }
            if (resultsRect && resultsRect.width > 20 && resultsRect.left < viewerRect.right) {
                visibleRight = Math.max(visibleLeft, Math.min(visibleRight, resultsRect.left - 12));
            }
            const visibleCenterX = visibleLeft + Math.max(0, visibleRight - visibleLeft) / 2;
            viewer.scrollTo({
                left: viewer.scrollLeft + clientX - visibleCenterX,
                top: viewer.scrollTop + clientY - (viewerRect.top + viewerRect.height / 2),
                behavior: 'smooth'
            });

            const marker = document.createElement('div');
            marker.className = 'pipe-trace-debug-focus';
            marker.style.left = `${localPoint[0]}px`;
            marker.style.top = `${localPoint[1]}px`;
            marker.title = 'Focused trace decision';
            pageDiv.appendChild(marker);
            window.setTimeout(() => marker.remove(), 2400);
        }).catch(() => {});
    }

    function isDebugIssue(decision) {
        const action = String(decision?.action || '');
        return action.startsWith('stop-') || action.startsWith('pass-');
    }

    function clearDebugMagnifier(message = '') {
        state.debugPreviewRequestId += 1;
        if (ui.debugMagnifier) ui.debugMagnifier.hidden = true;
        if (ui.debugMagnifierTitle) ui.debugMagnifierTitle.textContent = 'Local view';
        if (ui.debugMagnifierMeta) ui.debugMagnifierMeta.textContent = message;
        const ctx = ui.debugMagnifierCanvas?.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, ui.debugMagnifierCanvas.width, ui.debugMagnifierCanvas.height);
    }

    async function renderDebugMagnifier(decision, decisionIndex) {
        const tag = selectedTag();
        const geometry = state.traceGeometry;
        const trace = state.trace;
        const canvas = ui.debugMagnifierCanvas;
        if (!tag || !geometry || !trace || !canvas || !Array.isArray(decision?.point) || !state.pdfDoc) {
            clearDebugMagnifier();
            return;
        }

        const previewRequestId = ++state.debugPreviewRequestId;
        if (ui.debugMagnifier) ui.debugMagnifier.hidden = false;
        if (ui.debugMagnifierTitle) ui.debugMagnifierTitle.textContent = `${decisionIndex + 1}. ${debugActionLabel(decision.action)}`;
        if (ui.debugMagnifierMeta) ui.debugMagnifierMeta.textContent = `Node N${decision.nodeId ?? '?'} · ${debugReasonLabel(decision.reason)}`;
        canvas.setAttribute('aria-label', `Magnified P&ID area around node N${decision.nodeId ?? '?'} for ${debugActionLabel(decision.action)}`);

        try {
            const page = await state.pdfDoc.getPage(tag.page);
            if (previewRequestId !== state.debugPreviewRequestId || trace !== state.trace) return;
            const pageDiv = document.getElementById(`page-${tag.page}`);
            const pageCanvas = pageDiv?.querySelector('canvas:not(.pipe-trace-overlay)');
            if (!pageCanvas) throw new Error('Rendered PDF page is not available');

            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const target = viewportPoint(viewport, decision.point);
            const destinationWidth = canvas.width;
            const destinationHeight = canvas.height;
            const sourceWidth = Math.min(pageCanvas.width, 250);
            const sourceHeight = Math.min(pageCanvas.height, sourceWidth * destinationHeight / destinationWidth);
            const sourceX = Math.max(0, Math.min(pageCanvas.width - sourceWidth, target[0] - sourceWidth / 2));
            const sourceY = Math.max(0, Math.min(pageCanvas.height - sourceHeight, target[1] - sourceHeight / 2));
            const mapPoint = point => {
                const viewportMapped = viewportPoint(viewport, point);
                return [
                    (viewportMapped[0] - sourceX) * destinationWidth / sourceWidth,
                    (viewportMapped[1] - sourceY) * destinationHeight / sourceHeight
                ];
            };

            const ctx = canvas.getContext('2d');
            ctx.save();
            ctx.clearRect(0, 0, destinationWidth, destinationHeight);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, destinationWidth, destinationHeight);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(pageCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, destinationWidth, destinationHeight);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const drawEdge = (edgeId, strokeStyle, lineWidth, dash = []) => {
                const edge = geometry.edges[edgeId];
                const aPoint = edge && geometry.nodes[edge.a]?.point;
                const bPoint = edge && geometry.nodes[edge.b]?.point;
                if (!aPoint || !bPoint) return;
                const a = mapPoint(aPoint);
                const b = mapPoint(bPoint);
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = lineWidth;
                ctx.setLineDash(dash);
                ctx.stroke();
                ctx.setLineDash([]);
            };

            for (const edgeId of trace.component?.edgeIds || []) {
                drawEdge(edgeId, 'rgba(0, 166, 104, 0.78)', 7);
            }

            const selectedEdgeIds = new Set(Array.isArray(decision.selectedEdgeIds)
                ? decision.selectedEdgeIds
                : decision.selectedEdgeId == null ? [] : [decision.selectedEdgeId]);
            for (const candidate of decision.candidates || []) {
                drawEdge(
                    candidate.edgeId,
                    selectedEdgeIds.has(candidate.edgeId) ? '#00a668' : '#f97316',
                    selectedEdgeIds.has(candidate.edgeId) ? 8 : 7,
                    selectedEdgeIds.has(candidate.edgeId) ? [] : [14, 10]
                );
            }

            const node = mapPoint(decision.point);
            ctx.beginPath();
            ctx.arc(node[0], node[1], 14, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(124, 58, 237, 0.13)';
            ctx.fill();
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(node[0] - 21, node[1]);
            ctx.lineTo(node[0] + 21, node[1]);
            ctx.moveTo(node[0], node[1] - 21);
            ctx.lineTo(node[0], node[1] + 21);
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
        } catch (error) {
            if (previewRequestId !== state.debugPreviewRequestId) return;
            clearDebugMagnifier('Local view unavailable until the PDF page has rendered.');
        }
    }

    function updateDebugIssueNavigation() {
        const count = state.debugIssues.length;
        const cursor = count ? Math.max(0, Math.min(state.debugIssueCursor, count - 1)) : -1;
        state.debugIssueCursor = cursor;
        if (ui.debugIssueNav) ui.debugIssueNav.hidden = !count;
        if (ui.debugFirstIssueButton) ui.debugFirstIssueButton.disabled = !count;
        if (ui.debugPreviousIssueButton) ui.debugPreviousIssueButton.disabled = count < 2;
        if (ui.debugNextIssueButton) ui.debugNextIssueButton.disabled = count < 2;
        if (ui.debugIssuePosition) ui.debugIssuePosition.textContent = count ? `Issue ${cursor + 1} of ${count}` : 'Issue 0 of 0';
    }

    function activateDebugDecision(decisionIndex, options = {}) {
        const decisions = state.trace?.component?.decisionRecords || [];
        const decision = decisions[decisionIndex];
        const card = ui.debugDecisions?.querySelector(`[data-decision-index="${decisionIndex}"]`);
        if (!decision || !card) return;
        ui.debugDecisions.querySelectorAll('.is-active').forEach(item => item.classList.remove('is-active'));
        card.classList.add('is-active');
        const issueCursor = state.debugIssues.indexOf(decisionIndex);
        if (issueCursor >= 0) state.debugIssueCursor = issueCursor;
        updateDebugIssueNavigation();
        renderDebugMagnifier(decision, decisionIndex);
        if (options.focus !== false) focusDebugPoint(decision.point);
        if (options.scroll !== false) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function moveDebugIssue(delta, focus = true) {
        const count = state.debugIssues.length;
        if (!count) return;
        state.debugIssueCursor = delta === 0
            ? 0
            : (state.debugIssueCursor + delta + count) % count;
        activateDebugDecision(state.debugIssues[state.debugIssueCursor], { focus });
    }

    function focusDebugRoute() {
        const tag = selectedTag();
        const geometry = state.traceGeometry;
        const trace = state.trace;
        if (!tag || !geometry || !trace?.component?.nodeIds?.length) return;

        const points = trace.component.nodeIds
            .map(nodeId => geometry.nodes[nodeId]?.point)
            .filter(Boolean);
        if (!points.length) return;
        const center = points.reduce((result, point) => [result[0] + point[0], result[1] + point[1]], [0, 0])
            .map(value => value / points.length);
        focusDebugPoint(center);
    }

    async function copyDebugBundle() {
        if (!state.debugBundle) return;
        const text = JSON.stringify(state.debugBundle, null, 2);
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const helper = document.createElement('textarea');
                helper.value = text;
                helper.setAttribute('readonly', '');
                helper.style.position = 'fixed';
                helper.style.opacity = '0';
                document.body.appendChild(helper);
                helper.select();
                document.execCommand('copy');
                helper.remove();
            }
            setStatus('Trace debug bundle copied to clipboard.', 'ok');
        } catch (error) {
            setStatus(`Could not copy trace debug bundle: ${error.message}`, 'error');
        }
    }

    function renderDebugInspector(trace, geometry, tag) {
        if (!ui.debugInspector) return;

        const visible = Boolean(ui.debugCheckbox?.checked);
        ui.debugInspector.hidden = !visible;
        if (ui.debugFocusRouteButton) ui.debugFocusRouteButton.disabled = !trace || !geometry || !tag;
        if (ui.debugCopyButton) ui.debugCopyButton.disabled = !state.debugBundle;
        if (!visible) {
            state.debugIssues = [];
            state.debugIssueCursor = -1;
            updateDebugIssueNavigation();
            clearDebugMagnifier();
            return;
        }

        if (!trace || !geometry || !tag) {
            if (ui.debugSummary) {
                ui.debugSummary.replaceChildren();
                addDebugStat(ui.debugSummary, 'Enable tracing or select a line.', 'is-muted');
            }
            if (ui.debugDecisions) {
                ui.debugDecisions.replaceChildren();
            }
            state.debugIssues = [];
            state.debugIssueCursor = -1;
            updateDebugIssueNavigation();
            clearDebugMagnifier();
            return;
        }

        const component = trace.component || {};
        const decisions = Array.isArray(trace.component?.decisionRecords)
            ? trace.component.decisionRecords
            : [];
        const stops = decisions.filter(decision => String(decision.action || '').startsWith('stop-'));
        const inlinePasses = decisions.filter(decision => decision.action === 'pass-inline-object').length;
        const lineBoundaryCount = (component.lineBoundaries || []).length;
        const crossingPasses = decisions.filter(decision => decision.action === 'pass-crossing').length;
        const teeCount = (component.teeJunctions || component.branches || []).length;
        const overlapCount = (component.routeOverlaps || []).length;
        const valveCount = (trace.valves || []).filter(valve => valve.status === 'assigned').length;
        const valveReviewCount = (trace.valves || []).filter(valve => valve.status === 'review').length;

        if (ui.debugSummary) {
            ui.debugSummary.replaceChildren();
            const heading = document.createElement('strong');
            heading.className = 'pipe-tracing-debug-summary__line';
            heading.textContent = tag.tag;
            ui.debugSummary.appendChild(heading);

            const outcome = document.createElement('div');
            outcome.className = `pipe-tracing-debug-summary__outcome ${stops.length ? 'is-review' : 'is-clear'}`;
            outcome.textContent = `${component.edgeIds?.length || 0} connected segments · ${Number(trace.routeLength || 0).toFixed(0)} px · ${stops.length} stop${stops.length === 1 ? '' : 's'}`;
            ui.debugSummary.appendChild(outcome);

            const keyFacts = document.createElement('div');
            keyFacts.className = 'pipe-tracing-debug-summary__facts';
            addDebugStat(keyFacts, `${lineBoundaryCount} tagged boundar${lineBoundaryCount === 1 ? 'y' : 'ies'}`, lineBoundaryCount ? 'is-ok' : 'is-muted');
            addDebugStat(keyFacts, `${inlinePasses} inline passed`, inlinePasses ? 'is-inline' : 'is-muted');
            addDebugStat(keyFacts, `${teeCount} tee`, teeCount ? 'is-warning' : 'is-muted');
            addDebugStat(keyFacts, `${crossingPasses} crossing`, crossingPasses ? 'is-crossing' : 'is-muted');
            ui.debugSummary.appendChild(keyFacts);

            const more = document.createElement('details');
            more.className = 'pipe-tracing-debug-summary__more';
            const moreSummary = document.createElement('summary');
            moreSummary.textContent = 'More route metrics';
            const moreBody = document.createElement('div');
            moreBody.className = 'pipe-tracing-debug-summary__more-body';
            addDebugStat(moreBody, `${decisions.length} decisions`);
            addDebugStat(moreBody, `graph ${geometry.nodes.length}N / ${geometry.edges.length}E`);
            addDebugStat(moreBody, `${geometry.segments.length} filtered vectors`);
            addDebugStat(moreBody, `${overlapCount} overlap`, overlapCount ? 'is-warning' : 'is-muted');
            addDebugStat(moreBody, `${valveCount} valves linked`, valveCount ? 'is-ok' : 'is-muted');
            addDebugStat(moreBody, `${valveReviewCount} valve review`, valveReviewCount ? 'is-warning' : 'is-muted');
            more.append(moreSummary, moreBody);
            ui.debugSummary.appendChild(more);
        }

        if (!ui.debugDecisions) return;
        ui.debugDecisions.replaceChildren();
        if (!decisions.length) {
            const empty = document.createElement('div');
            empty.className = 'pipe-tracing-debug-empty';
            empty.textContent = 'No graph decisions were recorded.';
            ui.debugDecisions.appendChild(empty);
            return;
        }

        const junctionByNode = new Map(
            (component.teeJunctions || component.branches || []).map(junction => [junction.nodeId, junction])
        );
        const maxVisibleDecisions = 140;
        state.debugIssues = decisions
            .map((decision, index) => isDebugIssue(decision) ? index : -1)
            .filter(index => index >= 0 && index < maxVisibleDecisions);
        state.debugIssueCursor = state.debugIssues.length ? 0 : -1;
        updateDebugIssueNavigation();
        decisions.slice(0, maxVisibleDecisions).forEach((decision, index) => {
            const action = String(decision.action || 'decision');
            const card = document.createElement('article');
            card.className = `pipe-tracing-debug-decision action-${debugActionClass(action)}`;
            card.dataset.nodeId = String(decision.nodeId ?? '');
            card.dataset.decisionIndex = String(index);

            const header = document.createElement('div');
            header.className = 'pipe-tracing-debug-decision__header';
            const title = document.createElement('strong');
            title.textContent = `${index + 1}. ${debugActionLabel(action)}`;
            const meta = document.createElement('span');
            meta.textContent = `N${decision.nodeId ?? '?'} · degree ${decision.degree ?? '?'} · ${Number(decision.routeDistance || 0).toFixed(0)} px${decision.side ? ` · ${decision.side}` : ''}`;
            header.append(title, meta);
            card.appendChild(header);

            const reason = document.createElement('div');
            reason.className = 'pipe-tracing-debug-decision__reason';
            reason.textContent = debugReasonLabel(decision.reason);
            card.appendChild(reason);

            if (decision.candidates?.length) {
                const candidates = document.createElement('div');
                candidates.className = 'pipe-tracing-debug-candidates';
                decision.candidates.forEach(candidate => {
                    const chip = document.createElement('span');
                    const selected = Array.isArray(decision.selectedEdgeIds)
                        ? decision.selectedEdgeIds.includes(candidate.edgeId)
                        : decision.selectedEdgeId === candidate.edgeId;
                    chip.className = `pipe-tracing-debug-candidate ${selected ? 'is-selected' : 'is-alternative'}`;
                    chip.textContent = `e${candidate.edgeId} ${candidate.angle ?? '?'}°${selected ? ' ✓' : ''}`;
                    chip.title = `${candidate.geometryType || candidate.kind || 'edge'} · score ${candidate.score ?? '?'} · source ${candidate.sourcePath ?? 'n/a'}`;
                    candidates.appendChild(chip);
                });
                card.appendChild(candidates);
            }

            const junction = junctionByNode.get(decision.nodeId);
            const connectedTags = (junction?.connectedLineTags || decision.connectedLineTags || [])
                .map(lineTag => lineTag.tag)
                .filter(Boolean);
            if (connectedTags.length) {
                const connections = document.createElement('div');
                connections.className = 'pipe-tracing-debug-decision__connections';
                connections.textContent = `Connected tags: ${Array.from(new Set(connectedTags)).join(', ')}`;
                card.appendChild(connections);
            }

            if (decision.inlineProbe) {
                const probe = document.createElement('div');
                probe.className = `pipe-tracing-debug-decision__probe ${decision.inlineProbe.accepted ? 'is-accepted' : 'is-rejected'}`;
                const reasons = decision.inlineProbe.symbolEvidence?.evidenceReasons || decision.inlineProbe.evidenceReasons || [];
                probe.textContent = decision.inlineProbe.accepted
                    ? `Inline proof: ${reasons.join(', ') || decision.inlineProbe.reason || 'accepted'}`
                    : `Inline rejected: ${decision.inlineProbe.rejectedReason || 'no clear symbol evidence'}`;
                card.appendChild(probe);
            }

            const footer = document.createElement('div');
            footer.className = 'pipe-tracing-debug-decision__footer';
            const distance = document.createElement('span');
            distance.textContent = `route ${Number(decision.routeDistance || 0).toFixed(1)} px`;
            footer.appendChild(distance);
            const focusButton = document.createElement('button');
            focusButton.className = 'btn-mini';
            focusButton.type = 'button';
            focusButton.textContent = 'Show on P&ID';
            focusButton.title = 'Center this decision in the PDF';
            focusButton.addEventListener('click', event => {
                event.stopPropagation();
                activateDebugDecision(index);
            });
            footer.appendChild(focusButton);
            const detailsButton = document.createElement('button');
            detailsButton.className = 'btn-mini pipe-tracing-debug-details-btn';
            detailsButton.type = 'button';
            detailsButton.textContent = 'Evidence';
            detailsButton.setAttribute('aria-expanded', 'false');
            detailsButton.addEventListener('click', event => {
                event.stopPropagation();
                const expanded = card.classList.toggle('is-expanded');
                detailsButton.textContent = expanded ? 'Hide evidence' : 'Evidence';
                detailsButton.setAttribute('aria-expanded', String(expanded));
            });
            footer.appendChild(detailsButton);
            card.appendChild(footer);
            card.addEventListener('click', () => {
                activateDebugDecision(index);
            });
            ui.debugDecisions.appendChild(card);
        });

        if (decisions.length > maxVisibleDecisions) {
            const note = document.createElement('div');
            note.className = 'pipe-tracing-debug-empty';
            note.textContent = `${decisions.length - maxVisibleDecisions} less important decisions hidden from the inspector.`;
            ui.debugDecisions.appendChild(note);
        }
        if (state.debugIssues.length) activateDebugDecision(state.debugIssues[0], { focus: false, scroll: false });
    }

    function redrawCurrentTrace() {
        const tag = selectedTag();
        if (!state.trace || !state.traceGeometry || !tag || !state.pdfDoc) return;
        const trace = state.trace;
        state.pdfDoc.getPage(tag.page).then(page => {
            if (state.trace !== trace) return;
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            drawTrace(document.getElementById(`page-${tag.page}`), viewport, state.traceGeometry, trace, tag, getDebugViewConfig());
        }).catch(() => {});
    }

    function updateSectionToggle() {
        if (!ui.sectionToggle) return;
        const isCollapsed = ui.sectionTools?.classList.contains('collapsed');
        ui.sectionToggle.textContent = state.enabled ? (isCollapsed ? 'Show' : 'Hide') : 'Enable';
        ui.sectionToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }

    function handleSectionToggle() {
        if (!state.enabled) {
            if (ui.sectionTools) ui.sectionTools.classList.remove('collapsed');
            setEnabled(true);
            return;
        }

        if (ui.sectionTools) ui.sectionTools.classList.toggle('collapsed');
        updateSectionToggle();
    }

    function selectedTag() {
        if (!Number.isInteger(state.selectedTagId)) return null;
        return state.tags.find(tag => tag.id === state.selectedTagId) || null;
    }

    function updateTraceButtons() {
        if (ui.traceAllButton) {
            ui.traceAllButton.disabled = !state.enabled || state.batchRunning || state.traceRunning || !getLineTags().length;
        }
    }

    function selectTag(tag) {
        if (state.batchRunning) return false;
        const tagId = typeof tag === 'object' ? tag?.id : Number(tag);
        const selected = state.tags.find(candidate => candidate.id === tagId);
        if (!selected || !isLineTag(selected)) return false;

        state.selectedTagId = selected.id;
        clearTrace();

        if (state.enabled) {
            updateTraceButtons();
            setStatus(`Selected ${selected.tag}. Tracing...`);
            traceSelectedLine();
        }

        return true;
    }

    function setEnabled(enabled) {
        if (!state.pdfDoc && enabled) {
            setStatus('Load and audit a PDF before enabling tracing.', 'error');
            return;
        }

        const wasEnabled = state.enabled;
        state.enabled = enabled;
        clearTrace();

        if (ui.toggle) {
            ui.toggle.textContent = enabled ? 'Disable Pipe Tracing' : 'Enable Pipe Tracing';
            ui.toggle.classList.toggle('btn-secondary', enabled);
            ui.toggle.classList.toggle('btn-compare', !enabled);
        }
        document.body.classList.toggle('pipe-tracing-click-mode', enabled);
        if (ui.controls) ui.controls.hidden = !enabled;
        updateSectionToggle();
        if (!enabled) {
            state.batchRunning = false;
            state.batchCompleted = 0;
            state.batchTotal = 0;
            updateBatchProgress();
        }

        if (enabled) {
            const lineCount = getLineTags().length;
            state.batchCompleted = 0;
            state.batchTotal = lineCount;
            updateBatchProgress();
            setStatus(
                !lineCount
                    ? 'No line tags were detected. Enable Line tags during the audit.'
                    : `Checking ${lineCount} line${lineCount === 1 ? '' : 's'}...`,
                lineCount ? '' : 'warning'
            );
        } else {
            state.selectedTagId = null;
            setStatus('Pipe tracing is disabled.');
        }
        updateTraceButtons();
        emitTracingState();
        if (enabled && !wasEnabled && getLineTags().length) void traceAllLines();
    }

    function setDocumentReady(pdfDoc, tags) {
        state.pdfDoc = pdfDoc || null;
        state.tags = Array.isArray(tags) ? tags : [];
        state.selectedTagId = null;
        state.geometryCache.clear();
        state.traceResults.clear();
        state.valveAssociations.clear();
        state.batchCompleted = 0;
        state.batchTotal = 0;
        updateBatchProgress();
        clearTrace();

        if (ui.toggle) {
            ui.toggle.disabled = !state.pdfDoc;
        }
        if (ui.sectionToggle) {
            ui.sectionToggle.disabled = !state.pdfDoc;
        }

        emitTraceEvent('pipe-trace-reset');
        reconcileValveAssociations();
        emitTracingState();

        if (state.enabled) {
            setEnabled(false);
        } else if (state.pdfDoc) {
            setStatus('Audit complete. Enable tracing to check all lines.');
        }
    }

    function reset() {
        state.pdfDoc = null;
        state.tags = [];
        state.selectedTagId = null;
        state.geometryCache.clear();
        state.traceResults.clear();
        state.valveAssociations.clear();
        state.batchCompleted = 0;
        state.batchTotal = 0;
        setEnabled(false);
        if (ui.toggle) ui.toggle.disabled = true;
        if (ui.sectionToggle) ui.sectionToggle.disabled = true;
        setStatus('Load a PDF before enabling tracing.');
        emitTraceEvent('pipe-trace-reset');
        reconcileValveAssociations();
        emitTracingState();
    }

    function setTagsChanged(tags) {
        state.tags = Array.isArray(tags) ? tags : [];
        const validTagIds = new Set(state.tags.map(tag => tag?.id));
        for (const tagId of state.traceResults.keys()) {
            if (!validTagIds.has(tagId)) state.traceResults.delete(tagId);
        }
        reconcileValveAssociations();
        if (!selectedTag()) state.selectedTagId = null;
        updateTraceButtons();
        emitTracingState();
    }

    function identityMatrix() {
        return [1, 0, 0, 1, 0, 0];
    }

    function multiplyMatrices(left, right) {
        if (window.pdfjsLib?.Util?.transform) {
            return window.pdfjsLib.Util.transform(left, right);
        }
        return [
            left[0] * right[0] + left[2] * right[1],
            left[1] * right[0] + left[3] * right[1],
            left[0] * right[2] + left[2] * right[3],
            left[1] * right[2] + left[3] * right[3],
            left[0] * right[4] + left[2] * right[5] + left[4],
            left[1] * right[4] + left[3] * right[5] + left[5]
        ];
    }

    function transformPoint(matrix, x, y) {
        return [
            matrix[0] * x + matrix[2] * y + matrix[4],
            matrix[1] * x + matrix[3] * y + matrix[5]
        ];
    }

    function pointDistance(a, b) {
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }

    function distancePointToSegment(point, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) return pointDistance(point, a);
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
        return pointDistance(point, [a[0] + t * dx, a[1] + t * dy]);
    }

    function cross(a, b) {
        return a[0] * b[1] - a[1] * b[0];
    }

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1];
    }

    function subtract(a, b) {
        return [a[0] - b[0], a[1] - b[1]];
    }

    function add(a, b) {
        return [a[0] + b[0], a[1] + b[1]];
    }

    function scalePoint(a, scalar) {
        return [a[0] * scalar, a[1] * scalar];
    }

    function lengthVector(a) {
        return Math.hypot(a[0], a[1]);
    }

    function normalizeVector(a) {
        const length = lengthVector(a);
        return length ? [a[0] / length, a[1] / length] : [0, 0];
    }

    function cubicPoint(p0, p1, p2, p3, t) {
        const u = 1 - t;
        return add(
            add(scalePoint(p0, u * u * u), scalePoint(p1, 3 * u * u * t)),
            add(scalePoint(p2, 3 * u * t * t), scalePoint(p3, t * t * t))
        );
    }

    function pathAddPoint(path, point) {
        if (!path.current) {
            path.current = [];
            path.subpaths.push(path.current);
        }
        path.current.push(point);
    }

    function pathMoveTo(path, point) {
        path.current = [];
        path.subpaths.push(path.current);
        path.current.push(point);
    }

    function pathLineTo(path, point) {
        pathAddPoint(path, point);
    }

    function pathCurveTo(path, controls) {
        if (!path.current || !path.current.length) {
            pathMoveTo(path, controls[2]);
            return;
        }

        path.hasCurves = true;
        const p0 = path.current[path.current.length - 1];
        const [p1, p2, p3] = controls;
        for (let step = 1; step <= 8; step++) {
            path.current.push(cubicPoint(p0, p1, p2, p3, step / 8));
        }
    }

    function addPathSegments(path, segments, style, pathIndex, paths) {
        const pathRecord = {
            pathIndex,
            closed: Boolean(path.closed),
            hasCurves: Boolean(path.hasCurves),
            subpaths: path.subpaths.map(subpath => subpath.map(point => point.slice()))
        };

        path.subpaths.forEach((subpath, subpathIndex) => {
            if (!subpath || subpath.length < 2) return;

            const subpathClosed = isClosedSubpath(subpath, path);
            const centerline = thinRectangleCenterline(subpath, subpathClosed, path.hasCurves, style.strokeWidth);
            if (centerline) {
                segments.push({
                    a: centerline.a,
                    b: centerline.b,
                    length: centerline.length,
                    strokeWidth: style.strokeWidth,
                    dashed: style.dashed,
                    pathIndex,
                    subpathIndex,
                    pathClosed: true,
                    geometryType: 'thin-rectangle-centerline',
                    kind: 'vector-stroke'
                });
                return;
            }

            for (let i = 1; i < subpath.length; i++) {
                const a = subpath[i - 1];
                const b = subpath[i];
                const length = pointDistance(a, b);
                if (length < 0.75) continue;
                segments.push({
                    a,
                    b,
                    length,
                    strokeWidth: style.strokeWidth,
                    dashed: style.dashed,
                    pathIndex,
                    subpathIndex,
                    pathClosed: subpathClosed,
                    kind: 'vector-stroke'
                });
            }
        });

        paths.push(pathRecord);
    }

    function consumeConstructPath(path, args, ctm) {
        const operations = args?.[0] || [];
        const coordinates = args?.[1] || [];
        let coordinateIndex = 0;

        for (const operation of operations) {
            if (operation === 13) { // moveTo
                pathMoveTo(path, transformPoint(ctm, coordinates[coordinateIndex], coordinates[coordinateIndex + 1]));
                coordinateIndex += 2;
            } else if (operation === 14) { // lineTo
                pathLineTo(path, transformPoint(ctm, coordinates[coordinateIndex], coordinates[coordinateIndex + 1]));
                coordinateIndex += 2;
            } else if (operation === 15) { // curveTo
                pathCurveTo(path, [
                    transformPoint(ctm, coordinates[coordinateIndex], coordinates[coordinateIndex + 1]),
                    transformPoint(ctm, coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3]),
                    transformPoint(ctm, coordinates[coordinateIndex + 4], coordinates[coordinateIndex + 5])
                ]);
                coordinateIndex += 6;
            } else if (operation === 16) { // curveTo2
                const current = path.current?.[path.current.length - 1] || [0, 0];
                pathCurveTo(path, [
                    current,
                    transformPoint(ctm, coordinates[coordinateIndex], coordinates[coordinateIndex + 1]),
                    transformPoint(ctm, coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3])
                ]);
                coordinateIndex += 4;
            } else if (operation === 17) { // curveTo3
                const current = path.current?.[path.current.length - 1] || [0, 0];
                const end = transformPoint(ctm, coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3]);
                pathCurveTo(path, [
                    transformPoint(ctm, coordinates[coordinateIndex], coordinates[coordinateIndex + 1]),
                    end,
                    end
                ]);
                coordinateIndex += 4;
            } else if (operation === 19) { // rectangle
                const x = Number(coordinates[coordinateIndex]);
                const y = Number(coordinates[coordinateIndex + 1]);
                const width = Number(coordinates[coordinateIndex + 2]);
                const height = Number(coordinates[coordinateIndex + 3]);
                pathMoveTo(path, transformPoint(ctm, x, y));
                pathLineTo(path, transformPoint(ctm, x + width, y));
                pathLineTo(path, transformPoint(ctm, x + width, y + height));
                pathLineTo(path, transformPoint(ctm, x, y + height));
                closeCurrentPath(path);
                coordinateIndex += 4;
            } else if (operation === 18) { // closePath
                closeCurrentPath(path);
            }
        }
    }

    function closeCurrentPath(path) {
        const current = path.current;
        if (!current || current.length < 2) return;
        const first = current[0];
        const last = current[current.length - 1];
        if (pointDistance(first, last) > 0.01) current.push(first.slice());
        path.closed = true;
    }

    function extractVectorSegments(operatorList) {
        const OPS = window.pdfjsLib?.OPS || {};
        const segments = [];
        const paths = [];
        const counts = {};
        const stateStack = [];
        let ctm = identityMatrix();
        let path = { subpaths: [], current: null, closed: false, hasCurves: false };
        let strokeWidth = 1;
        let dashed = false;
        let pathIndex = 0;

        const nameByValue = new Map(Object.entries(OPS).map(([name, value]) => [value, name]));
        const count = (operation) => {
            const name = nameByValue.get(operation) || String(operation);
            counts[name] = (counts[name] || 0) + 1;
        };
        const resetPath = () => {
            path = { subpaths: [], current: null, closed: false, hasCurves: false };
        };
        const strokePath = () => {
            if (path.subpaths.length) addPathSegments(path, segments, { strokeWidth, dashed }, pathIndex++, paths);
            resetPath();
        };

        const fnArray = operatorList?.fnArray || [];
        const argsArray = operatorList?.argsArray || [];

        for (let index = 0; index < fnArray.length; index++) {
            const operation = fnArray[index];
            const args = argsArray[index] || [];
            count(operation);

            if (operation === OPS.save) {
                stateStack.push({ ctm: ctm.slice(), strokeWidth, dashed });
            } else if (operation === OPS.restore) {
                const previous = stateStack.pop();
                if (previous) {
                    ctm = previous.ctm;
                    strokeWidth = previous.strokeWidth;
                    dashed = previous.dashed;
                }
            } else if (operation === OPS.transform) {
                if (args.length >= 6) ctm = multiplyMatrices(ctm, Array.from(args.slice(0, 6)));
            } else if (operation === OPS.paintFormXObjectBegin) {
                stateStack.push({ ctm: ctm.slice(), strokeWidth, dashed, form: true });
                const matrix = args[0];
                if (matrix && matrix.length >= 6) ctm = multiplyMatrices(ctm, Array.from(matrix.slice(0, 6)));
            } else if (operation === OPS.paintFormXObjectEnd) {
                let previous = stateStack.pop();
                while (previous && !previous.form) previous = stateStack.pop();
                if (previous) {
                    ctm = previous.ctm;
                    strokeWidth = previous.strokeWidth;
                    dashed = previous.dashed;
                }
                resetPath();
            } else if (operation === OPS.setLineWidth) {
                strokeWidth = Number(args[0]) || strokeWidth;
            } else if (operation === OPS.setDash) {
                const dashArray = args[0];
                dashed = Array.isArray(dashArray) || ArrayBuffer.isView(dashArray)
                    ? dashArray.length > 0
                    : false;
            } else if (operation === OPS.moveTo) {
                pathMoveTo(path, transformPoint(ctm, args[0], args[1]));
            } else if (operation === OPS.lineTo) {
                pathLineTo(path, transformPoint(ctm, args[0], args[1]));
            } else if (operation === OPS.curveTo) {
                pathCurveTo(path, [
                    transformPoint(ctm, args[0], args[1]),
                    transformPoint(ctm, args[2], args[3]),
                    transformPoint(ctm, args[4], args[5])
                ]);
            } else if (operation === OPS.curveTo2) {
                const current = path.current?.[path.current.length - 1] || [0, 0];
                pathCurveTo(path, [
                    current,
                    transformPoint(ctm, args[0], args[1]),
                    transformPoint(ctm, args[2], args[3])
                ]);
            } else if (operation === OPS.curveTo3) {
                const end = transformPoint(ctm, args[2], args[3]);
                pathCurveTo(path, [
                    transformPoint(ctm, args[0], args[1]),
                    end,
                    end
                ]);
            } else if (operation === OPS.rectangle) {
                const x = Number(args[0]);
                const y = Number(args[1]);
                const width = Number(args[2]);
                const height = Number(args[3]);
                pathMoveTo(path, transformPoint(ctm, x, y));
                pathLineTo(path, transformPoint(ctm, x + width, y));
                pathLineTo(path, transformPoint(ctm, x + width, y + height));
                pathLineTo(path, transformPoint(ctm, x, y + height));
                closeCurrentPath(path);
            } else if (operation === OPS.constructPath) {
                consumeConstructPath(path, args, ctm);
            } else if (operation === OPS.closePath) {
                closeCurrentPath(path);
            } else if (operation === OPS.stroke || operation === OPS.closeStroke || operation === OPS.fillStroke ||
                operation === OPS.eoFillStroke || operation === OPS.closeFillStroke || operation === OPS.closeEOFillStroke) {
                if (operation === OPS.closeStroke || operation === OPS.closeFillStroke || operation === OPS.closeEOFillStroke) {
                    closeCurrentPath(path);
                }
                strokePath();
            } else if (operation === OPS.fill || operation === OPS.eoFill || operation === OPS.endPath) {
                resetPath();
            }
        }

        return { segments, paths, counts };
    }

    function median(values) {
        if (!values.length) return 1;
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function bboxForSegment(segment, padding = 0) {
        return {
            minX: Math.min(segment.a[0], segment.b[0]) - padding,
            minY: Math.min(segment.a[1], segment.b[1]) - padding,
            maxX: Math.max(segment.a[0], segment.b[0]) + padding,
            maxY: Math.max(segment.a[1], segment.b[1]) + padding
        };
    }

    function bboxesOverlap(a, b) {
        return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    }

    function gridKey(x, y) {
        return `${x}:${y}`;
    }

    function addToGrid(grid, cellSize, point, value) {
        const x = Math.floor(point[0] / cellSize);
        const y = Math.floor(point[1] / cellSize);
        const key = gridKey(x, y);
        let values = grid.get(key);
        if (!values) {
            values = [];
            grid.set(key, values);
        }
        values.push(value);
    }

    function addToGridCell(grid, x, y, value) {
        const key = gridKey(x, y);
        let values = grid.get(key);
        if (!values) {
            values = [];
            grid.set(key, values);
        }
        values.push(value);
    }

    function queryGrid(grid, cellSize, point, radius) {
        const minX = Math.floor((point[0] - radius) / cellSize);
        const maxX = Math.floor((point[0] + radius) / cellSize);
        const minY = Math.floor((point[1] - radius) / cellSize);
        const maxY = Math.floor((point[1] + radius) / cellSize);
        const result = new Set();
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (const value of grid.get(gridKey(x, y)) || []) result.add(value);
            }
        }
        return result;
    }

    function bboxForPoints(points, padding = 0) {
        if (!points?.length) return null;
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        return {
            minX: Math.min(...xs) - padding,
            minY: Math.min(...ys) - padding,
            maxX: Math.max(...xs) + padding,
            maxY: Math.max(...ys) + padding
        };
    }

    function bboxWidth(box) {
        return box ? Math.max(0, box.maxX - box.minX) : 0;
    }

    function bboxHeight(box) {
        return box ? Math.max(0, box.maxY - box.minY) : 0;
    }

    function bboxArea(box) {
        return bboxWidth(box) * bboxHeight(box);
    }

    function bboxDistance(a, b) {
        if (!a || !b) return Infinity;
        const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
        const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
        return Math.hypot(dx, dy);
    }

    function tagRectCorners(tag) {
        const rect = tag?.pdfRect;
        if (!rect) return [];

        const x = Number(rect.x) || 0;
        const y = Number(rect.y) || 0;
        const width = Math.max(0, Number(rect.width) || 0);
        const height = Math.max(0, Number(rect.height) || 0);
        const rotation = Number(rect.rotation);
        const radians = Number.isFinite(rotation) ? rotation * Math.PI / 180 : 0;
        const baseline = [Math.cos(radians), Math.sin(radians)];
        const vertical = [-Math.sin(radians), Math.cos(radians)];
        const origin = [x, y];
        const widthVector = scalePoint(baseline, width);
        const heightVector = scalePoint(vertical, height);
        return [
            origin,
            add(origin, widthVector),
            add(origin, heightVector),
            add(add(origin, widthVector), heightVector)
        ];
    }

    function bboxForTag(tag) {
        const corners = tagRectCorners(tag);
        return corners.length ? bboxForPoints(corners) : null;
    }

    function textBoxFromItem(item) {
        const transform = item?.transform;
        if (!transform || transform.length < 6 || !String(item.str || '').trim()) return null;

        const x = Number(transform[4]) || 0;
        const y = Number(transform[5]) || 0;
        const width = Math.max(0, Number(item.width) || 0);
        const height = Math.max(1, Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0), Number(item.height) || 0);
        const baseline = normalizeVector([Number(transform[0]) || 0, Number(transform[1]) || 0]);
        const vertical = normalizeVector([Number(transform[2]) || 0, Number(transform[3]) || 0]);
        const widthVector = scalePoint(lengthVector(baseline) ? baseline : [1, 0], width);
        const heightVector = scalePoint(lengthVector(vertical) ? vertical : [0, 1], height);
        const corners = [
            [x, y],
            add([x, y], widthVector),
            add([x, y], heightVector),
            add(add([x, y], widthVector), heightVector)
        ];

        return {
            text: String(item.str || ''),
            bbox: bboxForPoints(corners),
            height
        };
    }

    function extractTextBoxes(textContent) {
        return (textContent?.items || []).map(textBoxFromItem).filter(Boolean);
    }

    function uniquePathVertices(points) {
        if (!points?.length) return [];
        const vertices = [];
        for (const point of points) {
            if (!vertices.length || pointDistance(vertices[vertices.length - 1], point) > 0.5) {
                vertices.push(point.slice());
            }
        }
        if (vertices.length > 1 && pointDistance(vertices[0], vertices[vertices.length - 1]) <= 0.5) {
            vertices.pop();
        }
        return vertices;
    }

    function isClosedSubpath(points, path) {
        if (!points?.length) return false;
        if (pointDistance(points[0], points[points.length - 1]) <= 0.5) return true;
        return Boolean(path?.closed && path?.subpaths?.length === 1);
    }

    // A number of CAD/PDF exporters draw a pipe as a very thin closed
    // rectangle. Keeping both rails and both end caps makes one physical pipe
    // look like a high-degree junction after intersection snapping. Replace
    // only the unmistakable long, thin, four-sided outlines with their
    // centreline. This preserves real valve/fitting polygons and ordinary
    // rectangular annotations.
    function thinRectangleCenterline(points, closed, hasCurves, strokeWidth) {
        if (!closed || hasCurves) return null;

        const vertices = uniquePathVertices(points);
        if (vertices.length === 3) {
            const lengths = vertices.map((point, index) => pointDistance(point, vertices[(index + 1) % vertices.length]));
            const shortIndex = lengths.indexOf(Math.min(...lengths));
            const longIndices = lengths.map((_, index) => index).filter(index => index !== shortIndex);
            const longLengths = longIndices.map(index => lengths[index]);
            const shortLength = lengths[shortIndex];
            const longLength = (longLengths[0] + longLengths[1]) / 2;
            const minimumLongLength = Math.max(36, Math.abs(Number(strokeWidth) || 1) * 10);
            const capStart = vertices[shortIndex];
            const capEnd = vertices[(shortIndex + 1) % 3];
            const apex = vertices[(shortIndex + 2) % 3];
            const capMidpoint = scalePoint(add(capStart, capEnd), 0.5);
            const firstRailDirection = normalizeVector(subtract(capStart, apex));
            const secondRailDirection = normalizeVector(subtract(capEnd, apex));
            const railAgreement = dot(firstRailDirection, secondRailDirection);

            // Some exporters emit a thin ribbon as two long, almost parallel
            // edges plus one short cap, rather than as four rectangle edges.
            // Collapse only that unmistakable shape to the line between the
            // cap midpoint and its opposite apex.
            if (longLength < minimumLongLength || shortLength < 0.2 ||
                longLength / Math.max(0.01, shortLength) < 8 ||
                Math.max(...longLengths) / Math.max(0.01, Math.min(...longLengths)) > 1.35 ||
                railAgreement < 0.88) return null;

            const centerlineLength = pointDistance(apex, capMidpoint);
            if (centerlineLength < minimumLongLength * 0.75) return null;
            return { a: apex, b: capMidpoint, length: centerlineLength, width: shortLength };
        }

        if (vertices.length !== 4) return null;

        const lengths = vertices.map((point, index) => pointDistance(point, vertices[(index + 1) % vertices.length]));
        const firstPairIsLong = lengths[0] + lengths[2] >= lengths[1] + lengths[3];
        const longIndices = firstPairIsLong ? [0, 2] : [1, 3];
        const shortIndices = firstPairIsLong ? [1, 3] : [0, 2];
        const longLengths = longIndices.map(index => lengths[index]);
        const shortLengths = shortIndices.map(index => lengths[index]);
        const longLength = (longLengths[0] + longLengths[1]) / 2;
        const shortLength = (shortLengths[0] + shortLengths[1]) / 2;
        const minimumLongLength = Math.max(36, Math.abs(Number(strokeWidth) || 1) * 10);

        if (longLength < minimumLongLength || shortLength < 0.2) return null;
        if (longLength / Math.max(0.01, shortLength) < 8) return null;
        if (Math.max(...longLengths) / Math.max(0.01, Math.min(...longLengths)) > 1.35) return null;
        if (Math.max(...shortLengths) / Math.max(0.01, Math.min(...shortLengths)) > 1.5) return null;

        const longStart = firstPairIsLong ? vertices[0] : vertices[1];
        const longEnd = firstPairIsLong ? vertices[1] : vertices[2];
        const shortDirection = firstPairIsLong
            ? normalizeVector(subtract(vertices[3], vertices[0]))
            : normalizeVector(subtract(vertices[1], vertices[0]));
        const longDirection = normalizeVector(subtract(longEnd, longStart));
        if (Math.abs(dot(longDirection, shortDirection)) > 0.3) return null;

        const centerA = firstPairIsLong
            ? scalePoint(add(vertices[0], vertices[3]), 0.5)
            : scalePoint(add(vertices[0], vertices[1]), 0.5);
        const centerB = firstPairIsLong
            ? scalePoint(add(vertices[1], vertices[2]), 0.5)
            : scalePoint(add(vertices[2], vertices[3]), 0.5);
        const centerlineLength = pointDistance(centerA, centerB);
        if (centerlineLength < minimumLongLength * 0.75) return null;

        return { a: centerA, b: centerB, length: centerlineLength, width: shortLength };
    }

    function polygonArea(points) {
        if (!points || points.length < 3) return 0;
        let area = 0;
        for (let index = 0; index < points.length; index++) {
            const current = points[index];
            const next = points[(index + 1) % points.length];
            area += current[0] * next[1] - next[0] * current[1];
        }
        return Math.abs(area) / 2;
    }

    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
            const currentPoint = polygon[index];
            const previousPoint = polygon[previous];
            const intersects = ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])) &&
                point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) /
                    ((previousPoint[1] - currentPoint[1]) || Number.EPSILON) + currentPoint[0];
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function summarizeVectorPath(pathRecord) {
        const isSingleSubpath = pathRecord.subpaths.length === 1;
        const points = isSingleSubpath ? uniquePathVertices(pathRecord.subpaths[0]) : [];
        const sourcePoints = isSingleSubpath ? pathRecord.subpaths[0] : [];
        const implicitlyClosed = sourcePoints.length >= 4 && pointDistance(sourcePoints[0], sourcePoints[sourcePoints.length - 1]) <= 0.5;
        const closed = Boolean((pathRecord.closed || implicitlyClosed) && isSingleSubpath);
        const closedPoints = closed ? points : [];
        const bbox = bboxForPoints(points);
        const edgeLengths = points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            return closed || index < points.length - 1 ? pointDistance(point, next) : 0;
        }).filter(length => length > 0);
        const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0);
        const maxSegmentLength = edgeLengths.length ? Math.max(...edgeLengths) : 0;
        const width = bboxWidth(bbox);
        const height = bboxHeight(bbox);
        const maxDimension = Math.max(width, height);
        const minDimension = Math.max(0.01, Math.min(width, height));
        const aspectRatio = maxDimension / minDimension;
        const area = closed ? polygonArea(closedPoints) : 0;

        return {
            pathIndex: pathRecord.pathIndex,
            closed,
            hasCurves: Boolean(pathRecord.hasCurves),
            points,
            vertexCount: points.length,
            bbox,
            width,
            height,
            maxDimension,
            aspectRatio,
            area,
            perimeter,
            maxSegmentLength,
            segmentCount: edgeLengths.length
        };
    }

    function hasPlausiblePipeContinuation(summary, rawSegments, typicalWidth, snapTolerance, compactLimit) {
        if (!summary.points.length || !summary.bbox) return false;

        const supportLength = Math.max(24, compactLimit * 0.75, typicalWidth * 30);
        const attachmentTolerance = Math.max(3, snapTolerance, typicalWidth * 5);
        const attachments = [];

        for (const segment of rawSegments) {
            if (segment.pathIndex === summary.pathIndex || segment.dashed || segment.length < supportLength) continue;
            const endpoints = [segment.a, segment.b];
            endpoints.forEach((endpoint, endpointIndex) => {
                let nearestVertex = -1;
                let nearestDistance = Infinity;
                summary.points.forEach((vertex, vertexIndex) => {
                    const distance = pointDistance(endpoint, vertex);
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestVertex = vertexIndex;
                    }
                });
                if (nearestVertex < 0 || nearestDistance > attachmentTolerance) return;
                const other = endpoints[endpointIndex === 0 ? 1 : 0];
                attachments.push({
                    vertexIndex: nearestVertex,
                    direction: normalizeVector(subtract(other, endpoint)),
                    segment
                });
            });

            const segmentBox = bboxForSegment(segment, attachmentTolerance);
            if (!bboxesOverlap(segmentBox, summary.bbox)) continue;
            const midpoint = [(segment.a[0] + segment.b[0]) / 2, (segment.a[1] + segment.b[1]) / 2];
            if (pointInPolygon(midpoint, summary.points)) return true;
        }

        // Two long, opposing continuations are much stronger evidence of a
        // real pipe route than a single short stem attached to an annotation.
        for (let first = 0; first < attachments.length; first++) {
            for (let second = first + 1; second < attachments.length; second++) {
                const left = attachments[first];
                const right = attachments[second];
                if (left.vertexIndex === right.vertexIndex) continue;
                const agreement = left.direction[0] * right.direction[0] + left.direction[1] * right.direction[1];
                if (agreement <= -0.7) return true;
            }
        }

        return false;
    }

    function classifyNonPipeGeometry(pathRecord, context) {
        const summary = summarizeVectorPath(pathRecord);
        if (!summary.bbox) return null;

        const pageBounds = context.pageBounds;
        const pageWidth = bboxWidth(pageBounds);
        const pageHeight = bboxHeight(pageBounds);
        const pageArea = bboxArea(pageBounds);
        const pageMinDimension = Math.max(1, Math.min(pageWidth, pageHeight));
        const nearbyText = context.textBoxes
            .map(item => ({ item, distance: bboxDistance(summary.bbox, item.bbox) }))
            .filter(candidate => candidate.distance <= Math.max(14, context.typicalWidth * 14))
            .sort((a, b) => a.distance - b.distance);
        const nearbyTags = context.lineTags
            .map(tag => ({ tag, distance: bboxDistance(summary.bbox, bboxForTag(tag)) }))
            .filter(candidate => candidate.distance <= Math.max(20, Number(candidate.tag.pdfRect?.height) * 4 || 0, context.typicalWidth * 20))
            .sort((a, b) => a.distance - b.distance);
        const nearbyTextHeight = nearbyText[0]?.item.height || 0;
        const compactLimit = Math.min(
            Math.max(48, context.typicalWidth * 80, nearbyTextHeight * 10),
            Math.max(72, pageMinDimension * 0.18)
        );
        const compact = summary.maxDimension <= compactLimit && summary.aspectRatio <= 5;
        const smallArea = summary.closed && summary.area > Math.max(1, context.typicalWidth * context.typicalWidth * 4) &&
            summary.area <= Math.max(1600, compactLimit * compactLimit * 0.75, pageArea * 0.003);
        const polygonal = summary.closed && !summary.hasCurves && summary.vertexCount >= 3 && summary.vertexCount <= 8 &&
            summary.area > 0 && summary.area / Math.max(1, summary.width * summary.height) >= 0.12;
        const notLongPipeLike = summary.maxSegmentLength <= Math.max(32, compactLimit * 0.95) &&
            summary.perimeter <= Math.max(120, compactLimit * 3.6);
        const nearText = nearbyText.length > 0;
        const nearLineTag = nearbyTags.length > 0;
        const plausibleContinuation = hasPlausiblePipeContinuation(
            summary,
            context.rawSegments,
            context.typicalWidth,
            context.snapTolerance,
            compactLimit
        );
        const hasStrongLineTagSupport = context.rawSegments.some(segment =>
            segment.pathIndex === summary.pathIndex &&
            isStrongLineTagSupport(segment, context.rawSegments, context)
        );
        const atPageBoundary = Math.min(
            Math.abs(summary.bbox.minX - pageBounds.minX),
            Math.abs(summary.bbox.maxX - pageBounds.maxX),
            Math.abs(summary.bbox.minY - pageBounds.minY),
            Math.abs(summary.bbox.maxY - pageBounds.maxY)
        ) <= Math.max(8, context.typicalWidth * 8);
        const likelyBorderOrTitleBlock = summary.closed && polygonal && atPageBoundary &&
            summary.maxDimension >= pageMinDimension * 0.45 && !nearLineTag;
        const shortLeader = !summary.closed && nearText && summary.segmentCount >= 2 && summary.segmentCount <= 5 &&
            summary.maxDimension <= compactLimit * 1.5 && summary.perimeter <= Math.max(100, compactLimit * 3) &&
            !plausibleContinuation && !hasStrongLineTagSupport;

        if (likelyBorderOrTitleBlock) {
            return {
                ...summary,
                type: 'annotation-candidate',
                reason: 'drawing border or title-block closed geometry',
                excludedFromPipeGraph: true,
                evidence: { closed: true, polygonal, atPageBoundary, compact: false, nearText, nearLineTag, plausibleContinuation }
            };
        }

        const smallClosedAnnotation = summary.closed && compact && smallArea && polygonal && notLongPipeLike &&
            nearText && !plausibleContinuation && !hasStrongLineTagSupport;
        if (smallClosedAnnotation) {
            const reason = summary.vertexCount === 3
                ? 'small closed triangular geometry'
                : 'small closed polygon associated with nearby text';
            return {
                ...summary,
                type: 'annotation-candidate',
                reason,
                excludedFromPipeGraph: true,
                nearbyText: nearbyText.slice(0, 3).map(candidate => candidate.item.text),
                nearbyLineTags: nearbyTags.slice(0, 3).map(candidate => candidate.tag.tag),
                evidence: { closed: true, smallArea, compact, polygonal, notLongPipeLike, nearText, nearLineTag, plausibleContinuation }
            };
        }

        if (shortLeader) {
            return {
                ...summary,
                type: 'annotation-candidate',
                reason: 'short text-associated leader or comment geometry',
                excludedFromPipeGraph: true,
                nearbyText: nearbyText.slice(0, 3).map(candidate => candidate.item.text),
                nearbyLineTags: nearbyTags.slice(0, 3).map(candidate => candidate.tag.tag),
                evidence: { closed: false, compact: true, nearText, nearLineTag, plausibleContinuation }
            };
        }

        return null;
    }

    function segmentTagAlignment(segment, tag) {
        const rotation = Number(tag?.pdfRect?.rotation);
        if (!Number.isFinite(rotation)) return 0.5;

        const direction = normalizeVector(subtract(segment.b, segment.a));
        const radians = rotation * Math.PI / 180;
        const tagAxis = [Math.cos(radians), Math.sin(radians)];
        return Math.abs(direction[0] * tagAxis[0] + direction[1] * tagAxis[1]);
    }

    // Text masks and leaders can sit on top of the pipe they label. When a
    // filter candidate touches that geometry, keep the strongest long stroke
    // that is both close to the tag and aligned with the tag orientation. This
    // prevents an actual vertical/horizontal pipe from being removed as an
    // annotation companion while still dropping short note leaders.
    function isStrongLineTagSupport(segment, rawSegments, context) {
        if (!segment || segment.dashed || segment.length < 1.5) return false;

        const typicalWidth = Number(context.typicalWidth) || 1;
        for (const tag of context.lineTags || []) {
            const center = getTagCenter(tag);
            const rect = tag?.pdfRect || {};
            if (!center) continue;

            const tagWidth = Math.max(Number(rect.width) || 0, Number(rect.height) || 0);
            const tagHeight = Math.min(Number(rect.width) || 0, Number(rect.height) || 0);
            const minimumLength = Math.max(24, tagWidth * 0.5, typicalWidth * 10);
            if (segment.length < minimumLength) continue;

            const alignment = segmentTagAlignment(segment, tag);
            if (Number.isFinite(Number(rect.rotation)) && alignment < 0.68) continue;

            const distance = distancePointToSegment(center, segment.a, segment.b);
            const supportRadius = Math.max(24, tagWidth * 0.7, tagHeight * 6, typicalWidth * 14);
            if (distance > supportRadius) continue;

            const directionPenalty = (1 - alignment) * Math.max(16, tagWidth * 0.3);
            const score = distance + directionPenalty;
            const bestScore = rawSegments
                .filter(candidate => candidate !== segment && !candidate.dashed && candidate.length >= minimumLength)
                .map(candidate => {
                    const candidateAlignment = segmentTagAlignment(candidate, tag);
                    if (Number.isFinite(Number(rect.rotation)) && candidateAlignment < 0.68) return Infinity;
                    const candidateDistance = distancePointToSegment(center, candidate.a, candidate.b);
                    if (candidateDistance > supportRadius) return Infinity;
                    return candidateDistance + (1 - candidateAlignment) * Math.max(16, tagWidth * 0.3);
                })
                .reduce((best, candidateScore) => Math.min(best, candidateScore), Infinity);

            // Duplicated PDF strokes for one pipe can differ by a few units;
            // allow that small spread but do not keep a second, unrelated pipe
            // that merely happens to be nearby.
            if (score <= (Number.isFinite(bestScore) ? bestScore : score) + Math.max(12, typicalWidth * 3)) {
                return true;
            }
        }

        return false;
    }

    function isAnnotationCompanionSegment(segment, candidate, rawSegments, context) {
        if (segment.pathIndex === candidate.pathIndex || segment.dashed || !candidate.bbox) return false;
        if (!candidate.evidence?.nearText && !candidate.evidence?.nearLineTag) return false;

        if (isStrongLineTagSupport(segment, rawSegments, context)) return false;

        const proximity = Math.max(5, context.typicalWidth * 8, candidate.maxDimension * 0.35);
        if (!bboxesOverlap(bboxForSegment(segment, proximity), candidate.bbox)) return false;

        const shortLimit = Math.max(28, candidate.maxDimension * 1.5, context.typicalWidth * 50);
        if (segment.length > shortLimit) return false;

        const supportLength = Math.max(24, candidate.maxDimension * 0.75, context.typicalWidth * 30);
        const endpointTolerance = Math.max(3, context.snapTolerance, context.typicalWidth * 5);
        const hasLongContinuation = rawSegments.some(other => {
            if (other === segment || other.pathIndex === candidate.pathIndex || other.dashed || other.length < supportLength) return false;
            return [segment.a, segment.b].some(endpoint =>
                pointDistance(endpoint, other.a) <= endpointTolerance || pointDistance(endpoint, other.b) <= endpointTolerance
            );
        });
        return !hasLongContinuation;
    }

    // Explicit pre-graph filtering stage. The excluded paths remain available
    // for debug rendering and diagnostics, but never become graph edges.
    function filterNonPipeGeometry(rawSegments, pathRecords, context) {
        const candidates = pathRecords
            .map(pathRecord => classifyNonPipeGeometry(pathRecord, { ...context, rawSegments }))
            .filter(Boolean);
        const excludedPathIndices = new Set(candidates.filter(candidate => candidate.excludedFromPipeGraph).map(candidate => candidate.pathIndex));
        const excludedSegments = rawSegments.filter(segment => excludedPathIndices.has(segment.pathIndex));
        const companionSegments = rawSegments.filter(segment =>
            !excludedPathIndices.has(segment.pathIndex) &&
            candidates.some(candidate => isAnnotationCompanionSegment(segment, candidate, rawSegments, context))
        );
        const excludedSegmentSet = new Set([...excludedSegments, ...companionSegments]);
        return {
            candidates,
            excludedSegments: Array.from(excludedSegmentSet),
            segments: rawSegments.filter(segment => !excludedSegmentSet.has(segment))
        };
    }

    function segmentIntersections(a, b, c, d, tolerance) {
        const r = subtract(b, a);
        const s = subtract(d, c);
        const cMinusA = subtract(c, a);
        const rLength = lengthVector(r);
        const sLength = lengthVector(s);
        if (rLength < 1e-9 || sLength < 1e-9) return [];

        const denominator = cross(r, s);

        if (Math.abs(denominator) < 1e-9) {
            // Split collinear overlaps at both overlap boundaries. Without
            // this, a short line drawn over part of a longer line never
            // becomes connected to the longer graph edge.
            if (Math.abs(cross(cMinusA, r)) > tolerance * rLength ||
                Math.abs(cross(subtract(a, c), s)) > tolerance * sLength) return [];

            const rr = dot(r, r);
            const tC = dot(cMinusA, r) / rr;
            const tD = dot(subtract(d, a), r) / rr;
            const overlapStart = Math.max(0, Math.min(tC, tD));
            const overlapEnd = Math.min(1, Math.max(tC, tD));
            const parameterTolerance = tolerance / Math.max(rLength, 1);
            if (overlapStart > overlapEnd + parameterTolerance) return [];

            const values = Math.abs(overlapEnd - overlapStart) <= parameterTolerance
                ? [Math.max(0, Math.min(1, (overlapStart + overlapEnd) / 2))]
                : [Math.max(0, Math.min(1, overlapStart)), Math.max(0, Math.min(1, overlapEnd))];
            const ss = dot(s, s);
            return values.map(t => {
                const point = add(a, scalePoint(r, t));
                return {
                    t,
                    u: Math.max(0, Math.min(1, dot(subtract(point, c), s) / ss))
                };
            });
        }

        const t = cross(cMinusA, s) / denominator;
        const u = cross(cMinusA, r) / denominator;
        const tTolerance = tolerance / Math.max(rLength, 1);
        const uTolerance = tolerance / Math.max(sLength, 1);
        if (t < -tTolerance || t > 1 + tTolerance || u < -uTolerance || u > 1 + uTolerance) return [];
        return [{ t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) }];
    }

    function createNodeIndex(tolerance) {
        const nodes = [];
        const grid = new Map();
        const cellSize = Math.max(tolerance * 2, 4);

        function findOrCreate(point) {
            const candidates = queryGrid(grid, cellSize, point, tolerance);
            for (const nodeId of candidates) {
                if (pointDistance(nodes[nodeId].point, point) <= tolerance) return nodeId;
            }
            const nodeId = nodes.length;
            nodes.push({ id: nodeId, point: point.slice(), edges: [] });
            addToGrid(grid, cellSize, point, nodeId);
            return nodeId;
        }

        return { nodes, findOrCreate };
    }

    function buildGraph(rawSegments, page, options = {}) {
        const pageBounds = getPageBounds(page);
        const sourcePathMetadata = new Map((options.pathRecords || []).map(pathRecord => {
            const summary = summarizeVectorPath(pathRecord);
            return [pathRecord.pathIndex, {
                closed: summary.closed,
                hasCurves: summary.hasCurves,
                perimeter: summary.perimeter,
                maxDimension: summary.maxDimension,
                aspectRatio: summary.aspectRatio,
                area: summary.area,
                segmentCount: summary.segmentCount,
                vertexCount: summary.vertexCount
            }];
        }));
        const rawTypicalWidth = median(rawSegments
            .map(segment => Math.abs(segment.strokeWidth))
            .filter(width => width > 0));
        const filtered = filterNonPipeGeometry(rawSegments, options.pathRecords || [], {
            pageBounds,
            textBoxes: options.textBoxes || [],
            lineTags: options.lineTags || [],
            typicalWidth: rawTypicalWidth,
            snapTolerance: Math.max(1.5, Math.min(6, rawTypicalWidth * 3))
        });
        const usableSegments = filtered.segments.filter(segment => !segment.dashed && segment.length >= 1.5);
        const widths = usableSegments.map(segment => Math.abs(segment.strokeWidth)).filter(width => width > 0);
        const typicalWidth = median(widths);
        const snapTolerance = Math.max(1.5, Math.min(6, typicalWidth * 3));
        const intersectionCellSize = Math.max(16, snapTolerance * 8);
        const splitValues = usableSegments.map(() => [0, 1]);
        const segmentGrid = new Map();

        usableSegments.forEach((segment, index) => {
            const box = bboxForSegment(segment, snapTolerance);
            const minX = Math.floor(box.minX / intersectionCellSize);
            const maxX = Math.floor(box.maxX / intersectionCellSize);
            const minY = Math.floor(box.minY / intersectionCellSize);
            const maxY = Math.floor(box.maxY / intersectionCellSize);
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) addToGridCell(segmentGrid, x, y, index);
            }
        });

        // Add split points for clear crossings without performing an O(n^2)
        // comparison across the entire page.
        const checkedPairs = new Set();
        usableSegments.forEach((segment, index) => {
            const box = bboxForSegment(segment, snapTolerance);
            const minX = Math.floor(box.minX / intersectionCellSize);
            const maxX = Math.floor(box.maxX / intersectionCellSize);
            const minY = Math.floor(box.minY / intersectionCellSize);
            const maxY = Math.floor(box.maxY / intersectionCellSize);
            const candidates = new Set();
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (const other of segmentGrid.get(gridKey(x, y)) || []) candidates.add(other);
                }
            }

            for (const otherIndex of candidates) {
                if (otherIndex <= index) continue;
                const pairKey = `${index}:${otherIndex}`;
                if (checkedPairs.has(pairKey)) continue;
                checkedPairs.add(pairKey);
                const other = usableSegments[otherIndex];
                if (!bboxesOverlap(box, bboxForSegment(other, snapTolerance))) continue;
                const intersections = segmentIntersections(segment.a, segment.b, other.a, other.b, snapTolerance);
                for (const intersection of intersections) {
                    splitValues[index].push(intersection.t);
                    splitValues[otherIndex].push(intersection.u);
                }
            }
        });

        const nodeIndex = createNodeIndex(snapTolerance);
        const edges = [];
        const uniqueEdges = new Set();

        usableSegments.forEach((segment, index) => {
            const values = Array.from(new Set(splitValues[index].map(value => Math.max(0, Math.min(1, value)).toFixed(6))))
                .map(value => Number(value))
                .sort((a, b) => a - b);

            for (let valueIndex = 1; valueIndex < values.length; valueIndex++) {
                const t0 = values[valueIndex - 1];
                const t1 = values[valueIndex];
                const a = add(segment.a, scalePoint(subtract(segment.b, segment.a), t0));
                const b = add(segment.a, scalePoint(subtract(segment.b, segment.a), t1));
                if (pointDistance(a, b) < 1.5) continue;

                const nodeA = nodeIndex.findOrCreate(a);
                const nodeB = nodeIndex.findOrCreate(b);
                if (nodeA === nodeB) continue;
                const key = nodeA < nodeB ? `${nodeA}:${nodeB}` : `${nodeB}:${nodeA}`;
                if (uniqueEdges.has(key)) continue;
                uniqueEdges.add(key);
                const sourcePath = sourcePathMetadata.get(segment.pathIndex) || {};
                edges.push({
                    id: edges.length,
                    a: nodeA,
                    b: nodeB,
                    length: pointDistance(nodeIndex.nodes[nodeA].point, nodeIndex.nodes[nodeB].point),
                    strokeWidth: segment.strokeWidth,
                    kind: 'pipe-segment',
                    geometryType: segment.geometryType || 'raw-stroke',
                    sourcePath: segment.pathIndex,
                    sourceLength: segment.length,
                    sourcePathClosed: Boolean(sourcePath.closed || segment.pathClosed),
                    sourcePathHasCurves: Boolean(sourcePath.hasCurves),
                    sourcePathPerimeter: Number(sourcePath.perimeter) || segment.length,
                    sourcePathMaxDimension: Number(sourcePath.maxDimension) || segment.length,
                    sourcePathAspectRatio: Number(sourcePath.aspectRatio) || null,
                    sourcePathArea: Number(sourcePath.area) || 0,
                    sourcePathSegmentCount: Number(sourcePath.segmentCount) || 1,
                    sourcePathVertexCount: Number(sourcePath.vertexCount) || 0
                });
            }
        });

        const adjacency = nodeIndex.nodes.map(() => []);
        edges.forEach(edge => {
            adjacency[edge.a].push(edge.id);
            adjacency[edge.b].push(edge.id);
            nodeIndex.nodes[edge.a].edges.push(edge.id);
            nodeIndex.nodes[edge.b].edges.push(edge.id);
        });

        // Bridge only short, approximately collinear gaps between terminal
        // nodes. The segment directions must point toward one another. This
        // prevents a nearby perpendicular branch from being treated as an
        // inline continuation.
        const nodeGrid = new Map();
        // CAD exports often split one visible pipe at symbols, text masks, or
        // form boundaries. Allow a larger gap, but only for terminal nodes
        // whose directions face one another and whose line weights agree.
        const bridgeTolerance = Math.max(12, Math.min(36, snapTolerance * 6));
        nodeIndex.nodes.forEach(node => addToGrid(nodeGrid, bridgeTolerance, node.point, node.id));
        const bridges = [];

        for (const node of nodeIndex.nodes) {
            if (adjacency[node.id].length !== 1) continue;
            const edge = edges[adjacency[node.id][0]];
            const otherNodeId = edge.a === node.id ? edge.b : edge.a;
            const direction = normalizeVector(subtract(node.point, nodeIndex.nodes[otherNodeId].point));
            for (const candidateId of queryGrid(nodeGrid, bridgeTolerance, node.point, bridgeTolerance)) {
                if (candidateId <= node.id) continue;
                const candidate = nodeIndex.nodes[candidateId];
                if (adjacency[candidateId].length !== 1) continue;
                const distance = pointDistance(node.point, candidate.point);
                if (distance <= snapTolerance || distance > bridgeTolerance) continue;
                const candidateEdge = edges[adjacency[candidateId][0]];
                const candidateOtherId = candidateEdge.a === candidateId ? candidateEdge.b : candidateEdge.a;
                const candidateDirection = normalizeVector(subtract(candidate.point, nodeIndex.nodes[candidateOtherId].point));
                const towardCandidate = normalizeVector(subtract(candidate.point, node.point));
                const towardNode = normalizeVector(subtract(node.point, candidate.point));
                const directionAgreement = direction[0] * towardCandidate[0] + direction[1] * towardCandidate[1];
                const candidateAgreement = candidateDirection[0] * towardNode[0] + candidateDirection[1] * towardNode[1];
                const opposingDirections = direction[0] * candidateDirection[0] + direction[1] * candidateDirection[1];
                const widthRatio = Math.max(Math.abs(edge.strokeWidth), Math.abs(candidateEdge.strokeWidth)) /
                    Math.max(0.01, Math.min(Math.abs(edge.strokeWidth), Math.abs(candidateEdge.strokeWidth)));

                if (directionAgreement < 0.88 || candidateAgreement < 0.88 || opposingDirections > -0.88) continue;
                if (widthRatio > 2.5) continue;

                // If more than one terminal is an equally plausible facing
                // continuation, leave the area for the directional tracer to
                // report as ambiguous instead of creating a bridge here.
                const competingCandidates = Array.from(queryGrid(nodeGrid, bridgeTolerance, node.point, bridgeTolerance))
                    .filter(otherId => otherId !== node.id && adjacency[otherId].length === 1)
                    .filter(otherId => {
                        const other = nodeIndex.nodes[otherId];
                        const gap = pointDistance(node.point, other.point);
                        if (gap <= snapTolerance || gap > bridgeTolerance) return false;
                        const otherEdge = edges[adjacency[otherId][0]];
                        const otherNeighborId = otherEdge.a === otherId ? otherEdge.b : otherEdge.a;
                        const otherDirection = normalizeVector(subtract(other.point, nodeIndex.nodes[otherNeighborId].point));
                        const toOther = normalizeVector(subtract(other.point, node.point));
                        const otherToNode = normalizeVector(subtract(node.point, other.point));
                        return otherId === candidateId ||
                            (direction[0] * toOther[0] + direction[1] * toOther[1] >= 0.88 &&
                                otherDirection[0] * otherToNode[0] + otherDirection[1] * otherToNode[1] >= 0.88);
                    });
                if (competingCandidates.length > 1) continue;

                const bridge = {
                    id: edges.length,
                    a: node.id,
                    b: candidateId,
                    length: distance,
                    strokeWidth: typicalWidth,
                    kind: 'component-gap',
                    candidate: true
                };
                edges.push(bridge);
                adjacency[node.id].push(bridge.id);
                adjacency[candidateId].push(bridge.id);
                nodeIndex.nodes[node.id].edges.push(bridge.id);
                nodeIndex.nodes[candidateId].edges.push(bridge.id);
                bridges.push(bridge);
            }
        }

        return {
            page,
            rawSegments,
            segments: usableSegments,
            annotationCandidates: filtered.candidates,
            excludedSegments: filtered.excludedSegments,
            nodes: nodeIndex.nodes,
            edges,
            adjacency,
            bridges,
            typicalWidth,
            snapTolerance,
            bridgeTolerance
        };
    }

    function getTagCenter(tag) {
        const corners = tagRectCorners(tag);
        if (!corners.length) return null;
        return scalePoint(corners.reduce((sum, point) => add(sum, point), [0, 0]), 1 / corners.length);
    }

    function getSeedRadius(tag, geometry) {
        const rect = tag?.pdfRect || {};
        const localSize = Math.max(Number(rect.height) || 0, (Number(rect.width) || 0) * 0.18);
        return Math.max(24, Math.min(140, localSize * 3.2, geometry.bridgeTolerance * 12));
    }

    function findSeedEdges(geometry, tag) {
        const center = getTagCenter(tag);
        if (!center) return { center: null, candidates: [], selected: null };

        const rect = tag?.pdfRect || {};
        const radius = getSeedRadius(tag, geometry);
        const orientationKnown = Number.isFinite(Number(rect.rotation));
        const labelWidth = Math.max(Number(rect.width) || 0, Number(rect.height) || 0);

        const candidates = geometry.edges
            .filter(edge => edge.kind !== 'component-gap')
            .map(edge => {
                const a = geometry.nodes[edge.a].point;
                const b = geometry.nodes[edge.b].point;
                const distance = distancePointToSegment(center, a, b);
                const alignment = segmentTagAlignment({ a, b }, tag);
                const shortSource = Number(edge.sourceLength) < Math.max(24, labelWidth * 0.45);
                const orientationPenalty = orientationKnown ? (1 - alignment) * radius * 0.85 : 0;
                const shortSourcePenalty = shortSource ? radius * 0.2 : 0;
                return {
                    edge,
                    distance,
                    alignment,
                    orientationKnown,
                    shortSource,
                    score: distance + orientationPenalty + shortSourcePenalty
                };
            })
            .sort((a, b) => a.score - b.score || a.distance - b.distance);

        const viable = candidates.filter(candidate =>
            candidate.distance <= radius && (!orientationKnown || candidate.alignment >= 0.62)
        );
        return {
            center,
            radius,
            candidates: candidates.slice(0, 8),
            selected: viable[0] || null
        };
    }

    function findNearestEdge(geometry, point) {
        let nearest = null;
        for (const edge of geometry.edges) {
            if (edge.kind === 'component-gap') continue;
            const a = geometry.nodes[edge.a].point;
            const b = geometry.nodes[edge.b].point;
            const distance = distancePointToSegment(point, a, b);
            if (!nearest || distance < nearest.distance) nearest = { edge, distance };
        }
        return nearest;
    }

    function findLineTagAtPoint(geometry, pageNumber, point) {
        const nearest = findNearestEdge(geometry, point);
        const clickTolerance = Math.max(12, geometry.typicalWidth * 6, geometry.snapTolerance * 3);
        if (!nearest || nearest.distance > clickTolerance) return null;

        const candidates = getLineTags()
            .filter(tag => tag.page === pageNumber)
            .map(tag => {
                const seed = findSeedEdges(geometry, tag);
                const seedEdge = seed.selected?.edge;
                const center = getTagCenter(tag);
                return {
                    tag,
                    seedEdge,
                    centerDistance: center ? pointDistance(point, center) : Infinity,
                    seedDistance: seedEdge
                        ? distancePointToSegment(point, geometry.nodes[seedEdge.a].point, geometry.nodes[seedEdge.b].point)
                        : Infinity
                };
            })
            .filter(candidate => candidate.seedEdge);

        if (!candidates.length) return null;

        // PDF.js keeps the source path index on extracted segments. Prefer a
        // tag whose seed belongs to the same drawn path as the clicked edge;
        // this lets a click anywhere along a long pipe resolve to its nearby
        // detected line tag rather than the nearest text label on the page.
        const clickedSourcePath = nearest.edge.sourcePath;
        const pathMatches = candidates.filter(candidate => candidate.seedEdge.sourcePath === clickedSourcePath);
        if (pathMatches.length) {
            pathMatches.sort((a, b) => a.centerDistance - b.centerDistance);
            return pathMatches[0].tag;
        }

        // Fallback for PDFs that split a visually continuous pipe into
        // different source paths. Only accept a nearby seed so an unrelated
        // line tag is not selected from across the sheet.
        candidates.sort((a, b) => a.seedDistance - b.seedDistance);
        return candidates[0].seedDistance <= Math.max(80, clickTolerance * 5) ? candidates[0].tag : null;
    }

    function pdfPointFromClick(pageDiv, viewport, event) {
        const rect = pageDiv.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        const viewportX = (event.clientX - rect.left) * viewport.width / rect.width;
        const viewportY = (event.clientY - rect.top) * viewport.height / rect.height;
        if (viewport.convertToPdfPoint) return viewport.convertToPdfPoint(viewportX, viewportY);
        return [viewportX / RENDER_SCALE, viewportY / RENDER_SCALE];
    }

    async function handlePdfClick(event) {
        if (!state.enabled || !state.pdfDoc) return;

        const pageDiv = event.target?.closest?.('.pdf-page');
        if (!pageDiv) return;
        const pageNumber = Number(String(pageDiv.id || '').replace('page-', ''));
        if (!Number.isInteger(pageNumber)) return;

        const requestId = ++state.requestId;
        setStatus('Finding the nearest detected line...');

        try {
            const page = await state.pdfDoc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const point = pdfPointFromClick(pageDiv, viewport, event);
            if (!point || requestId !== state.requestId || !state.enabled) return;

            const geometry = await getGeometry(pageNumber, page);
            if (requestId !== state.requestId || !state.enabled) return;

            const tag = findLineTagAtPoint(geometry, pageNumber, point);
            if (!tag) {
                setStatus('No detected line was found at that PDF location.', 'warning');
                return;
            }

            selectTag(tag);
        } catch (error) {
            console.error('Pipe tracing PDF click failed:', error);
            setStatus(`Could not select a line from that PDF click: ${error.message}`, 'error');
        }
    }

    function edgeDirectionFromNode(geometry, edge, nodeId) {
        const otherNodeId = edge.a === nodeId ? edge.b : edge.a;
        return normalizeVector(subtract(geometry.nodes[otherNodeId].point, geometry.nodes[nodeId].point));
    }

    function angleBetweenDirections(a, b) {
        const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
        return Math.acos(dot) * 180 / Math.PI;
    }

    function edgeSourceLength(edge) {
        return Math.max(Number(edge?.sourceLength) || 0, Number(edge?.length) || 0);
    }

    function inlineLineScale(geometry) {
        const bridgeTolerance = Number(geometry?.bridgeTolerance) || 12;
        const typicalWidth = Number(geometry?.typicalWidth) || 1;
        return Math.max(28, bridgeTolerance * 2.5, typicalWidth * 45);
    }

    function inlineSymbolEvidence(geometry, edgeRecords, compactSpan) {
        const symbolScale = inlineLineScale(geometry);
        const compactLimit = symbolScale * 2.25;
        const bridgeTolerance = Number(geometry?.bridgeTolerance) || 12;
        const typicalWidth = Number(geometry?.typicalWidth) || 1;
        const shortLimit = Math.max(54, bridgeTolerance * 5, typicalWidth * 70);
        const compact = Number.isFinite(compactSpan) && compactSpan <= compactLimit;
        const usableEdges = (edgeRecords || []).filter(edge =>
            edge && edge.kind !== 'component-gap' && edge.geometryType !== 'thin-rectangle-centerline'
        );
        const compactEdges = usableEdges.filter(edge => {
            const sourceDimension = Number(edge.sourcePathMaxDimension) || edgeSourceLength(edge);
            return sourceDimension > 0 && sourceDimension <= compactLimit;
        });
        const closedShapePaths = new Set(
            compactEdges.filter(edge => edge.sourcePathClosed).map(edge => edge.sourcePath ?? `edge:${edge.id}`)
        );
        const curvedPaths = new Set(
            compactEdges.filter(edge => edge.sourcePathHasCurves).map(edge => edge.sourcePath ?? `edge:${edge.id}`)
        );
        const shortEdges = compactEdges.filter(edge => edgeSourceLength(edge) <= shortLimit);
        const shortStrokePaths = new Set(shortEdges.map(edge => edge.sourcePath ?? `edge:${edge.id}`));
        const multiStrokePaths = new Set(
            shortEdges
                .filter(edge => Number(edge.sourcePathSegmentCount) >= 3)
                .map(edge => edge.sourcePath ?? `edge:${edge.id}`)
        );

        const evidenceReasons = [];
        if (compact && closedShapePaths.size) evidenceReasons.push('compact-closed-geometry');
        if (compact && curvedPaths.size) evidenceReasons.push('compact-curved-geometry');
        if (compact && shortEdges.length >= 2 && (shortStrokePaths.size >= 2 || multiStrokePaths.size)) {
            evidenceReasons.push('compact-short-stroke-cluster');
        }

        return {
            hasClearEvidence: evidenceReasons.length > 0,
            evidenceReasons,
            compact,
            compactLimit: Number(compactLimit.toFixed(2)),
            shortLimit: Number(shortLimit.toFixed(2)),
            closedShapePathCount: closedShapePaths.size,
            curvedPathCount: curvedPaths.size,
            shortStrokeCount: shortEdges.length,
            shortStrokePathCount: shortStrokePaths.size,
            multiStrokePathCount: multiStrokePaths.size
        };
    }

    function inlineObjectSignature(geometry, startNodeId, plan) {
        const edgeRecords = (plan?.edgeIds || [])
            .map(edgeId => geometry.edges[edgeId])
            .filter(Boolean);
        const nodeIds = new Set([startNodeId, ...(plan?.nodeIds || [])]);
        edgeRecords.forEach(edge => {
            nodeIds.add(edge.a);
            nodeIds.add(edge.b);
        });
        const points = Array.from(nodeIds)
            .map(nodeId => geometry.nodes[nodeId]?.point)
            .filter(Boolean);
        const bbox = bboxForPoints(points);
        const compactSpan = bbox ? Math.max(bboxWidth(bbox), bboxHeight(bbox)) : Infinity;
        const symbolScale = inlineLineScale(geometry);
        const symbolEdges = edgeRecords.filter(edge =>
            edge.geometryType !== 'thin-rectangle-centerline' &&
            edgeSourceLength(edge) <= symbolScale
        );
        const closedShapePaths = new Set(
            symbolEdges.filter(edge => edge.sourcePathClosed).map(edge => edge.sourcePath ?? `edge:${edge.id}`)
        );
        const curvedPaths = new Set(
            symbolEdges.filter(edge => edge.sourcePathHasCurves).map(edge => edge.sourcePath ?? `edge:${edge.id}`)
        );
        const symbolEvidence = inlineSymbolEvidence(geometry, edgeRecords, compactSpan);

        return {
            symbolScale: Number(symbolScale.toFixed(2)),
            compactSpan: Number.isFinite(compactSpan) ? Number(compactSpan.toFixed(2)) : null,
            segmentCount: edgeRecords.length,
            shortStrokeCount: symbolEdges.length,
            closedShapePathCount: closedShapePaths.size,
            curvedPathCount: curvedPaths.size,
            clearSymbolEvidence: symbolEvidence.hasClearEvidence,
            symbolEvidenceReasons: symbolEvidence.evidenceReasons,
            shortStrokePathCount: symbolEvidence.shortStrokePathCount,
            multiStrokePathCount: symbolEvidence.multiStrokePathCount,
            passThroughAngle: Number((Number(plan?.finalAngle) || 0).toFixed(1)),
            edgeEvidence: edgeRecords.map(edge => ({
                id: edge.id,
                length: Number((Number(edge.length) || 0).toFixed(2)),
                sourceLength: Number(edgeSourceLength(edge).toFixed(2)),
                geometryType: edge.geometryType || 'raw-stroke',
                sourcePathClosed: Boolean(edge.sourcePathClosed),
                sourcePathHasCurves: Boolean(edge.sourcePathHasCurves)
            }))
        };
    }

    function classifyInlineObject(geometry, startNodeId, plan) {
        const signature = inlineObjectSignature(geometry, startNodeId, plan);
        const catalogEntry = INLINE_OBJECT_CATALOG.find(entry => entry.matches(signature)) ||
            INLINE_OBJECT_CATALOG[INLINE_OBJECT_CATALOG.length - 1];
        return {
            catalogId: catalogEntry.id,
            catalogLabel: catalogEntry.label,
            signature
        };
    }

    function inlineEdgeStrength(geometry, edge) {
        if (!edge) return 0;
        const scale = inlineLineScale(geometry);
        const directLength = Number(edge.length) || 0;
        const sourceLength = edgeSourceLength(edge);
        const longSourcePath = !edge.sourcePathClosed &&
            (Number(edge.sourcePathMaxDimension) || 0) >= scale * 2;
        const supportedLength = Math.max(sourceLength, directLength * 0.8, longSourcePath ? scale : 0);
        return Math.max(0, Math.min(1, supportedLength / scale));
    }

    function isLikelyInlineStroke(geometry, edge) {
        if (!edge || edge.kind === 'component-gap') return false;
        if (edge.geometryType === 'thin-rectangle-centerline') return false;
        const shortLimit = Math.max(54, geometry.bridgeTolerance * 5, geometry.typicalWidth * 70);
        return Boolean(
            edge.sourcePathClosed ||
            edgeSourceLength(edge) <= shortLimit ||
            ((Number(edge.length) || 0) <= shortLimit && edge.sourcePathHasCurves)
        );
    }

    // A valve or instrument can split the visible pipe into several short
    // strokes. At the resulting graph node, the local edge angles alone can
    // look like a tee or a crossing. Probe a small, compact neighbourhood and
    // prefer the candidate that exits that neighbourhood as a supported,
    // directionally aligned pipe edge.
    function findInlineContinuation(geometry, currentNodeId, incomingDirection, previousEdgeId, candidates, debugDetails = null) {
        const explain = details => {
            if (debugDetails && details) Object.assign(debugDetails, details);
        };
        if (!geometry || !candidates?.length) {
            explain({ accepted: false, rejectedReason: 'no-inline-candidates' });
            return null;
        }

        const inlineExitAngle = 62;
        const maximumInlineTurn = 145;
        const maximumInlineEdges = 8;
        const maximumInlineDistance = Math.max(180, geometry.bridgeTolerance * 12, geometry.typicalWidth * 180);
        const optionByFirstEdge = new Map();
        const startPoint = geometry.nodes[currentNodeId]?.point;

        function scoreOption(option) {
            const alignment = Math.max(0, Math.cos(option.finalAngle * Math.PI / 180));
            const exitStrength = inlineEdgeStrength(geometry, option.exitEdge);
            const internalDistance = Math.max(0, option.distance - (option.exitEdge?.length || 0));
            const compactness = 1 - Math.min(1, internalDistance / maximumInlineDistance);
            const turnPenalty = Math.min(1, option.totalTurn / 180);
            const symbolEvidence = option.edgeIds
                .slice(0, -1)
                .some(edgeId => isLikelyInlineStroke(geometry, geometry.edges[edgeId]));
            return alignment * 0.58 + exitStrength * 0.28 + compactness * 0.12 +
                (symbolEvidence ? 0.05 : 0) - turnPenalty * 0.18;
        }

        function consider(option) {
            if (option.finalAngle > inlineExitAngle) return;
            const lastEdge = geometry.edges[option.edgeIds[option.edgeIds.length - 1]];
            if (!lastEdge) return;
            const isStrongEndpoint = option.terminal && inlineEdgeStrength(geometry, lastEdge) >= 0.4;
            if (option.terminal && !isStrongEndpoint) return;

            const scored = {
                ...option,
                exitEdge: lastEdge,
                score: scoreOption({ ...option, exitEdge: lastEdge })
            };
            const previous = optionByFirstEdge.get(option.edgeIds[0]);
            if (!previous || scored.score > previous.score) optionByFirstEdge.set(option.edgeIds[0], scored);
        }

        function search(nodeId, previousEdgeId, edgeIds, nodeIds, direction, distance, totalTurn, depth, visitedEdges) {
            const adjacent = geometry.adjacency[nodeId] || [];
            const outgoing = adjacent
                .filter(edgeId => edgeId !== previousEdgeId && !visitedEdges.has(edgeId))
                .map(edgeId => {
                    const edge = geometry.edges[edgeId];
                    const nextNodeId = edge.a === nodeId ? edge.b : edge.a;
                    const nextDirection = edgeDirectionFromNode(geometry, edge, nodeId);
                    return {
                        edge,
                        nextNodeId,
                        nextDirection,
                        turn: angleBetweenDirections(direction, nextDirection),
                        finalAngle: angleBetweenDirections(incomingDirection, nextDirection)
                    };
                });

            if (!outgoing.length) {
                consider({
                    firstEdgeId: edgeIds[0],
                    edgeIds,
                    nodeIds,
                    finalNodeId: nodeId,
                    finalDirection: direction,
                    finalAngle: angleBetweenDirections(incomingDirection, direction),
                    distance,
                    totalTurn,
                    terminal: true
                });
                return;
            }

            for (const next of outgoing) {
                const nextDistance = distance + (next.edge.length || 0);
                if (nextDistance > maximumInlineDistance) continue;

                const nextEdgeIds = [...edgeIds, next.edge.id];
                const nextNodeIds = [...nodeIds, next.nextNodeId];
                const nextVisitedEdges = new Set(visitedEdges).add(next.edge.id);
                const nextDegree = (geometry.adjacency[next.nextNodeId] || []).length;
                const isSupportedExit = next.finalAngle <= inlineExitAngle && (
                    inlineEdgeStrength(geometry, next.edge) >= 0.35 || nextDegree <= 1
                );

                if (isSupportedExit) {
                    consider({
                        firstEdgeId: edgeIds[0],
                        edgeIds: nextEdgeIds,
                        nodeIds: nextNodeIds,
                        finalNodeId: next.nextNodeId,
                        finalDirection: next.nextDirection,
                        finalAngle: next.finalAngle,
                        distance: nextDistance,
                        totalTurn: totalTurn + next.turn,
                        terminal: nextDegree <= 1
                    });
                }

                if (depth >= maximumInlineEdges - 1 || next.turn > maximumInlineTurn) continue;
                const canProbeThrough = isLikelyInlineStroke(geometry, next.edge) ||
                    nextDegree >= 3 || next.turn <= inlineExitAngle;
                if (!canProbeThrough) continue;

                search(
                    next.nextNodeId,
                    next.edge.id,
                    nextEdgeIds,
                    nextNodeIds,
                    next.nextDirection,
                    nextDistance,
                    totalTurn + next.turn,
                    depth + 1,
                    nextVisitedEdges
                );
            }
        }

        for (const candidate of candidates) {
            const edge = candidate.edge;
            const nextNodeId = edge.a === currentNodeId ? edge.b : edge.a;
            const distance = edge.length || 0;
            search(
                nextNodeId,
                edge.id,
                [edge.id],
                [currentNodeId, nextNodeId],
                candidate.direction,
                distance,
                0,
                1,
                new Set([previousEdgeId, edge.id])
            );
        }

        const options = Array.from(optionByFirstEdge.values()).sort((a, b) => b.score - a.score);
        const summarizeOption = option => option ? ({
            firstEdgeId: option.firstEdgeId,
            edgeIds: option.edgeIds,
            finalNodeId: option.finalNodeId,
            finalAngle: Number(option.finalAngle.toFixed(1)),
            distance: Number(option.distance.toFixed(2)),
            totalTurn: Number(option.totalTurn.toFixed(1)),
            terminal: Boolean(option.terminal),
            score: Number(option.score.toFixed(3))
        }) : null;
        explain({
            optionCount: options.length,
            candidateOptions: options.slice(0, 8).map(summarizeOption)
        });
        if (!options.length) {
            explain({ accepted: false, rejectedReason: 'no-supported-inline-option' });
            return null;
        }

        const best = options[0];
        const bestSignature = inlineObjectSignature(geometry, currentNodeId, best);
        const symbolEvidence = inlineSymbolEvidence(geometry, best.edgeIds
            .map(edgeId => geometry.edges[edgeId])
            .filter(Boolean), bestSignature.compactSpan);
        const runnerUp = options.find(option => option.firstEdgeId !== best.firstEdgeId) || null;
        const margin = runnerUp ? best.score - runnerUp.score : 1;
        const angleAdvantage = runnerUp ? runnerUp.finalAngle - best.finalAngle : 90;
        const hasExternalSupport = inlineEdgeStrength(geometry, best.exitEdge) >= 0.35;
        const convergesOnSameExit = Boolean(runnerUp && (
            runnerUp.finalNodeId === best.finalNodeId ||
            runnerUp.exitEdge?.id === best.exitEdge?.id
        ));
        const hasCompactPassThrough = best.edgeIds.length > 1 && best.edgeIds
            .slice(0, -1)
            .some(edgeId => {
                const edge = geometry.edges[edgeId];
                return edge && edge.geometryType !== 'thin-rectangle-centerline' &&
                    (edge.sourcePathClosed || edge.sourcePathHasCurves ||
                        Number(edge.sourcePathSegmentCount) >= 3);
            });

        explain({
            bestOption: summarizeOption(best),
            runnerUpOption: summarizeOption(runnerUp),
            scoreMargin: Number(margin.toFixed(3)),
            angleAdvantage: Number(angleAdvantage.toFixed(1)),
            convergesOnSameExit,
            hasExternalSupport,
            hasCompactPassThrough,
            symbolEvidence
        });

        if (!startPoint || best.finalAngle > inlineExitAngle || !hasExternalSupport) {
            explain({ accepted: false, rejectedReason: !startPoint ? 'missing-start-node' : 'weak-or-misaligned-exit' });
            return null;
        }
        // A degree-3 node is a tee by default. Only a compact, explicit
        // symbol signature can justify passing it as an inline object. Short
        // fragments alone are not enough because PDF exporters frequently
        // split ordinary pipe runs into short source paths.
        if (!symbolEvidence.hasClearEvidence) {
            explain({ accepted: false, rejectedReason: 'no-clear-symbol-evidence' });
            return null;
        }
        if (!hasCompactPassThrough && best.edgeIds.length < 2 && margin < 0.12) {
            explain({ accepted: false, rejectedReason: 'weak-inline-score-margin' });
            return null;
        }
        if (runnerUp && margin < 0.1 && angleAdvantage < 15 && !convergesOnSameExit) {
            explain({ accepted: false, rejectedReason: 'competing-inline-options' });
            return null;
        }

        explain({ accepted: true, reason: convergesOnSameExit
            ? 'symmetric-inline-object'
            : hasCompactPassThrough
                ? 'compact-inline-object'
                : 'aligned-inline-continuation' });

        return {
            ...best,
            runnerUpScore: runnerUp ? Number(runnerUp.score.toFixed(3)) : null,
            scoreMargin: Number(margin.toFixed(3)),
            confidence: Number(Math.max(0, Math.min(1, best.score * 0.7 + margin * 0.3)).toFixed(3)),
            symbolEvidence,
            reason: convergesOnSameExit
                ? 'symmetric-inline-object'
                : hasCompactPassThrough
                    ? 'compact-inline-object'
                    : 'aligned-inline-continuation'
        };
    }

    function traceContinuation(geometry, seedEdge, options = {}) {
        if (!seedEdge) {
            return {
                edgeIds: [],
                nodeIds: [],
                branches: [],
                teeJunctions: [],
                inlineObjects: [],
                crossings: [],
                ambiguousNodes: [],
                endpoints: [],
                bridges: [],
                lineBoundaries: [],
                decisionRecords: [],
                stops: [{ reason: 'no-seed' }],
                stoppedReason: 'no-seed',
                routeDistance: 0,
                maxRouteDistance: 0
            };
        }

        const routeEdges = new Set([seedEdge.id]);
        const routeNodes = new Set([seedEdge.a, seedEdge.b]);
        const teeMap = new Map();
        const crossingMap = new Map();
        const ambiguousMap = new Map();
        const inlineObjectMap = new Map();
        const lineBoundaryRecords = [];
        const stopRecords = [];
        const decisionRecords = [];
        const visitedDirections = new Set();
        const pageWidth = Math.max(0, geometry.pageBounds.maxX - geometry.pageBounds.minX);
        const pageHeight = Math.max(0, geometry.pageBounds.maxY - geometry.pageBounds.minY);
        const pageDiagonal = Math.hypot(pageWidth, pageHeight);
        const maxRouteDistance = Math.max(10000, pageDiagonal * 8);
        const inlineAngleLimit = 48;
        // Ordinary P&ID pipe routes may turn through a square elbow, but they
        // must not double back into the outline of a valve or instrument.
        // Angles above this limit are almost always symbol geometry rather
        // than a continuation of the pipe centreline.
        const maximumTurnAngle = 105;
        const competingContinuationMargin = 0.18;
        const foreignAnchorsByEdge = new Map();
        for (const anchor of options.lineAnchors || []) {
            if (!Number.isInteger(anchor?.edgeId)) continue;
            const records = foreignAnchorsByEdge.get(anchor.edgeId) || [];
            records.push(anchor);
            foreignAnchorsByEdge.set(anchor.edgeId, records);
        }
        let routeDistance = seedEdge.length || 0;

        function foreignLineRecordsForEdges(edgeIds) {
            const matches = new Map();
            for (const edgeId of edgeIds || []) {
                for (const anchor of foreignAnchorsByEdge.get(edgeId) || []) {
                    matches.set(anchor.tagId, anchor);
                }
            }
            return Array.from(matches.values());
        }

        // A line tag is commonly placed beyond a valve, reducer, spectacle
        // blind, or tee rather than on the first PDF stroke after it. Probe a
        // short distance along only one clearly aligned continuation so the
        // trace can recognise that semantic boundary without flooding through
        // the rest of the drawing graph.
        function probeForeignLineAhead(startNodeId, previousEdgeId, incomingDirection) {
            const maximumProbeDistance = Math.max(
                240,
                geometry.bridgeTolerance * 18,
                geometry.typicalWidth * 220
            );
            const maximumProbeEdges = 10;
            const probedEdgeIds = [];
            const visitedEdges = new Set([previousEdgeId]);
            let nodeId = startNodeId;
            let direction = incomingDirection;
            let distance = 0;

            for (let depth = 0; depth < maximumProbeEdges && distance <= maximumProbeDistance; depth += 1) {
                const candidates = (geometry.adjacency[nodeId] || [])
                    .filter(edgeId => !visitedEdges.has(edgeId))
                    .map(edgeId => {
                        const edge = geometry.edges[edgeId];
                        const candidateDirection = edgeDirectionFromNode(geometry, edge, nodeId);
                        const angle = angleBetweenDirections(direction, candidateDirection);
                        return {
                            edge,
                            direction: candidateDirection,
                            angle,
                            score: Math.cos(angle * Math.PI / 180)
                        };
                    })
                    .sort((a, b) => b.score - a.score);

                const selected = candidates[0];
                const second = candidates[1];
                if (!selected || selected.angle > inlineAngleLimit) break;
                if (second) {
                    const scoreMargin = selected.score - second.score;
                    const directionSeparation = second.angle - selected.angle;
                    if (second.angle <= inlineAngleLimit || scoreMargin < 0.22 || directionSeparation < 24) break;
                }

                probedEdgeIds.push(selected.edge.id);
                visitedEdges.add(selected.edge.id);
                distance += selected.edge.length || 0;

                const anchors = foreignLineRecordsForEdges([selected.edge.id]);
                if (anchors.length) {
                    return { anchors, edgeIds: probedEdgeIds, distance };
                }

                nodeId = selected.edge.a === nodeId ? selected.edge.b : selected.edge.a;
                direction = selected.direction;
            }

            return { anchors: [], edgeIds: probedEdgeIds, distance };
        }

        function stopAtForeignLineBoundary(decision, nodeId, degree, anchors, connectedEdgeIds = []) {
            const record = {
                nodeId,
                type: 'foreign-line-boundary',
                degree,
                stopped: true,
                reason: 'different-line-tag-ahead',
                connectedEdgeIds: Array.from(new Set(connectedEdgeIds)),
                connectedLineTags: anchors.map(anchor => ({
                    tag: anchor.tagText,
                    occurrenceId: anchor.tagId,
                    edgeId: anchor.edgeId,
                    distanceFromTag: Number((Number(anchor.distance) || 0).toFixed(2))
                }))
            };
            lineBoundaryRecords.push(record);
            decision.action = 'stop-foreign-line-boundary';
            decision.reason = 'different-line-tag-ahead';
            decision.selectedEdgeId = null;
            decision.selectedEdgeIds = [];
            decision.connectedLineTags = record.connectedLineTags;
            stopRecords.push({
                nodeId,
                reason: 'foreign-line-boundary',
                degree,
                distance: routeDistance,
                connectedEdgeIds: record.connectedEdgeIds,
                connectedLineTags: record.connectedLineTags
            });
        }

        function edgeRecord(nodeId, candidate) {
            const edge = candidate.edge;
            const connectedNodeId = edge.a === nodeId ? edge.b : edge.a;
            return {
                edgeId: edge.id,
                connectedNodeId,
                angle: Number(candidate.angle.toFixed(1)),
                score: Number(candidate.score.toFixed(3)),
                direction: roundedDebugPoint(candidate.direction),
                kind: edge.kind,
                geometryType: edge.geometryType || 'raw-stroke',
                sourcePath: edge.sourcePath ?? null
            };
        }

        function recordJunction(map, nodeId, type, degree, candidates, selected, options = {}) {
            const connectedEdges = candidates
                .filter(candidate => candidate.edge.id !== selected?.edge.id)
                .map(candidate => edgeRecord(nodeId, candidate));
            const continuationEdgeIds = selected ? [selected.edge.id] : [];
            const existing = map.get(nodeId);
            if (!existing) {
                map.set(nodeId, {
                    nodeId,
                    type,
                    degree,
                    continuationEdgeId: selected?.edge.id ?? null,
                    continuationEdgeIds,
                    branchEdges: connectedEdges,
                    connectedEdges,
                    stopped: Boolean(options.stopped),
                    reason: options.reason || 'junction'
                });
                return;
            }

            const mergedConnections = new Map(
                [...(existing.connectedEdges || []), ...connectedEdges]
                    .map(edge => [edge.edgeId, edge])
            );
            existing.degree = Math.max(existing.degree || degree, degree);
            existing.continuationEdgeIds = Array.from(new Set([
                ...(existing.continuationEdgeIds || []),
                ...continuationEdgeIds
            ]));
            existing.continuationEdgeId = existing.continuationEdgeId ?? selected?.edge.id ?? null;
            existing.connectedEdges = Array.from(mergedConnections.values());
            existing.branchEdges = existing.connectedEdges.filter(edge =>
                !existing.continuationEdgeIds.includes(edge.edgeId)
            );
            existing.stopped = existing.stopped || Boolean(options.stopped);
            if (options.stopped) existing.reason = options.reason || existing.reason;
        }

        function recordAmbiguous(nodeId, degree, reason, confidence = 0.18, connectedEdgeIds = []) {
            const key = `${nodeId}:${reason}`;
            ambiguousMap.set(key, {
                nodeId,
                type: 'ambiguous-junction',
                degree,
                confidence,
                reason,
                stopped: true,
                connectedEdgeIds
            });
        }

        function applyInlinePlan(plan, startNodeId) {
            if (!plan?.edgeIds?.length) return null;

            let currentNodeId = startNodeId;
            let previousEdgeId = null;
            let direction = null;
            let distance = 0;

            for (const edgeId of plan.edgeIds) {
                const edge = geometry.edges[edgeId];
                if (!edge || routeEdges.has(edge.id)) return null;
                if (edge.a !== currentNodeId && edge.b !== currentNodeId) return null;

                const nextNodeId = edge.a === currentNodeId ? edge.b : edge.a;
                direction = edgeDirectionFromNode(geometry, edge, currentNodeId);
                routeEdges.add(edge.id);
                routeNodes.add(currentNodeId);
                routeNodes.add(nextNodeId);
                distance += edge.length || 0;
                previousEdgeId = edge.id;
                currentNodeId = nextNodeId;
            }

            if (!direction || previousEdgeId === null) return null;
            routeDistance += distance;
            return { currentNodeId, previousEdgeId, direction, distance };
        }

        function recordInlineObject(nodeId, degree, plan) {
            const existing = inlineObjectMap.get(nodeId);
            const catalog = classifyInlineObject(geometry, nodeId, plan);
            const record = {
                nodeId,
                type: 'inline-object',
                catalogId: catalog.catalogId,
                catalogLabel: catalog.catalogLabel,
                geometrySignature: catalog.signature,
                degree,
                edgeIds: plan.edgeIds,
                exitEdgeId: plan.exitEdge?.id ?? null,
                finalAngle: Number(plan.finalAngle.toFixed(1)),
                confidence: plan.confidence,
                scoreMargin: plan.scoreMargin,
                reason: plan.reason,
                stopped: false
            };
            if (!existing || record.confidence > existing.confidence) inlineObjectMap.set(nodeId, record);
        }

        function walk(startNodeId, initialDirection, incomingEdgeId, side) {
            let currentNodeId = startNodeId;
            let direction = initialDirection;
            let previousEdgeId = incomingEdgeId;

            while (true) {
                const decision = {
                    index: decisionRecords.length,
                    side,
                    nodeId: currentNodeId,
                    point: roundedDebugPoint(geometry.nodes[currentNodeId]?.point),
                    degree: (geometry.adjacency[currentNodeId] || []).length,
                    previousEdgeId,
                    incomingDirection: roundedDebugPoint(direction),
                    routeDistance: Number(routeDistance.toFixed(2)),
                    candidates: [],
                    selectedEdgeId: null,
                    selectedEdgeIds: [],
                    action: 'decision',
                    reason: ''
                };
                decisionRecords.push(decision);
                const visitKey = `${previousEdgeId}:${currentNodeId}`;
                if (visitedDirections.has(visitKey)) {
                    decision.action = 'stop-loop';
                    decision.reason = 'same direction was visited twice';
                    stopRecords.push({ nodeId: currentNodeId, reason: 'loop' });
                    return;
                }
                visitedDirections.add(visitKey);

                routeNodes.add(currentNodeId);
                const adjacent = geometry.adjacency[currentNodeId] || [];
                const outgoingIds = adjacent.filter(edgeId => edgeId !== previousEdgeId);
                const degree = adjacent.length;

                if (!outgoingIds.length) {
                    decision.action = 'stop-endpoint';
                    decision.reason = 'endpoint';
                    stopRecords.push({ nodeId: currentNodeId, reason: 'endpoint', degree, distance: routeDistance });
                    return;
                }

                const candidates = outgoingIds.map(edgeId => {
                    const edge = geometry.edges[edgeId];
                    const candidateDirection = edgeDirectionFromNode(geometry, edge, currentNodeId);
                    const angle = angleBetweenDirections(direction, candidateDirection);
                    const score = Math.cos(angle * Math.PI / 180);
                    return { edge, direction: candidateDirection, angle, score };
                }).sort((a, b) => b.score - a.score);

                const selected = candidates[0];
                const second = candidates[1];
                const scoreMargin = second ? selected.score - second.score : 1;
                const secondLooksLikePipe = Boolean(second && (
                    second.edge.geometryType === 'thin-rectangle-centerline' ||
                    inlineEdgeStrength(geometry, second.edge) >= 0.35
                ));
                const hasCompetingInline = second && second.angle <= inlineAngleLimit &&
                    scoreMargin < competingContinuationMargin && secondLooksLikePipe;
                decision.candidates = candidates.map(candidate => edgeRecord(currentNodeId, candidate));
                decision.selectedEdgeId = selected?.edge.id ?? null;
                decision.selectedEdgeIds = selected ? [selected.edge.id] : [];
                decision.scoreMargin = Number(scoreMargin.toFixed(3));

                // A degree-3 node is a tee unless a compact cluster of
                // unmistakable symbol strokes proves otherwise. The previous
                // implementation passed a straight degree-3 node directly,
                // which could merge the selected line into an adjacent line.
                // Higher-degree nodes retain the crossing heuristic below.
                const shouldTryInline = degree === 3 ||
                    (degree >= 4 && (selected.angle > inlineAngleLimit || hasCompetingInline));
                const inlineProbe = {};
                if (shouldTryInline) {
                    const inlinePlan = findInlineContinuation(
                        geometry,
                        currentNodeId,
                        direction,
                        previousEdgeId,
                        candidates,
                        inlineProbe
                    );
                    decision.inlineProbe = inlineProbe;
                    const inlineBoundaryAnchors = foreignLineRecordsForEdges(inlinePlan?.edgeIds || []);
                    if (inlinePlan && inlineBoundaryAnchors.length) {
                        inlineProbe.accepted = false;
                        inlineProbe.rejectedReason = 'different-line-tag-ahead';
                        stopAtForeignLineBoundary(
                            decision,
                            currentNodeId,
                            degree,
                            inlineBoundaryAnchors,
                            inlinePlan.edgeIds
                        );
                        return;
                    }
                    if (inlinePlan) {
                        const finalEdgeId = inlinePlan.edgeIds[inlinePlan.edgeIds.length - 1];
                        const forwardBoundary = probeForeignLineAhead(
                            inlinePlan.finalNodeId,
                            finalEdgeId,
                            inlinePlan.finalDirection
                        );
                        if (forwardBoundary.anchors.length) {
                            inlineProbe.accepted = false;
                            inlineProbe.rejectedReason = 'different-line-tag-beyond-inline-object';
                            inlineProbe.boundaryProbeEdgeIds = forwardBoundary.edgeIds;
                            stopAtForeignLineBoundary(
                                decision,
                                currentNodeId,
                                degree,
                                forwardBoundary.anchors,
                                [...inlinePlan.edgeIds, ...forwardBoundary.edgeIds]
                            );
                            return;
                        }
                    }
                    const applied = applyInlinePlan(inlinePlan, currentNodeId);
                    if (inlinePlan && applied) {
                        decision.action = 'pass-inline-object';
                        decision.reason = inlinePlan.reason || 'inline object evidence passed';
                        decision.selectedEdgeIds = inlinePlan.edgeIds.slice();
                        decision.selectedEdgeId = inlinePlan.edgeIds[inlinePlan.edgeIds.length - 1] ?? null;
                        decision.inlinePlanEdgeIds = inlinePlan.edgeIds.slice();
                        recordInlineObject(currentNodeId, degree, inlinePlan);
                        if (routeDistance > maxRouteDistance) {
                            decision.action = 'stop-safety-limit';
                            decision.reason = 'safety-distance-limit';
                            recordAmbiguous(currentNodeId, degree, 'safety-distance-limit', 0.2, inlinePlan.edgeIds);
                            stopRecords.push({
                                nodeId: currentNodeId,
                                reason: 'safety-distance-limit',
                                degree,
                                distance: routeDistance,
                                connectedEdgeIds: inlinePlan.edgeIds
                            });
                            return;
                        }
                        currentNodeId = applied.currentNodeId;
                        previousEdgeId = applied.previousEdgeId;
                        direction = applied.direction;
                        continue;
                    }
                }

                if (!selected) {
                    decision.action = 'stop-no-valid-continuation';
                    decision.reason = 'no-valid-continuation';
                    decision.selectedEdgeIds = [];
                    recordAmbiguous(currentNodeId, degree, 'no-valid-continuation', 0.25);
                    stopRecords.push({ nodeId: currentNodeId, reason: 'no-valid-continuation', degree, distance: routeDistance });
                    return;
                }

                const selectedBoundaryAnchors = foreignLineRecordsForEdges([selected.edge.id]);
                if (selectedBoundaryAnchors.length) {
                    if (degree === 3) {
                        recordJunction(teeMap, currentNodeId, 'tee-junction', degree, candidates, null, {
                            stopped: true,
                            reason: 'different-line-tag-ahead'
                        });
                    }
                    stopAtForeignLineBoundary(
                        decision,
                        currentNodeId,
                        degree,
                        selectedBoundaryAnchors,
                        [selected.edge.id]
                    );
                    return;
                }

                if (degree >= 3) {
                    const selectedNextNodeId = selected.edge.a === currentNodeId
                        ? selected.edge.b
                        : selected.edge.a;
                    const forwardBoundary = probeForeignLineAhead(
                        selectedNextNodeId,
                        selected.edge.id,
                        selected.direction
                    );
                    if (forwardBoundary.anchors.length) {
                        if (degree === 3) {
                            recordJunction(teeMap, currentNodeId, 'tee-junction', degree, candidates, null, {
                                stopped: true,
                                reason: 'different-line-tag-ahead'
                            });
                        }
                        decision.boundaryProbeEdgeIds = forwardBoundary.edgeIds;
                        stopAtForeignLineBoundary(
                            decision,
                            currentNodeId,
                            degree,
                            forwardBoundary.anchors,
                            [selected.edge.id, ...forwardBoundary.edgeIds]
                        );
                        return;
                    }
                }

                if (degree === 3) {
                    const directionSeparation = second ? second.angle - selected.angle : 180;
                    const hasNormalMainContinuation = !hasCompetingInline &&
                        selected.angle <= 38 &&
                        directionSeparation >= 24 &&
                        scoreMargin >= 0.22;
                    const hasStraightPipePastSymbolStroke = !hasCompetingInline &&
                        selected.angle <= 8 &&
                        selected.edge.geometryType === 'thin-rectangle-centerline' &&
                        !secondLooksLikePipe &&
                        directionSeparation >= 24 &&
                        scoreMargin >= 0.12;
                    const hasClearMainContinuation = hasNormalMainContinuation ||
                        hasStraightPipePastSymbolStroke;

                    if (hasClearMainContinuation) {
                        decision.action = 'pass-tee-main';
                        decision.reason = hasStraightPipePastSymbolStroke
                            ? 'straight pipe continuation past short symbol stroke'
                            : 'one clearly aligned main continuation';
                        recordJunction(teeMap, currentNodeId, 'tee-junction', degree, candidates, selected, {
                            stopped: false,
                            reason: 'aligned-main-continuation'
                        });
                    } else {
                        const reason = hasCompetingInline ? 'competing-tee-continuations' : 'tee-junction';
                        decision.action = hasCompetingInline ? 'stop-ambiguous-tee' : 'stop-tee';
                        decision.reason = reason;
                        decision.selectedEdgeId = null;
                        decision.selectedEdgeIds = [];
                        recordJunction(teeMap, currentNodeId, 'tee-junction', degree, candidates, null, {
                            stopped: true,
                            reason
                        });
                        stopRecords.push({
                            nodeId: currentNodeId,
                            reason: hasCompetingInline ? 'ambiguous-tee' : 'tee-junction',
                            degree,
                            distance: routeDistance,
                            connectedEdgeIds: candidates.map(candidate => candidate.edge.id)
                        });
                        return;
                    }
                } else if (degree >= 4) {
                    if (selected.angle > inlineAngleLimit || hasCompetingInline) {
                        const reason = degree > 4 ? 'high-degree-junction' : 'cross-or-complex-junction';
                        decision.action = 'stop-ambiguous-junction';
                        decision.reason = reason;
                        decision.selectedEdgeIds = [];
                        recordAmbiguous(
                            currentNodeId,
                            degree,
                            reason,
                            hasCompetingInline ? 0.35 : 0.18,
                            candidates.map(candidate => candidate.edge.id)
                        );
                        stopRecords.push({
                            nodeId: currentNodeId,
                            reason,
                            degree,
                            distance: routeDistance,
                            connectedEdgeIds: candidates.map(candidate => candidate.edge.id)
                        });
                        return;
                    }

                    // A clear straight-ahead edge lets the selected line pass
                    // through a visual crossing or a complex junction without
                    // accidentally switching to a side line. Keep the side
                    // connections visible in diagnostics for review.
                    decision.action = 'pass-crossing';
                    decision.reason = 'aligned-continuation';
                    recordJunction(crossingMap, currentNodeId, 'crossing-or-complex-junction', degree, candidates, selected, {
                        stopped: false,
                        reason: 'aligned-continuation'
                    });
                } else if (selected.angle > maximumTurnAngle || (second && scoreMargin < 0.12)) {
                    const reason = second && scoreMargin < 0.12 ? 'competing-continuations' : 'no-valid-continuation';
                    decision.action = 'stop-ambiguous-continuation';
                    decision.reason = reason;
                    decision.selectedEdgeIds = [];
                    recordAmbiguous(currentNodeId, degree, reason, second ? 0.35 : 0.25, candidates.map(candidate => candidate.edge.id));
                    stopRecords.push({ nodeId: currentNodeId, reason, degree, distance: routeDistance });
                    return;
                }

                const nextEdge = selected.edge;
                if (routeEdges.has(nextEdge.id)) {
                    decision.action = 'stop-loop';
                    decision.reason = 'selected edge is already part of the route';
                    stopRecords.push({ nodeId: currentNodeId, reason: 'loop', degree, distance: routeDistance });
                    return;
                }

                const nextNodeId = nextEdge.a === currentNodeId ? nextEdge.b : nextEdge.a;
                if (decision.action === 'decision') {
                    decision.action = 'continue';
                    decision.reason = 'best aligned continuation';
                }
                decision.nextNodeId = nextNodeId;
                routeEdges.add(nextEdge.id);
                routeNodes.add(nextNodeId);
                routeDistance += nextEdge.length || 0;
                if (routeDistance > maxRouteDistance) {
                    decision.action = 'stop-safety-limit';
                    decision.reason = 'safety-distance-limit';
                    recordAmbiguous(currentNodeId, degree, 'safety-distance-limit', 0.2, [nextEdge.id]);
                    stopRecords.push({ nodeId: currentNodeId, reason: 'safety-distance-limit', degree, distance: routeDistance });
                    return;
                }

                currentNodeId = nextNodeId;
                previousEdgeId = nextEdge.id;
                direction = selected.direction;
            }
        }

        const seedA = geometry.nodes[seedEdge.a].point;
        const seedB = geometry.nodes[seedEdge.b].point;
        walk(seedEdge.a, normalizeVector(subtract(seedA, seedB)), seedEdge.id, 'from seed A');
        walk(seedEdge.b, normalizeVector(subtract(seedB, seedA)), seedEdge.id, 'from seed B');

        const routeEdgeIds = Array.from(routeEdges);
        const routeNodeIds = Array.from(routeNodes);
        const routeEdgeSet = new Set(routeEdgeIds);
        const acceptedBridges = geometry.bridges.filter(bridge => routeEdgeSet.has(bridge.id));
        const endpointNodes = routeNodeIds.filter(nodeId => {
            return (geometry.adjacency[nodeId] || []).length === 1;
        });
        const uniqueReasons = Array.from(new Set(stopRecords.map(record => record.reason)));

        return {
            edgeIds: routeEdgeIds,
            nodeIds: routeNodeIds,
            branches: Array.from(teeMap.values()),
            teeJunctions: Array.from(teeMap.values()),
            inlineObjects: Array.from(inlineObjectMap.values()),
            crossings: Array.from(crossingMap.values()),
            ambiguousNodes: Array.from(ambiguousMap.values()),
            endpoints: endpointNodes,
            bridges: acceptedBridges,
            lineBoundaries: lineBoundaryRecords,
            decisionRecords,
            stops: stopRecords,
            stoppedReason: uniqueReasons.join('; ') || 'completed',
            routeDistance,
            maxRouteDistance
        };
    }

    function collectBranchProbeEdges(geometry, junction, branchEdge) {
        const edgeIds = [];
        const visitedEdges = new Set();
        const pageBounds = geometry.pageBounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        const pageDiagonal = Math.hypot(
            Math.max(0, pageBounds.maxX - pageBounds.minX),
            Math.max(0, pageBounds.maxY - pageBounds.minY)
        );
        const maxProbeDistance = Math.max(600, pageDiagonal * 1.1, geometry.bridgeTolerance * 40);
        let currentNodeId = junction.nodeId;
        let currentEdgeId = branchEdge.edgeId;
        let direction = branchEdge.direction || null;
        let distance = 0;

        while (currentEdgeId !== null && currentEdgeId !== undefined && !visitedEdges.has(currentEdgeId)) {
            const edge = geometry.edges[currentEdgeId];
            if (!edge) break;
            visitedEdges.add(currentEdgeId);
            edgeIds.push(currentEdgeId);
            distance += edge.length || 0;

            const nextNodeId = edge.a === currentNodeId ? edge.b : edge.a;
            const adjacent = geometry.adjacency[nextNodeId] || [];
            const nextEdges = adjacent.filter(edgeId => edgeId !== currentEdgeId);
            if (!nextEdges.length || distance >= maxProbeDistance) break;

            direction = edgeDirectionFromNode(geometry, edge, currentNodeId);
            const candidates = nextEdges.map(edgeId => {
                const nextEdge = geometry.edges[edgeId];
                const candidateDirection = edgeDirectionFromNode(geometry, nextEdge, nextNodeId);
                const angle = angleBetweenDirections(direction, candidateDirection);
                return { edgeId, angle, score: Math.cos(angle * Math.PI / 180) };
            }).sort((a, b) => b.score - a.score);
            const selected = candidates[0];
            const second = candidates[1];
            const scoreMargin = second ? selected.score - second.score : 1;

            // Probe through clear straight crossings so a line tag farther
            // along the same run can prove that a tee changes line number.
            // Stop before a turn into symbol geometry or where two forward
            // choices are genuinely competitive.
            if (!selected || selected.angle > 48 || (second && second.angle <= 48 && scoreMargin < 0.18)) break;

            currentNodeId = nextNodeId;
            currentEdgeId = selected.edgeId;
        }

        return { edgeIds, distance };
    }

    function associateConnectedLineTags(tags, pageNumber, geometry, component, selectedTagId) {
        const lineTagSeeds = new Map();
        for (const tag of tags.filter(candidate => candidate.page === pageNumber && isLineTag(candidate))) {
            if (tag.id === selectedTagId) continue;
            const seed = findSeedEdges(geometry, tag);
            if (!seed.selected) continue;
            const records = lineTagSeeds.get(seed.selected.edge.id) || [];
            records.push({ tag, distance: seed.selected.distance });
            lineTagSeeds.set(seed.selected.edge.id, records);
        }

        for (const junction of component.teeJunctions || component.branches || []) {
            const matches = new Map();
            for (const branchEdge of junction.branchEdges || []) {
                const probe = collectBranchProbeEdges(geometry, junction, branchEdge);
                branchEdge.probeEdgeIds = probe.edgeIds.slice();
                const branchMatches = new Map();
                let distanceFromTee = 0;
                for (const edgeId of probe.edgeIds) {
                    for (const record of lineTagSeeds.get(edgeId) || []) {
                        const occurrenceId = record.tag.id;
                        const candidate = {
                            tag: record.tag.tag,
                            occurrenceId,
                            edgeId,
                            distanceFromTee: Number((distanceFromTee + record.distance).toFixed(2))
                        };
                        const existing = matches.get(occurrenceId);
                        if (!existing || candidate.distanceFromTee < existing.distanceFromTee) {
                            matches.set(occurrenceId, candidate);
                        }
                        const existingBranch = branchMatches.get(occurrenceId);
                        if (!existingBranch || candidate.distanceFromTee < existingBranch.distanceFromTee) {
                            branchMatches.set(occurrenceId, {
                                tag: record.tag.tag,
                                occurrenceId,
                                edgeId,
                                distanceFromTee: candidate.distanceFromTee
                            });
                        }
                    }
                    const edge = geometry.edges[edgeId];
                    distanceFromTee += edge?.length || 0;
                }
                branchEdge.connectedLineTags = Array.from(branchMatches.values())
                    .sort((a, b) => a.distanceFromTee - b.distanceFromTee);
            }
            junction.connectedLineTags = Array.from(matches.values())
                .sort((a, b) => a.distanceFromTee - b.distanceFromTee);
        }

        return component.teeJunctions || component.branches || [];
    }

    function associationEdgeIdsForRoute(tag, component) {
        const selectedLine = normalizedLineTag(tag?.tag);
        const edgeIds = new Set(component?.edgeIds || []);

        // A confidently passed tee has one side branch. When that branch has
        // no different line tag, retain its straight probe as provisional
        // topology for valve matching. The route remains REVIEW until that
        // branch is positively resolved, so these edges cannot silently make
        // an automatic valve assignment.
        for (const junction of component?.teeJunctions || component?.branches || []) {
            if (junction.stopped) continue;
            for (const branchEdge of junction.branchEdges || []) {
                const hasDifferentLine = (branchEdge.connectedLineTags || []).some(lineTag =>
                    normalizedLineTag(lineTag.tag) !== selectedLine
                );
                if (hasDifferentLine) continue;
                for (const edgeId of branchEdge.probeEdgeIds || []) edgeIds.add(edgeId);
            }
        }

        return Array.from(edgeIds);
    }

    function isValveTag(tag) {
        return tag && (tag.tagType === 'valve' || tag.tagType === 'actuated');
    }

    function valveAssociationRadius(tag, geometry) {
        const rect = tag?.pdfRect || {};
        const labelWidth = Math.max(Number(rect.width) || 0, Number(rect.height) || 0);
        const labelHeight = Math.min(Number(rect.width) || 0, Number(rect.height) || 0);
        return Math.min(
            180,
            Math.max(
                36,
                labelHeight * 14 || 0,
                labelWidth * 1.1 || 0,
                (Number(geometry?.bridgeTolerance) || 12) * 2.5
            )
        );
    }

    function nominalSizeFromTag(tagText) {
        const token = String(tagText || '').trim().split('-')[1] || '';
        return token.includes('"') ? token.toUpperCase().replace(/\s+/g, '') : '';
    }

    function valveRouteCandidate(tag, route) {
        if (!tag || !route?.geometry || tag.page !== route.page) return null;
        const center = getTagCenter(tag);
        if (!center) return null;

        const radius = valveAssociationRadius(tag, route.geometry);
        const orientationKnown = Number.isFinite(Number(tag?.pdfRect?.rotation));
        const valveSize = nominalSizeFromTag(tag.tag);
        const lineSize = nominalSizeFromTag(route.tagText);
        const sizeCompatible = !valveSize || !lineSize || valveSize === lineSize;
        const coreEdgeIds = new Set(route.edgeIds || []);
        let distance = Infinity;
        let nearestEdgeId = null;
        let alignment = orientationKnown ? 0 : 0.5;
        let score = Infinity;
        for (const edgeId of route.associationEdgeIds || route.edgeIds || []) {
            const edge = route.geometry.edges[edgeId];
            if (!edge) continue;
            const a = route.geometry.nodes[edge.a]?.point;
            const b = route.geometry.nodes[edge.b]?.point;
            if (!a || !b) continue;
            const candidateDistance = distancePointToSegment(center, a, b);
            const candidateAlignment = segmentTagAlignment({ a, b }, tag);
            const orientationPenalty = orientationKnown ? (1 - candidateAlignment) * radius * 0.7 : 0;
            const candidateScore = candidateDistance + orientationPenalty;
            if (candidateScore < score) {
                distance = candidateDistance;
                nearestEdgeId = edgeId;
                alignment = candidateAlignment;
                score = candidateScore;
            }
        }
        if (!Number.isFinite(distance)) return null;

        const distanceConfidence = Math.max(0, Math.min(1, 1 - distance / radius));
        const confidence = distanceConfidence * (orientationKnown ? 0.65 + alignment * 0.35 : 1);
        return {
            lineTag: route.tagText,
            lineOccurrenceId: route.tagId,
            page: route.page,
            distance: Number(distance.toFixed(2)),
            radius: Number(radius.toFixed(2)),
            confidence: Number(confidence.toFixed(3)),
            score: Number(score.toFixed(2)),
            alignment: Number(alignment.toFixed(3)),
            orientationKnown,
            valveSize,
            lineSize,
            sizeCompatible,
            eligible: sizeCompatible && (!orientationKnown || alignment >= 0.62),
            nearestEdgeId,
            edgeScope: coreEdgeIds.has(nearestEdgeId) ? 'traced-route' : 'provisional-side-branch',
            routeStatus: route.overlaps?.length ? 'review' : (route.baseStatus || 'review'),
            method: 'directional-topology-route'
        };
    }

    // Reconcile every valve against every completed route on its own page.
    // Candidates are grouped by normalized line number so duplicate line-tag
    // occurrences do not manufacture a false ambiguity. A valve is assigned
    // only when the nearest distinct line wins by a meaningful margin.
    function associateValvesAcrossRoutes(tags, routes) {
        const routeList = Array.from(routes || []);
        const detectedLinesByPage = new Map();
        const detectedLineOccurrencesByPage = new Map();
        const tracedLinesByPage = new Map();
        const tracedLineOccurrencesByPage = new Map();
        for (const lineTag of (tags || []).filter(isLineTag)) {
            const keys = detectedLinesByPage.get(lineTag.page) || new Set();
            keys.add(normalizedLineTag(lineTag.tag));
            detectedLinesByPage.set(lineTag.page, keys);
            const occurrences = detectedLineOccurrencesByPage.get(lineTag.page) || new Set();
            occurrences.add(lineTag.id);
            detectedLineOccurrencesByPage.set(lineTag.page, occurrences);
        }
        for (const route of routeList) {
            const keys = tracedLinesByPage.get(route.page) || new Set();
            keys.add(normalizedLineTag(route.tagText));
            tracedLinesByPage.set(route.page, keys);
            const occurrences = tracedLineOccurrencesByPage.get(route.page) || new Set();
            occurrences.add(route.tagId);
            tracedLineOccurrencesByPage.set(route.page, occurrences);
        }

        return (tags || []).filter(isValveTag).map(tag => {
            const rawCandidates = routeList
                .map(route => valveRouteCandidate(tag, route))
                .filter(Boolean)
                .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.score - b.score || a.distance - b.distance);
            const groupedCandidates = new Map();

            for (const candidate of rawCandidates) {
                const key = normalizedLineTag(candidate.lineTag);
                const existing = groupedCandidates.get(key);
                if (!existing || candidate.score < existing.score) {
                    groupedCandidates.set(key, {
                        ...candidate,
                        lineOccurrenceIds: Array.from(new Set([
                            ...(existing?.lineOccurrenceIds || []),
                            candidate.lineOccurrenceId
                        ]))
                    });
                } else {
                    existing.lineOccurrenceIds = Array.from(new Set([
                        ...(existing.lineOccurrenceIds || []),
                        candidate.lineOccurrenceId
                    ]));
                }
            }

            const candidates = Array.from(groupedCandidates.values())
                .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.score - b.score || a.distance - b.distance);
            const viable = candidates.filter(candidate => candidate.eligible && candidate.distance <= candidate.radius);
            const detectedLineKeys = detectedLinesByPage.get(tag.page) || new Set();
            const tracedLineKeys = tracedLinesByPage.get(tag.page) || new Set();
            const detectedLineOccurrences = detectedLineOccurrencesByPage.get(tag.page) || new Set();
            const tracedLineOccurrences = tracedLineOccurrencesByPage.get(tag.page) || new Set();
            const pageCoverageComplete = !detectedLineOccurrences.size ||
                Array.from(detectedLineOccurrences).every(id => tracedLineOccurrences.has(id));
            const base = {
                valveTag: tag.tag,
                occurrenceId: tag.id,
                tagType: tag.tagType,
                page: tag.page,
                method: 'directional-topology-route',
                pageLineCoverageComplete: pageCoverageComplete,
                detectedLineCount: detectedLineOccurrences.size,
                tracedLineCount: tracedLineOccurrences.size,
                detectedLineNumberCount: detectedLineKeys.size,
                tracedLineNumberCount: tracedLineKeys.size,
                candidates: candidates.slice(0, 4)
            };

            if (!viable.length) {
                return {
                    ...base,
                    status: 'unassigned',
                    lineTag: '',
                    lineOccurrenceId: null,
                    distance: null,
                    confidence: 0,
                    reason: routeList.some(route => route.page === tag.page)
                        ? 'no-traced-route-within-association-radius'
                        : 'no-line-route-traced-on-page'
                };
            }

            const best = viable[0];
            const second = viable[1];
            const ambiguityMargin = Math.max(8, best.radius * 0.18);
            if (second && second.score - best.score <= ambiguityMargin) {
                return {
                    ...base,
                    status: 'review',
                    lineTag: '',
                    lineOccurrenceId: null,
                    distance: best.distance,
                    confidence: best.confidence,
                    reason: 'multiple-lines-within-association-margin'
                };
            }

            if (best.confidence < 0.25) {
                return {
                    ...base,
                    status: 'review',
                    lineTag: best.lineTag,
                    lineOccurrenceId: best.lineOccurrenceId,
                    distance: best.distance,
                    confidence: best.confidence,
                    reason: 'nearest-line-has-low-confidence'
                };
            }

            if (best.routeStatus !== 'yes') {
                return {
                    ...base,
                    status: 'review',
                    lineTag: best.lineTag,
                    lineOccurrenceId: best.lineOccurrenceId,
                    distance: best.distance,
                    confidence: best.confidence,
                    reason: 'nearest-line-route-needs-review'
                };
            }

            if (!pageCoverageComplete) {
                return {
                    ...base,
                    status: 'review',
                    lineTag: best.lineTag,
                    lineOccurrenceId: best.lineOccurrenceId,
                    distance: best.distance,
                    confidence: best.confidence,
                    reason: 'not-all-detected-lines-on-page-have-a-route'
                };
            }

            return {
                ...base,
                status: 'assigned',
                lineTag: best.lineTag,
                lineOccurrenceId: best.lineOccurrenceId,
                distance: best.distance,
                confidence: best.confidence,
                reason: 'unique-nearest-traced-route'
            };
        });
    }

    function reconcileValveAssociations() {
        const associations = associateValvesAcrossRoutes(state.tags, state.traceResults.values());
        state.valveAssociations.clear();
        associations.forEach(association => state.valveAssociations.set(association.occurrenceId, association));

        const lineSummaries = Array.from(state.traceResults.values()).map(route => {
            const assigned = associations.filter(association =>
                association.status === 'assigned' && association.lineOccurrenceId === route.tagId
            );
            const review = associations.filter(association =>
                association.status === 'review' &&
                (association.lineOccurrenceId === route.tagId ||
                    association.candidates.some(candidate =>
                        candidate.lineOccurrenceId === route.tagId ||
                        candidate.lineOccurrenceIds?.includes(route.tagId)
                    ))
            );
            return {
                lineTag: route.tagText,
                occurrenceId: route.tagId,
                assignedValveIds: assigned.map(association => association.occurrenceId),
                reviewValveIds: review.map(association => association.occurrenceId),
                assignedCount: assigned.length,
                reviewCount: review.length
            };
        });

        const counts = associations.reduce((result, association) => {
            result[association.status] = (result[association.status] || 0) + 1;
            return result;
        }, { assigned: 0, review: 0, unassigned: 0 });

        emitTraceEvent('pipe-valve-associations', { associations, lineSummaries, counts });
        return { associations, lineSummaries, counts };
    }

    function valvesForLine(tag, reconciliation) {
        return (reconciliation?.associations || []).filter(association =>
            association.lineOccurrenceId === tag?.id ||
            (association.status === 'review' && association.candidates.some(candidate =>
                candidate.lineOccurrenceId === tag?.id ||
                candidate.lineOccurrenceIds?.includes(tag?.id)
            ))
        );
    }

    function buildTrace(geometry, tag) {
        const seed = findSeedEdges(geometry, tag);
        if (!seed.selected) {
            return {
                failed: true,
                reason: seed.center ? 'No stroked vector segment was found near the selected line tag.' : 'The selected line has no usable PDF coordinate rectangle.',
                seed
            };
        }

        const selectedLine = normalizedLineTag(tag.tag);
        const lineAnchors = getLineTags()
            .filter(candidate => candidate.page === tag.page && candidate.id !== tag.id)
            .filter(candidate => normalizedLineTag(candidate.tag) !== selectedLine)
            .map(candidate => {
                const candidateSeed = findSeedEdges(geometry, candidate);
                if (!candidateSeed.selected) return null;
                return {
                    tagId: candidate.id,
                    tagText: candidate.tag,
                    normalizedTag: normalizedLineTag(candidate.tag),
                    edgeId: candidateSeed.selected.edge.id,
                    distance: candidateSeed.selected.distance
                };
            })
            .filter(Boolean);
        const component = traceContinuation(geometry, seed.selected.edge, { lineAnchors });
        const routeLength = component.routeDistance;
        const routePixelCount = Math.round(routeLength * Math.max(1, geometry.typicalWidth) * RENDER_SCALE);

        return {
            failed: false,
            seed,
            component,
            routeLength,
            routePixelCount
        };
    }

    function normalizedLineTag(tagText) {
        return String(tagText || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    function routeOverlapRecord(route, otherRoute, geometry) {
        if (!route || !otherRoute || route.page !== otherRoute.page) return null;
        if (normalizedLineTag(route.tagText) === normalizedLineTag(otherRoute.tagText)) return null;

        const otherEdgeIds = new Set(otherRoute.edgeIds || []);
        const sharedEdgeIds = (route.edgeIds || []).filter(edgeId => otherEdgeIds.has(edgeId));
        if (!sharedEdgeIds.length) return null;

        const sharedLength = sharedEdgeIds.reduce((total, edgeId) => {
            const edge = geometry.edges[edgeId];
            return total + (Number(edge?.length) || 0);
        }, 0);
        const routeLength = Math.max(0, Number(route.routeLength) || 0);
        const otherRouteLength = Math.max(0, Number(otherRoute.routeLength) || 0);
        const shorterRouteLength = Math.min(routeLength, otherRouteLength);
        const routeCoverage = sharedLength / Math.max(1, routeLength);
        const otherRouteCoverage = sharedLength / Math.max(1, otherRouteLength);
        const shorterCoverage = sharedLength / Math.max(1, shorterRouteLength);
        const typicalWidth = Number(geometry?.typicalWidth) || 1;
        const snapTolerance = Number(geometry?.snapTolerance) || 1.5;
        const minimumSharedLength = Math.max(24, typicalWidth * 18, snapTolerance * 8);
        const longOverlapLength = Math.max(120, typicalWidth * 80);

        // A few common edges at a real tee are not enough to call two lines
        // duplicates. Require substantial shared geometry, or a long shared
        // run, before surfacing a route-overlap warning.
        if (sharedLength < minimumSharedLength ||
            (shorterCoverage < 0.35 && sharedLength < longOverlapLength)) return null;

        return {
            tag: otherRoute.tagText,
            occurrenceId: otherRoute.tagId,
            page: otherRoute.page,
            sharedEdgeCount: sharedEdgeIds.length,
            sharedLength: Number(sharedLength.toFixed(2)),
            routeLength: Number(routeLength.toFixed(2)),
            otherRouteLength: Number(otherRouteLength.toFixed(2)),
            routeCoverage: Number(routeCoverage.toFixed(3)),
            otherRouteCoverage: Number(otherRouteCoverage.toFixed(3)),
            overlapRatio: Number(shorterCoverage.toFixed(3)),
            classification: shorterCoverage >= 0.8
                ? 'near-identical-route'
                : 'partial-route-overlap'
        };
    }

    function describeRouteOverlaps(overlaps) {
        const names = Array.from(new Set((overlaps || [])
            .map(overlap => String(overlap.tag || '').trim())
            .filter(Boolean)));
        if (!names.length) return '';
        const shown = names.slice(0, 4).join(', ');
        const suffix = names.length > 4 ? ` and ${names.length - 4} more` : '';
        return `possible route overlap with ${shown}${suffix}`;
    }

    function effectiveTraceResult(entry) {
        const overlaps = entry.overlaps || [];
        const overlapDescription = describeRouteOverlaps(overlaps);
        return {
            status: overlaps.length ? 'review' : entry.baseStatus,
            summary: overlapDescription
                ? `${String(entry.baseSummary || '').replace(/[.]$/, '')}; ${overlapDescription}.`
                : entry.baseSummary,
            reason: overlaps.length ? 'route-overlap' : entry.baseReason,
            overlaps
        };
    }

    function refreshTraceRouteOverlaps() {
        const entries = Array.from(state.traceResults.values());
        entries.forEach(entry => { entry.overlaps = []; });

        for (let firstIndex = 0; firstIndex < entries.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex++) {
                const first = entries[firstIndex];
                const second = entries[secondIndex];
                const firstRecord = routeOverlapRecord(first, second, first.geometry);
                if (!firstRecord) continue;
                const secondRecord = routeOverlapRecord(second, first, second.geometry);
                first.overlaps.push(firstRecord);
                second.overlaps.push(secondRecord || {
                    ...firstRecord,
                    tag: first.tagText,
                    occurrenceId: first.tagId,
                    routeLength: secondRecord?.routeLength ?? firstRecord.otherRouteLength,
                    otherRouteLength: secondRecord?.otherRouteLength ?? firstRecord.routeLength,
                    routeCoverage: firstRecord.otherRouteCoverage,
                    otherRouteCoverage: firstRecord.routeCoverage
                });
            }
        }

        const changed = [];
        for (const entry of entries) {
            const effective = effectiveTraceResult(entry);
            const overlapKey = (entry.overlaps || [])
                .map(overlap => `${overlap.occurrenceId}:${overlap.classification}:${overlap.sharedLength}`)
                .sort()
                .join('|');
            const previous = entry.published || {};
            if (previous.status !== effective.status || previous.summary !== effective.summary ||
                previous.reason !== effective.reason || previous.overlapKey !== overlapKey) {
                entry.published = {
                    status: effective.status,
                    summary: effective.summary,
                    reason: effective.reason,
                    overlapKey
                };
                changed.push({ entry, effective });
            }
        }
        return changed;
    }

    function registerTraceRoute(tag, trace, geometry, baseStatus, baseDetails) {
        if (!geometry || !trace?.component) return [];

        state.traceResults.set(tag.id, {
            tagId: tag.id,
            tagText: tag.tag,
            page: tag.page,
            edgeIds: Array.from(new Set(trace.component.edgeIds || [])),
            associationEdgeIds: associationEdgeIdsForRoute(tag, trace.component),
            routeLength: Number(trace.routeLength) || 0,
            geometry,
            baseStatus,
            baseSummary: baseDetails.summary || '',
            baseReason: baseDetails.reason || '',
            baseDetails: { ...baseDetails },
            overlaps: [],
            published: null
        });
        return refreshTraceRouteOverlaps();
    }

    function removeTraceRoute(tagId) {
        if (!state.traceResults.delete(tagId)) return [];
        return refreshTraceRouteOverlaps();
    }

    function publishRouteResultChanges(changes) {
        for (const change of changes || []) {
            const tag = state.tags.find(candidate => candidate.id === change.entry.tagId);
            if (!tag) continue;
            publishTraceResult(tag, change.effective.status, {
                ...change.entry.baseDetails,
                summary: change.effective.summary,
                reason: change.effective.reason,
                routeOverlaps: change.effective.overlaps
            });
        }
    }

    function traceStopLabel(reason) {
        const labels = {
            endpoint: 'an endpoint',
            loop: 'a closed loop',
            'tee-junction': 'a tee connection',
            'ambiguous-tee': 'an ambiguous tee connection',
            'competing-continuations': 'competing continuations',
            'competing-tee-continuations': 'competing tee continuations',
            'cross-or-complex-junction': 'a crossing/complex junction',
            'high-degree-junction': 'a complex junction',
            'no-valid-continuation': 'no safe continuation',
            'foreign-line-boundary': 'a different tagged line',
            'safety-distance-limit': 'the safety distance limit'
        };
        return labels[reason] || String(reason || 'an unknown condition').replaceAll('-', ' ');
    }

    function traceNeedsReview(component, selectedTag = null) {
        const teeJunctions = component.teeJunctions || component.branches || [];
        const selectedLine = normalizedLineTag(selectedTag?.tag);
        const hasDifferentConnectedLine = junction => selectedLine && (junction.connectedLineTags || []).some(lineTag =>
            normalizedLineTag(lineTag.tag) && normalizedLineTag(lineTag.tag) !== selectedLine
        );
        const hasSameConnectedLine = junction => selectedLine && (junction.connectedLineTags || []).some(lineTag =>
            normalizedLineTag(lineTag.tag) === selectedLine
        );
        const boundaryNodeIds = new Set((component.lineBoundaries || []).map(boundary => boundary.nodeId));

        // A stopped tee is a valid line boundary only when another, different
        // line tag is found along the outgoing run. A passed tee still needs a
        // tagged side line before the main route can be considered complete.
        if (teeJunctions.some(junction => junction.stopped &&
            !hasDifferentConnectedLine(junction) && !boundaryNodeIds.has(junction.nodeId))) return true;
        if (teeJunctions.some(junction => !junction.stopped && !hasDifferentConnectedLine(junction))) return true;
        if (teeJunctions.some(hasSameConnectedLine)) return true;
        if ((component.ambiguousNodes || []).length) return true;
        if ((component.routeOverlaps || []).length) return true;

        const reviewReasons = new Set([
            'competing-continuations',
            'cross-or-complex-junction',
            'high-degree-junction',
            'no-valid-continuation',
            'safety-distance-limit'
        ]);
        return (component.stops || []).some(stop => reviewReasons.has(stop.reason));
    }

    function describeTrace(component) {
        const teeJunctions = component.teeJunctions || component.branches || [];
        const inlineObjects = component.inlineObjects || [];
        const lineBoundaries = component.lineBoundaries || [];
        const crossings = component.crossings || [];
        const branchCount = teeJunctions.reduce(
            (count, junction) => count + (junction.branchEdges || []).length,
            0
        );
        const connectedLineTagCount = new Set(
            teeJunctions.flatMap(junction => (junction.connectedLineTags || []).map(tag => tag.occurrenceId))
        ).size;
        const stopLabels = Array.from(new Set(
            (component.stops || []).map(stop => traceStopLabel(stop.reason))
        ));
        const details = [];
        if (teeJunctions.length) {
            const connectionDetails = [];
            if (branchCount) connectionDetails.push(`${branchCount} side line${branchCount === 1 ? '' : 's'}`);
            if (connectedLineTagCount) {
                const connectedNames = Array.from(new Set(
                    teeJunctions.flatMap(junction => (junction.connectedLineTags || [])
                        .map(tag => String(tag.tag || '').trim())
                        .filter(Boolean))
                ));
                const shownNames = connectedNames.slice(0, 4).join(', ');
                const moreNames = connectedNames.length > 4 ? ` and ${connectedNames.length - 4} more` : '';
                connectionDetails.push(`${connectedLineTagCount} tagged line${connectedLineTagCount === 1 ? '' : 's'}: ${shownNames}${moreNames}`);
            }
            details.push(`${teeJunctions.length} tee connection${teeJunctions.length === 1 ? '' : 's'}${connectionDetails.length ? ` (${connectionDetails.join('; ')})` : ''}`);
        }
        if (inlineObjects.length) {
            const inlineLabels = Array.from(new Set(
                inlineObjects.map(object => object.catalogLabel).filter(Boolean)
            ));
            const labelDetails = inlineLabels.length ? ` (catalog: ${inlineLabels.join(', ')})` : '';
            details.push(`${inlineObjects.length} inline object${inlineObjects.length === 1 ? '' : 's'} passed${labelDetails}`);
        }
        if (lineBoundaries.length) {
            const names = Array.from(new Set(lineBoundaries.flatMap(boundary =>
                (boundary.connectedLineTags || []).map(lineTag => lineTag.tag).filter(Boolean)
            )));
            const nameDetails = names.length ? ` (${names.slice(0, 4).join(', ')})` : '';
            details.push(`${lineBoundaries.length} tagged line boundar${lineBoundaries.length === 1 ? 'y' : 'ies'} respected${nameDetails}`);
        }
        if (crossings.length) {
            details.push(`${crossings.length} crossing${crossings.length === 1 ? '' : 's'} passed`);
        }
        const routeOverlapDescription = describeRouteOverlaps(component.routeOverlaps);
        if (routeOverlapDescription) details.push(routeOverlapDescription);
        if (stopLabels.length) details.push(`stopped at ${stopLabels.join(' and ')}`);
        return `${component.edgeIds.length} connected segment${component.edgeIds.length === 1 ? '' : 's'}${details.length ? `; ${details.join('; ')}` : ''}.`;
    }

    function publishTraceResult(tag, status, details = {}) {
        emitTraceEvent('pipe-trace-result', {
            ...details,
            tagId: tag?.id ?? null,
            tag: tag?.tag || '',
            page: tag?.page ?? null,
            status
        });
    }

    function viewportPoint(viewport, point) {
        if (viewport?.convertToViewportPoint) return viewport.convertToViewportPoint(point[0], point[1]);
        return window.pdfjsLib.Util.applyTransform(point, viewport.transform);
    }

    function drawPdfRect(ctx, viewport, rect, style) {
        if (!rect) return;
        const p1 = viewportPoint(viewport, [rect.x, rect.y]);
        const p2 = viewportPoint(viewport, [rect.x + rect.width, rect.y + rect.height]);
        ctx.strokeStyle = style;
        ctx.lineWidth = 3;
        ctx.strokeRect(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
    }

    function drawTrace(pageDiv, viewport, geometry, trace, tag, debug) {
        clearTraceOverlays();
        if (!pageDiv || !geometry) return;

        const debugView = typeof debug === 'object'
            ? { enabled: false, filtered: true, candidates: true, labels: true, seed: true, ...debug }
            : { enabled: Boolean(debug), filtered: true, candidates: true, labels: true, seed: true };

        const canvas = document.createElement('canvas');
        canvas.className = 'pipe-trace-overlay';
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:7;';
        pageDiv.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (debugView.enabled && debugView.filtered) {
            for (const segment of geometry.excludedSegments || []) {
                const a = viewportPoint(viewport, segment.a);
                const b = viewportPoint(viewport, segment.b);
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.strokeStyle = '#8e44ad';
                ctx.lineWidth = Math.max(3, (segment.strokeWidth || 1) * RENDER_SCALE + 1);
                ctx.stroke();
            }
        }

        if (trace.failed) {
            if (debugView.enabled) drawPdfRect(ctx, viewport, tag.pdfRect, '#ffd400');
            return;
        }

        const routeEdgeIds = new Set(trace.component.edgeIds);

        for (const edgeId of trace.component.edgeIds) {
            const edge = geometry.edges[edgeId];
            const a = viewportPoint(viewport, geometry.nodes[edge.a].point);
            const b = viewportPoint(viewport, geometry.nodes[edge.b].point);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.strokeStyle = edge.kind === 'component-gap' ? '#1683ff' : '#00c878';
            ctx.lineWidth = edge.kind === 'component-gap' ? 7 : Math.max(4, (edge.strokeWidth || 1) * RENDER_SCALE + 2);
            ctx.stroke();
        }

        const drawNodeMarker = (nodeId, radius, strokeStyle, fillStyle = null) => {
            const node = geometry.nodes[nodeId];
            if (!node) return;
            const point = viewportPoint(viewport, node.point);
            ctx.beginPath();
            ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = 3;
            if (fillStyle) {
                ctx.fillStyle = fillStyle;
                ctx.fill();
            }
            ctx.stroke();
        };

        // Mark topology even in normal mode. The marker tells the reviewer
        // where the selected run passes a tee, crosses another line, or ends.
        for (const tee of trace.component.teeJunctions || trace.component.branches || []) {
            drawNodeMarker(
                tee.nodeId,
                tee.stopped ? 10 : 8,
                tee.stopped ? '#d32f2f' : '#f59e0b',
                tee.stopped ? 'rgba(211, 47, 47, 0.16)' : 'rgba(245, 158, 11, 0.14)'
            );
        }

        for (const inlineObject of trace.component.inlineObjects || []) {
            drawNodeMarker(
                inlineObject.nodeId,
                7,
                '#0f766e',
                'rgba(15, 118, 110, 0.14)'
            );
        }

        for (const crossing of trace.component.crossings || []) {
            drawNodeMarker(crossing.nodeId, 7, '#2563eb', 'rgba(37, 99, 235, 0.12)');
        }

        for (const endpointNodeId of trace.component.endpoints || []) {
            drawNodeMarker(endpointNodeId, 8, '#dc2626', 'rgba(220, 38, 38, 0.12)');
        }

        for (const ambiguous of trace.component.ambiguousNodes || []) {
            drawNodeMarker(ambiguous.nodeId, 10, '#f57c00', 'rgba(245, 124, 0, 0.12)');
        }

        if (!debugView.enabled) return;

        if (debugView.candidates) {
            const candidateStyles = new Map();
            const candidatePriority = style => style === '#e53935' ? 3 : style === '#2563eb' ? 2 : 1;
            for (const decision of trace.decisionRecords || []) {
                const action = String(decision.action || '');
                const style = action.includes('crossing')
                    ? '#2563eb'
                    : action.startsWith('stop-')
                        ? '#e53935'
                        : '#f59e0b';
                for (const candidate of decision.candidates || []) {
                    if (routeEdgeIds.has(candidate.edgeId)) continue;
                    const previous = candidateStyles.get(candidate.edgeId);
                    if (!previous || candidatePriority(style) > candidatePriority(previous)) {
                        candidateStyles.set(candidate.edgeId, style);
                    }
                }
            }

            for (const [edgeId, style] of candidateStyles) {
                const edge = geometry.edges[edgeId];
                if (!edge) continue;
                const a = viewportPoint(viewport, geometry.nodes[edge.a].point);
                const b = viewportPoint(viewport, geometry.nodes[edge.b].point);
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.strokeStyle = style;
                ctx.lineWidth = Math.max(4, (edge.strokeWidth || 1) * RENDER_SCALE + 2);
                ctx.setLineDash([10, 7]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        const junctions = [
            ...(trace.component.teeJunctions || trace.component.branches || []),
            ...(trace.component.crossings || [])
        ];
        for (const junction of debugView.candidates ? junctions : []) {
            const branchEdges = junction.branchEdges || junction.connectedEdges || [];
            const strokeStyle = junction.type === 'tee-junction' ? '#e53935' : '#2563eb';
            for (const branchEdge of branchEdges) {
                if (routeEdgeIds.has(branchEdge.edgeId)) continue;
                const edge = geometry.edges[branchEdge.edgeId];
                if (!edge) continue;
                const a = viewportPoint(viewport, geometry.nodes[edge.a].point);
                const b = viewportPoint(viewport, geometry.nodes[edge.b].point);
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = Math.max(4, (edge.strokeWidth || 1) * RENDER_SCALE + 2);
                ctx.setLineDash([8, 6]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        for (const bridge of trace.component.bridges) {
            const a = viewportPoint(viewport, geometry.nodes[bridge.a].point);
            const b = viewportPoint(viewport, geometry.nodes[bridge.b].point);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.strokeStyle = '#1683ff';
            ctx.lineWidth = 5;
            ctx.stroke();
        }

        if (debugView.labels) {
            for (const decision of trace.decisionRecords || []) {
                if (!decision.point || decision.action === 'continue') continue;
                const point = viewportPoint(viewport, decision.point);
                const label = `N${decision.nodeId ?? '?'} d${decision.degree ?? '?'} ${debugActionLabel(decision.action)}`;
                ctx.font = '600 18px Arial, sans-serif';
                const paddingX = 7;
                const paddingY = 5;
                const metrics = ctx.measureText(label);
                const labelX = point[0] + 12;
                const labelY = point[1] - 12;
                ctx.fillStyle = 'rgba(255,255,255,0.92)';
                ctx.fillRect(labelX - paddingX, labelY - 18 - paddingY, metrics.width + paddingX * 2, 22 + paddingY * 2);
                ctx.strokeStyle = decision.action.startsWith('stop-') ? '#e53935' :
                    decision.action.includes('crossing') ? '#2563eb' :
                        decision.action.includes('inline') ? '#0f766e' : '#f59e0b';
                ctx.lineWidth = 2;
                ctx.strokeRect(labelX - paddingX, labelY - 18 - paddingY, metrics.width + paddingX * 2, 22 + paddingY * 2);
                ctx.fillStyle = '#172033';
                ctx.fillText(label, labelX, labelY);
            }
        }

        if (debugView.seed && trace.seed?.center) {
            const point = viewportPoint(viewport, trace.seed.center);
            ctx.beginPath();
            ctx.arc(point[0], point[1], 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(point[0] - 17, point[1]);
            ctx.lineTo(point[0] + 17, point[1]);
            ctx.moveTo(point[0], point[1] - 17);
            ctx.lineTo(point[0], point[1] + 17);
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        drawPdfRect(ctx, viewport, tag.pdfRect, '#ffd400');
    }

    function getPageBounds(page) {
        const view = page?.view || [0, 0, page?.getViewport?.({ scale: 1 }).width || 0, page?.getViewport?.({ scale: 1 }).height || 0];
        return {
            minX: Math.min(view[0], view[2]),
            minY: Math.min(view[1], view[3]),
            maxX: Math.max(view[0], view[2]),
            maxY: Math.max(view[1], view[3])
        };
    }

    async function getGeometry(pageNumber, page) {
        if (state.geometryCache.has(pageNumber)) return state.geometryCache.get(pageNumber);

        const [operatorList, textContent] = await Promise.all([
            page.getOperatorList({ intent: 'display' }),
            page.getTextContent()
        ]);
        const extracted = extractVectorSegments(operatorList);
        const textBoxes = extractTextBoxes(textContent);
        const geometry = buildGraph(extracted.segments, page, {
            pathRecords: extracted.paths,
            textBoxes,
            lineTags: getLineTags().filter(tag => tag.page === pageNumber)
        });
        geometry.operatorCounts = extracted.counts;
        geometry.operatorCount = operatorList?.fnArray?.length || 0;
        geometry.pageBounds = getPageBounds(page);
        geometry.textBoxCount = textBoxes.length;
        state.geometryCache.set(pageNumber, geometry);
        return geometry;
    }

    async function traceSelectedLine() {
        if (!state.enabled || !state.pdfDoc) return;
        const tag = selectedTag();
        if (!tag) {
            setStatus('Click a detected line in Found tags first.', 'warning');
            return;
        }

        const requestId = ++state.requestId;
        state.traceRunning = true;
        emitTracingState();
        setStatus(`Tracing ${tag.tag} on page ${tag.page}...`);
        setDiagnostics(null);
        clearTraceOverlays();
        updateTraceButtons();
        const removedRouteChanges = removeTraceRoute(tag.id);
        publishRouteResultChanges(removedRouteChanges);
        reconcileValveAssociations();
        publishTraceResult(tag, 'running', { summary: 'Tracing in progress.' });

        try {
            const page = await state.pdfDoc.getPage(tag.page);
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const geometry = await getGeometry(tag.page, page);
            if (requestId !== state.requestId || !state.enabled) return;

            const trace = buildTrace(geometry, tag);
            state.trace = trace;
            state.traceGeometry = geometry;

            if (trace.failed) {
                const overlapChanges = removeTraceRoute(tag.id);
                publishRouteResultChanges(overlapChanges);
                reconcileValveAssociations();
                const pageDiv = document.getElementById(`page-${tag.page}`);
                drawTrace(pageDiv, viewport, geometry, trace, tag, getDebugViewConfig());
                setStatus(trace.reason, 'warning');
                setDiagnostics({
                    lineTag: tag.tag,
                    page: tag.page,
                    operatorCount: geometry.operatorCount,
                    operatorCounts: geometry.operatorCounts,
                    rawVectorSegments: geometry.rawSegments.length,
                    vectorSegments: geometry.segments.length,
                    excludedVectorSegments: geometry.excludedSegments.length,
                    annotationCandidates: geometry.annotationCandidates.length,
                    annotationCandidateRecords: geometry.annotationCandidates,
                    graphNodes: geometry.nodes.length,
                    graphEdges: geometry.edges.length,
                    seed: trace.seed,
                    decisionRecords: trace.component?.decisionRecords || []
                });
                renderDebugInspector(trace, geometry, tag);
                publishTraceResult(tag, 'no', {
                    summary: trace.reason,
                    reason: 'missing-line-geometry'
                });
                return;
            }

            const pageDiv = document.getElementById(`page-${tag.page}`);
            drawTrace(pageDiv, viewport, geometry, trace, tag, getDebugViewConfig());
            associateConnectedLineTags(state.tags, tag.page, geometry, trace.component, tag.id);

            const teeJunctions = trace.component.teeJunctions || trace.component.branches || [];
            const branchCount = teeJunctions.reduce(
                (count, junction) => count + (junction.branchEdges || []).length,
                0
            );
            const crossings = trace.component.crossings || [];
            const teeRecords = teeJunctions.map(junction => ({
                nodeId: junction.nodeId,
                type: junction.type,
                degree: junction.degree,
                stopped: Boolean(junction.stopped),
                reason: junction.reason,
                connectedLineTags: (junction.connectedLineTags || []).map(lineTag => ({ ...lineTag })),
                branchEdges: (junction.branchEdges || []).map(branchEdge => ({ ...branchEdge }))
            }));
            const connectedLineTags = Array.from(new Set(
                teeJunctions.flatMap(junction => (junction.connectedLineTags || [])
                    .map(lineTag => String(lineTag.tag || '').trim())
                    .filter(Boolean))
            ));
            const baseTraceStatus = traceNeedsReview(trace.component, tag) ? 'review' : 'yes';
            const baseTraceSummary = describeTrace(trace.component);
            const baseTraceReason = trace.component.stoppedReason;
            const resultDetails = {
                summary: baseTraceSummary,
                reason: baseTraceReason,
                routeEdges: trace.component.edgeIds.length,
                routeLength: Number(trace.routeLength.toFixed(2)),
                teeConnections: teeJunctions.length,
                teeRecords,
                connectedLineTags,
                inlineObjects: (trace.component.inlineObjects || []).length,
                lineBoundaries: (trace.component.lineBoundaries || []).length,
                crossings: crossings.length,
                ambiguousNodes: trace.component.ambiguousNodes.length,
                endpoints: trace.component.endpoints.length
            };
            const overlapChanges = registerTraceRoute(
                tag,
                trace,
                geometry,
                baseTraceStatus,
                resultDetails
            );
            const traceEntry = state.traceResults.get(tag.id);
            const reconciliation = reconcileValveAssociations();
            const valves = valvesForLine(tag, reconciliation);
            trace.valves = valves;
            resultDetails.valves = valves;
            resultDetails.assignedValves = valves.filter(valve => valve.status === 'assigned').length;
            resultDetails.valvesForReview = valves.filter(valve => valve.status === 'review').length;
            if (traceEntry) {
                Object.assign(traceEntry.baseDetails, {
                    valves,
                    assignedValves: resultDetails.assignedValves,
                    valvesForReview: resultDetails.valvesForReview
                });
            }
            trace.component.routeOverlaps = traceEntry?.overlaps || [];
            const effectiveResult = traceEntry
                ? effectiveTraceResult(traceEntry)
                : { status: baseTraceStatus, summary: baseTraceSummary, reason: baseTraceReason, overlaps: [] };
            publishRouteResultChanges(overlapChanges);
            setStatus(
                `Traced ${tag.tag}: ${effectiveResult.summary}`,
                effectiveResult.status === 'review' ? 'warning' : 'ok'
            );
            setDiagnostics({
                lineTag: tag.tag,
                page: tag.page,
                seed: {
                    x: Number(trace.seed.center[0].toFixed(2)),
                    y: Number(trace.seed.center[1].toFixed(2)),
                    distance: Number(trace.seed.selected.distance.toFixed(2)),
                    radius: Number(trace.seed.radius.toFixed(2)),
                    alignment: Number(trace.seed.selected.alignment.toFixed(3)),
                    score: Number(trace.seed.selected.score.toFixed(2)),
                    edgeId: trace.seed.selected.edge.id,
                    geometryType: trace.seed.selected.edge.geometryType || 'raw-stroke',
                    sourcePath: trace.seed.selected.edge.sourcePath ?? null
                },
                routePixelCount: trace.routePixelCount,
                routeLength: Number(trace.routeLength.toFixed(2)),
                maxRouteDistance: Number(trace.component.maxRouteDistance.toFixed(2)),
                routeEdges: trace.component.edgeIds.length,
                branchesDetected: branchCount,
                branchRecords: teeJunctions,
                teeConnectionsDetected: teeJunctions.length,
                teeConnectionRecords: teeJunctions,
                inlineObjectsPassed: (trace.component.inlineObjects || []).length,
                inlineObjectRecords: trace.component.inlineObjects || [],
                taggedLineBoundaries: (trace.component.lineBoundaries || []).length,
                taggedLineBoundaryRecords: trace.component.lineBoundaries || [],
                crossingsDetected: crossings.length,
                crossingRecords: crossings,
                ambiguousNodes: trace.component.ambiguousNodes.length,
                ambiguousRecords: trace.component.ambiguousNodes,
                endpoints: trace.component.endpoints.length,
                endpointNodes: trace.component.endpoints,
                bridgedGaps: trace.component.bridges.length,
                bridgedGapRecords: trace.component.bridges.map(bridge => ({
                    edgeId: bridge.id,
                    fromNode: bridge.a,
                    toNode: bridge.b,
                    length: Number(bridge.length.toFixed(2))
                })),
                candidateComponents: trace.component.bridges.length,
                traceStoppedBecause: trace.component.stoppedReason,
                stopRecords: trace.component.stops,
                decisionRecords: trace.component.decisionRecords || [],
                traceSummary: effectiveResult.summary,
                routeOverlaps: effectiveResult.overlaps,
                routeOverlapRecords: effectiveResult.overlaps,
                valves,
                geometry: {
                    operatorCount: geometry.operatorCount,
                    operatorCounts: geometry.operatorCounts,
                    rawVectorSegments: geometry.rawSegments.length,
                    vectorSegments: geometry.segments.length,
                    excludedVectorSegments: geometry.excludedSegments.length,
                    annotationCandidates: geometry.annotationCandidates.length,
                    annotationCandidateRecords: geometry.annotationCandidates,
                    textBoxes: geometry.textBoxCount,
                    graphNodes: geometry.nodes.length,
                    graphEdges: geometry.edges.length,
                    typicalStrokeWidth: Number(geometry.typicalWidth.toFixed(3)),
                    snapTolerance: Number(geometry.snapTolerance.toFixed(3)),
                    bridgeTolerance: Number(geometry.bridgeTolerance.toFixed(3))
                }
            });
            renderDebugInspector(trace, geometry, tag);
        } catch (error) {
            console.error('Pipe tracing error:', error);
            const overlapChanges = removeTraceRoute(tag.id);
            publishRouteResultChanges(overlapChanges);
            reconcileValveAssociations();
            setStatus(`Pipe tracing failed: ${error.message}`, 'error');
            setDiagnostics({ lineTag: tag.tag, page: tag.page, error: error.message });
            publishTraceResult(tag, 'no', {
                summary: `Tracing failed: ${error.message}`,
                reason: 'trace-error'
            });
        } finally {
            state.traceRunning = false;
            updateTraceButtons();
            emitTracingState();
        }
    }

    async function traceAllLines() {
        if (!state.enabled || !state.pdfDoc || state.batchRunning || state.traceRunning) return;
        const lineTags = getLineTags();
        if (!lineTags.length) {
            setStatus('No detected line tags are available to check.', 'warning');
            return;
        }

        state.batchRunning = true;
        state.batchCompleted = 0;
        state.batchTotal = lineTags.length;
        updateBatchProgress();
        updateTraceButtons();
        emitTracingState();
        let completed = 0;

        try {
            for (const tag of lineTags) {
                if (!state.enabled) break;
                state.selectedTagId = tag.id;
                await traceSelectedLine();
                completed += 1;
                state.batchCompleted = completed;
                updateBatchProgress();
                emitTracingState();
                setStatus(`Checked ${completed}/${lineTags.length} line${lineTags.length === 1 ? '' : 's'} — see YES / REVIEW / NO in Found tags.`);
            }
        } finally {
            state.batchRunning = false;
            updateBatchProgress(state.enabled && completed === lineTags.length);
            updateTraceButtons();
            emitTracingState();
            if (state.enabled) {
                const valveCounts = Array.from(state.valveAssociations.values()).reduce((result, association) => {
                    result[association.status] = (result[association.status] || 0) + 1;
                    return result;
                }, { assigned: 0, review: 0, unassigned: 0 });
                setStatus(
                    `Checked ${completed}/${lineTags.length} line${lineTags.length === 1 ? '' : 's'}. ` +
                    `Valves: ${valveCounts.assigned} linked, ${valveCounts.review} review, ${valveCounts.unassigned} unlinked.`
                );
            }
        }
    }

    if (ui.toggle) ui.toggle.addEventListener('click', () => setEnabled(!state.enabled));
    if (ui.setupToggle) ui.setupToggle.addEventListener('click', () => {
        setSetupHidden(!ui.section?.classList.contains('pipe-tracing-setup-hidden'));
    });
    if (ui.sectionToggle) ui.sectionToggle.addEventListener('click', handleSectionToggle);
    if (ui.traceAllButton) ui.traceAllButton.addEventListener('click', traceAllLines);
    const pdfWrapper = document.getElementById('pdf-wrapper');
    if (pdfWrapper) pdfWrapper.addEventListener('click', handlePdfClick);
    if (ui.debugCheckbox) ui.debugCheckbox.addEventListener('change', () => {
        if (!ui.debugCheckbox.checked) setDebugExpanded(false);
        renderDebugInspector(state.trace, state.traceGeometry, selectedTag());
        redrawCurrentTrace();
        emitTracingState();
    });
    [
        ui.debugFilteredCheckbox,
        ui.debugCandidatesCheckbox,
        ui.debugLabelsCheckbox,
        ui.debugSeedCheckbox
    ].filter(Boolean).forEach(input => input.addEventListener('change', redrawCurrentTrace));
    if (ui.debugFocusRouteButton) ui.debugFocusRouteButton.addEventListener('click', focusDebugRoute);
    if (ui.debugFirstIssueButton) ui.debugFirstIssueButton.addEventListener('click', () => moveDebugIssue(0));
    if (ui.debugPreviousIssueButton) ui.debugPreviousIssueButton.addEventListener('click', () => moveDebugIssue(-1));
    if (ui.debugNextIssueButton) ui.debugNextIssueButton.addEventListener('click', () => moveDebugIssue(1));
    if (ui.debugCopyButton) ui.debugCopyButton.addEventListener('click', copyDebugBundle);
    if (ui.debugExpandButton) ui.debugExpandButton.addEventListener('click', () => {
        setDebugExpanded(!document.body.classList.contains('pipe-tracing-debug-expanded'));
    });

    const publicApi = {
        reset,
        setDocumentReady,
        setTagsChanged,
        selectTag,
        traceAllLines,
        get state() {
            return state;
        }
    };
    if (window.__PIPE_TRACING_TEST__) {
        publicApi.__test = {
            setEnabled,
            classifyNonPipeGeometry,
            filterNonPipeGeometry,
            textBoxFromItem,
            buildGraph,
            extractVectorSegments,
            segmentIntersections,
            traceContinuation,
            findSeedEdges,
            findInlineContinuation,
            inlineSymbolEvidence,
            buildTrace,
            traceNeedsReview,
            associateConnectedLineTags,
            associationEdgeIdsForRoute,
            valveRouteCandidate,
            associateValvesAcrossRoutes,
            routeOverlapRecord
        };
    }
    window.PipeTracing = publicApi;
})();
