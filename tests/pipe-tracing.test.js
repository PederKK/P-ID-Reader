const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tests = [];
function test(name, run) {
    tests.push({ name, run });
}

function createClassList() {
    return {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; }
    };
}

function loadTracingTests() {
    const window = {
        __PIPE_TRACING_TEST__: true,
        addEventListener() {},
        dispatchEvent() {},
        CustomEvent: class CustomEvent {
            constructor(name, options) {
                this.type = name;
                this.detail = options?.detail;
            }
        },
        pdfjsLib: {
            OPS: {},
            Util: {
                transform(left, right) {
                    return [
                        left[0] * right[0] + left[2] * right[1],
                        left[1] * right[0] + left[3] * right[1],
                        left[0] * right[2] + left[2] * right[3],
                        left[1] * right[2] + left[3] * right[3],
                        left[0] * right[4] + left[2] * right[5] + left[4],
                        left[1] * right[4] + left[3] * right[5] + left[5]
                    ];
                }
            }
        }
    };
    const document = {
        getElementById() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                classList: createClassList(),
                style: {},
                addEventListener() {},
                appendChild() {},
                remove() {},
                setAttribute() {}
            };
        },
        body: { classList: createClassList() }
    };
    const context = vm.createContext({
        window,
        document,
        navigator: {},
        console,
        Map,
        Set,
        Array,
        Math,
        Number,
        String,
        Boolean,
        Object,
        JSON,
        ArrayBuffer
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipe-tracing.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'pipe-tracing.js' });
    return window.PipeTracing.__test;
}

const tracing = loadTracingTests();

function makeGeometry(points, edgePairs) {
    const nodes = points.map((point, id) => ({ id, point, edges: [] }));
    const edges = edgePairs.map(([a, b], id) => ({
        id,
        a,
        b,
        length: Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1]),
        strokeWidth: 1,
        kind: 'pipe-segment',
        geometryType: 'raw-stroke',
        sourcePath: id,
        sourceLength: Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1]),
        sourcePathClosed: false,
        sourcePathHasCurves: false,
        sourcePathPerimeter: 0,
        sourcePathMaxDimension: 100,
        sourcePathSegmentCount: 1
    }));
    const adjacency = nodes.map(() => []);
    edges.forEach(edge => {
        adjacency[edge.a].push(edge.id);
        adjacency[edge.b].push(edge.id);
        nodes[edge.a].edges.push(edge.id);
        nodes[edge.b].edges.push(edge.id);
    });
    return {
        nodes,
        edges,
        adjacency,
        bridges: [],
        bridgeTolerance: 12,
        typicalWidth: 1,
        snapTolerance: 1.5,
        pageBounds: { minX: -100, minY: -100, maxX: 200, maxY: 200 }
    };
}

function makeRoute(tagText, tagId, y) {
    const geometry = makeGeometry([[0, y], [100, y]], [[0, 1]]);
    return {
        tagText,
        tagId,
        page: 1,
        edgeIds: [0],
        routeLength: 100,
        baseStatus: 'yes',
        overlaps: [],
        geometry
    };
}

function makeValve(id, centerX, centerY) {
    return {
        id,
        tag: `35-HV-${String(9000 + id)}`,
        tagType: 'valve',
        page: 1,
        pdfRect: { x: centerX - 10, y: centerY - 5, width: 20, height: 10 }
    };
}

test('text boxes use PDF text width once rather than multiplying it by font scale', () => {
    const textBox = tracing.textBoxFromItem({
        str: 'LINE TAG',
        width: 50,
        height: 10,
        transform: [10, 0, 0, 10, 100, 200]
    });

    assert.equal(textBox.bbox.maxX - textBox.bbox.minX, 50);
    assert.equal(textBox.bbox.maxY - textBox.bbox.minY, 10);
});

test('a tee with one clearly aligned main continuation is traced through', () => {
    const geometry = makeGeometry(
        [[0, 0], [50, 0], [100, 0], [50, 45]],
        [[0, 1], [1, 2], [1, 3]]
    );
    const component = tracing.traceContinuation(geometry, geometry.edges[0]);

    assert.deepEqual(Array.from(component.edgeIds).sort(), [0, 1]);
    assert.equal(component.teeJunctions.length, 1);
    assert.equal(component.teeJunctions[0].stopped, false);
    assert.ok(component.decisionRecords.some(record => record.action === 'pass-tee-main'));
});

test('a tee with competing continuations stops for review', () => {
    const geometry = makeGeometry(
        [[50, -50], [50, 0], [0, 0], [100, 0]],
        [[0, 1], [1, 2], [1, 3]]
    );
    const component = tracing.traceContinuation(geometry, geometry.edges[0]);

    assert.deepEqual(Array.from(component.edgeIds), [0]);
    assert.equal(component.teeJunctions[0].stopped, true);
    assert.ok(component.stops.some(stop => stop.reason === 'tee-junction'));
});

test('a straight pipe passes a short diagonal inline-symbol stroke', () => {
    const geometry = makeGeometry(
        [[0, 0], [50, 0], [100, 0], [58, 5.2]],
        [[0, 1], [1, 2], [1, 3]]
    );
    geometry.edges[1].geometryType = 'thin-rectangle-centerline';
    geometry.edges[2].sourceLength = geometry.edges[2].length;
    geometry.edges[2].sourcePathMaxDimension = geometry.edges[2].length;
    const component = tracing.traceContinuation(geometry, geometry.edges[0]);

    assert.deepEqual(Array.from(component.edgeIds).sort(), [0, 1]);
    assert.ok(component.decisionRecords.some(record =>
        record.action === 'pass-tee-main' &&
        record.reason === 'straight pipe continuation past short symbol stroke'));
});

test('a route does not reverse into symbol geometry at a degree-two node', () => {
    const geometry = makeGeometry(
        [[0, 0], [50, 0], [30, 20]],
        [[0, 1], [1, 2]]
    );
    const component = tracing.traceContinuation(geometry, geometry.edges[0]);

    assert.deepEqual(Array.from(component.edgeIds), [0]);
    assert.ok(component.stops.some(stop => stop.reason === 'no-valid-continuation'));
});

test('a different line-tag anchor stops the route before it merges line numbers', () => {
    const geometry = makeGeometry(
        [[0, 0], [50, 0], [100, 0]],
        [[0, 1], [1, 2]]
    );
    const component = tracing.traceContinuation(geometry, geometry.edges[0], {
        lineAnchors: [{
            tagId: 2,
            tagText: '10-2"-HC-BBBB-2222-A',
            edgeId: 1,
            distance: 3
        }]
    });

    assert.deepEqual(Array.from(component.edgeIds), [0]);
    assert.ok(component.stops.some(stop => stop.reason === 'foreign-line-boundary'));
    assert.equal(component.lineBoundaries[0].connectedLineTags[0].tag, '10-2"-HC-BBBB-2222-A');
});

test('a tee stops when a different line tag is found shortly beyond its main continuation', () => {
    const geometry = makeGeometry(
        [[0, 0], [50, 0], [100, 0], [150, 0], [50, 45]],
        [[0, 1], [1, 2], [2, 3], [1, 4]]
    );
    const component = tracing.traceContinuation(geometry, geometry.edges[0], {
        lineAnchors: [{
            tagId: 2,
            tagText: '10-2"-HC-BBBB-2222-A',
            edgeId: 2,
            distance: 3
        }]
    });

    assert.deepEqual(Array.from(component.edgeIds), [0]);
    assert.equal(component.lineBoundaries.length, 1);
    assert.equal(component.lineBoundaries[0].nodeId, 1);
    assert.equal(component.lineBoundaries[0].connectedLineTags[0].tag, '10-2"-HC-BBBB-2222-A');
    assert.ok(component.decisionRecords.some(record => record.action === 'stop-foreign-line-boundary'));
});

test('line seed selection prefers text-aligned pipe geometry over a closer crossing', () => {
    const geometry = makeGeometry(
        [[50, -30], [50, 30], [0, 12], [100, 12]],
        [[0, 1], [2, 3]]
    );
    const seed = tracing.findSeedEdges(geometry, {
        tag: '10-2"-HC-AAAA-1111-A',
        pdfRect: { x: 40, y: -5, width: 20, height: 10, rotation: 0 }
    });

    assert.equal(seed.selected.edge.id, 1);
    assert.equal(seed.selected.alignment, 1);
});

test('vertical line tags use their rotated PDF rectangle when selecting a seed', () => {
    const geometry = makeGeometry(
        [[45, -20], [45, 120], [100, -20], [100, 120]],
        [[0, 1], [2, 3]]
    );
    const seed = tracing.findSeedEdges(geometry, {
        tag: '10-2"-HC-AAAA-1111-A',
        pdfRect: { x: 50, y: 0, width: 100, height: 10, rotation: 90 }
    });

    assert.equal(seed.selected.edge.id, 0);
    assert.equal(seed.selected.alignment, 1);
});

test('a passed tee is accepted only when its side branch has a different line tag', () => {
    const component = {
        teeJunctions: [{
            stopped: false,
            connectedLineTags: [{ tag: '10-2"-HC-BBBB-2222-A' }]
        }],
        crossings: [],
        ambiguousNodes: [],
        routeOverlaps: [],
        stops: [{ reason: 'endpoint' }]
    };

    assert.equal(tracing.traceNeedsReview(component, { tag: '10-2"-HC-AAAA-1111-A' }), false);
    component.teeJunctions[0].connectedLineTags[0].tag = '10-2"-HC-AAAA-1111-A';
    assert.equal(tracing.traceNeedsReview(component, { tag: '10-2"-HC-AAAA-1111-A' }), true);
    component.teeJunctions[0].connectedLineTags = [];
    assert.equal(tracing.traceNeedsReview(component, { tag: '10-2"-HC-AAAA-1111-A' }), true);
});

test('a stopped tee is accepted as a line boundary when a different line tag is proven', () => {
    const component = {
        teeJunctions: [{
            stopped: true,
            connectedLineTags: [{ tag: '10-2"-HC-BBBB-2222-A' }]
        }],
        crossings: [],
        ambiguousNodes: [],
        routeOverlaps: [],
        stops: [{ reason: 'tee-junction' }]
    };

    assert.equal(tracing.traceNeedsReview(component, { tag: '10-2"-HC-AAAA-1111-A' }), false);
});

test('a clearly passed crossing does not force review by itself', () => {
    const component = {
        teeJunctions: [],
        crossings: [{ stopped: false, reason: 'aligned-continuation' }],
        ambiguousNodes: [],
        routeOverlaps: [],
        stops: [{ reason: 'endpoint' }]
    };

    assert.equal(tracing.traceNeedsReview(component, { tag: '10-2"-HC-AAAA-1111-A' }), false);
});

test('a valve is linked once to the uniquely nearest traced line', () => {
    const routes = [
        makeRoute('10-2"-HC-AAAA-1111-A', 1, 0),
        makeRoute('10-2"-HC-BBBB-2222-A', 2, 80)
    ];
    const [association] = tracing.associateValvesAcrossRoutes([makeValve(10, 50, 5)], routes);

    assert.equal(association.status, 'assigned');
    assert.equal(association.lineTag, '10-2"-HC-AAAA-1111-A');
    assert.equal(association.lineOccurrenceId, 1);
    assert.ok(association.confidence > 0.7);
});

test('a valve between two distinct nearby lines is retained for review', () => {
    const routes = [
        makeRoute('10-2"-HC-AAAA-1111-A', 1, 0),
        makeRoute('10-2"-HC-BBBB-2222-A', 2, 10)
    ];
    const [association] = tracing.associateValvesAcrossRoutes([makeValve(11, 50, 5)], routes);

    assert.equal(association.status, 'review');
    assert.equal(association.lineTag, '');
    assert.equal(association.reason, 'multiple-lines-within-association-margin');
    assert.equal(association.candidates.length, 2);
});

test('valve direction rejects a closer perpendicular route', () => {
    const horizontal = makeRoute('10-2"-HC-AAAA-1111-A', 1, 15);
    const verticalGeometry = makeGeometry([[50, -100], [50, 100]], [[0, 1]]);
    const vertical = {
        tagText: '10-2"-HC-BBBB-2222-A',
        tagId: 2,
        page: 1,
        edgeIds: [0],
        routeLength: 200,
        baseStatus: 'yes',
        overlaps: [],
        geometry: verticalGeometry
    };
    const valve = {
        id: 20,
        tag: '10-2"-A1R-9020',
        tagType: 'valve',
        page: 1,
        pdfRect: { x: 40, y: -5, width: 20, height: 10, rotation: 0 }
    };
    const [association] = tracing.associateValvesAcrossRoutes([valve], [vertical, horizontal]);

    assert.equal(association.status, 'assigned');
    assert.equal(association.lineTag, horizontal.tagText);
    assert.equal(association.candidates.find(candidate => candidate.lineTag === vertical.tagText).eligible, false);
});

test('valve nominal size must match the candidate line when both are present', () => {
    const valve = {
        id: 21,
        tag: '10-4"-A1R-9021',
        tagType: 'valve',
        page: 1,
        pdfRect: { x: 40, y: -5, width: 20, height: 10, rotation: 0 }
    };
    const [association] = tracing.associateValvesAcrossRoutes(
        [valve],
        [makeRoute('10-2"-HC-AAAA-1111-A', 1, 0)]
    );

    assert.equal(association.status, 'unassigned');
    assert.equal(association.candidates[0].sizeCompatible, false);
});

test('duplicate occurrences of the same line tag do not create valve ambiguity', () => {
    const routes = [
        makeRoute('10-2"-HC-AAAA-1111-A', 1, 0),
        makeRoute('10-2"-HC-AAAA-1111-A', 2, 2)
    ];
    const [association] = tracing.associateValvesAcrossRoutes([makeValve(12, 50, 3)], routes);

    assert.equal(association.status, 'assigned');
    assert.equal(association.candidates.length, 1);
    assert.deepEqual(Array.from(association.candidates[0].lineOccurrenceIds).sort(), [1, 2]);
});

test('a provisional nearest line remains review until all detected page lines have routes', () => {
    const valve = makeValve(15, 50, 3);
    const detectedTags = [
        valve,
        { id: 1, tag: '10-2"-HC-AAAA-1111-A', tagType: 'line', page: 1 },
        { id: 2, tag: '10-2"-HC-BBBB-2222-A', tagType: 'line', page: 1 }
    ];
    const [association] = tracing.associateValvesAcrossRoutes(
        detectedTags,
        [makeRoute('10-2"-HC-AAAA-1111-A', 1, 0)]
    );

    assert.equal(association.status, 'review');
    assert.equal(association.lineTag, '10-2"-HC-AAAA-1111-A');
    assert.equal(association.pageLineCoverageComplete, false);
    assert.equal(association.reason, 'not-all-detected-lines-on-page-have-a-route');
});

test('every detected valve remains in the register when no line has been traced', () => {
    const valves = [makeValve(13, 20, 20), makeValve(14, 40, 40)];
    const associations = tracing.associateValvesAcrossRoutes(valves, []);

    assert.equal(associations.length, 2);
    assert.ok(associations.every(association => association.status === 'unassigned'));
    assert.ok(associations.every(association => association.reason === 'no-line-route-traced-on-page'));
});

let failures = 0;
for (const entry of tests) {
    try {
        entry.run();
        console.log(`PASS ${entry.name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${entry.name}`);
        console.error(error.stack || error);
    }
}

console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
if (failures) process.exitCode = 1;
