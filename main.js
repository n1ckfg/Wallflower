import * as THREE from 'three';
import { GUI } from 'lil-gui';
import { PictureFrame } from './picture-frame.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 0); // Eye level height

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Room dimensions
const roomWidth = 10;
const roomDepth = 10;
const roomHeight = 6;

// Materials with neutral colors
const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d3d3d,
    roughness: 0.8,
    metalness: 0.1
});

const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9,
    metalness: 0.0
});

const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.9,
    metalness: 0.0
});

// Floor
const floorGeometry = new THREE.PlaneGeometry(roomWidth, roomDepth);
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Ceiling
const ceilingGeometry = new THREE.PlaneGeometry(roomWidth, roomDepth);
const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = roomHeight;
scene.add(ceiling);

// Walls array for raycasting
const walls = [];

function createWall(width, height, x, y, z, rotationY = 0, material = wallMaterial) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(x, y, z);
    wall.rotation.y = rotationY;
    wall.receiveShadow = true;
    scene.add(wall);
    walls.push(wall);
    return wall;
}

// Front wall (north)
createWall(roomWidth, roomHeight, 0, roomHeight / 2, -roomDepth / 2, 0);
// Back wall
createWall(roomWidth, roomHeight, 0, roomHeight / 2, roomDepth / 2, Math.PI);
// Left wall
createWall(roomDepth, roomHeight, -roomWidth / 2, roomHeight / 2, 0, Math.PI / 2);
// Right wall
createWall(roomDepth, roomHeight, roomWidth / 2, roomHeight / 2, 0, -Math.PI / 2);

// Ceiling light fixture
const lightFixtureGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32);
const lightFixtureMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffee,
    emissiveIntensity: 0.5
});
const lightFixture = new THREE.Mesh(lightFixtureGeometry, lightFixtureMaterial);
lightFixture.position.set(0, roomHeight - 0.025, 0);
scene.add(lightFixture);

// Point light (main room light)
const pointLight = new THREE.PointLight(0xfff5e6, 50, 20);
pointLight.position.set(0, roomHeight - 0.1, 0);
pointLight.castShadow = true;
pointLight.shadow.mapSize.width = 1024;
pointLight.shadow.mapSize.height = 1024;
scene.add(pointLight);

// Ambient light for fill
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

// Controls state
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
    shift: false,
    control: false
};

const moveSpeed = 3;

// Orbit controls state
const target = new THREE.Vector3(0, 1, 0); // Point camera orbits around
let spherical = new THREE.Spherical(5, Math.PI / 2, 0); // radius, phi (vertical), theta (horizontal)
let isMouseDown = false;

// Update camera position based on spherical coordinates
function updateCameraFromSpherical() {
    const offset = new THREE.Vector3();
    offset.setFromSpherical(spherical);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
}

// Initialize camera position
updateCameraFromSpherical();

// Mouse controls
let isDraggingFrames = false;
let isDuplicating = false;
let dragStartPositions = new Map();
let dragStartMousePos = null;
let constraintAxis = null;

// Resize controls
let isResizing = false;
let resizeFrame = null;
let resizeCornerIndex = -1;
let resizeStartSize = { width: 0, height: 0 };
const CORNER_TRIGGER_DISTANCE = 0.1;
let cornersHighlighted = false;

function getMouseWorldPosition(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(walls);
    if (intersects.length > 0) {
        return intersects[0].point;
    }
    return null;
}

function checkCornerProximity(event) {
    const worldPos = getMouseWorldPosition(event);
    if (!worldPos) {
        hideAllCornerMarkers();
        return null;
    }

    for (const frame of selectedFrames) {
        const cornerIndex = frame.getCornerIndex(worldPos, CORNER_TRIGGER_DISTANCE);
        if (cornerIndex >= 0) {
            return { frame, cornerIndex };
        }
    }
    return null;
}

function showAllCornerMarkers() {
    if (!cornersHighlighted) {
        for (const frame of selectedFrames) {
            frame.showCornerMarkers(true);
        }
        cornersHighlighted = true;
    }
}

function hideAllCornerMarkers() {
    if (cornersHighlighted) {
        for (const frame of selectedFrames) {
            frame.showCornerMarkers(false);
        }
        cornersHighlighted = false;
    }
}

function snapFrameToNearestWall(frame) {
    // Raycast from room center toward the frame to find the wall it should be on
    const roomCenter = new THREE.Vector3(0, frame.position.y, 0);
    const direction = new THREE.Vector3().subVectors(frame.position, roomCenter).normalize();

    // If direction is mostly vertical, keep current wall
    if (Math.abs(direction.y) > 0.9) return;

    const snapRaycaster = new THREE.Raycaster(roomCenter, direction);
    const intersects = snapRaycaster.intersectObjects(walls);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const wall = hit.object;

        // Get wall normal in world space
        const wallNormal = new THREE.Vector3(0, 0, 1);
        wallNormal.applyQuaternion(wall.quaternion);

        // Project frame position onto wall plane
        const wallPos = wall.position.clone();
        const toFrame = new THREE.Vector3().subVectors(frame.position, wallPos);
        const distToWall = toFrame.dot(wallNormal);

        // Snap to wall surface (slightly in front)
        frame.position.sub(wallNormal.clone().multiplyScalar(distToWall - 0.05));

        // Update frame rotation to match wall
        frame.rotation.copy(wall.rotation);
    }
}

function getFrameUnderMouse(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const frameMeshes = [];
    for (const frame of pictureFrames) {
        frame.traverse((child) => {
            if (child.isMesh) {
                child.userData.parentFrame = frame;
                frameMeshes.push(child);
            }
        });
    }

    const intersects = raycaster.intersectObjects(frameMeshes);
    if (intersects.length > 0) {
        return intersects[0].object.userData.parentFrame;
    }
    return null;
}

document.addEventListener('mousedown', (event) => {
    // Check if clicking near a corner for resize
    if (cornersHighlighted && selectedFrames.size > 0) {
        const cornerHit = checkCornerProximity(event);
        if (cornerHit) {
            isResizing = true;
            resizeFrame = cornerHit.frame;
            resizeCornerIndex = cornerHit.cornerIndex;
            resizeStartSize = { width: resizeFrame.pictureWidth, height: resizeFrame.pictureHeight };
            dragStartMousePos = { x: event.clientX, y: event.clientY };
            resizeFrame.savePriorPosition();
            return;
        }
    }

    const hitFrame = getFrameUnderMouse(event);

    // Check if clicking on a selected frame
    if (hitFrame && selectedFrames.has(hitFrame)) {
        // Mouse is over a selected frame - start frame manipulation
        isDraggingFrames = true;
        isDuplicating = event.altKey;
        dragStartMousePos = { x: event.clientX, y: event.clientY };
        constraintAxis = event.shiftKey ? null : 'none'; // 'none' means no constraint, null means determine later

        if (isDuplicating) {
            // Create duplicates and select them instead
            const newFrames = [];
            for (const frame of selectedFrames) {
                const newFrame = new PictureFrame({
                    width: frame.pictureWidth,
                    height: frame.pictureHeight
                });
                newFrame.position.copy(frame.position);
                newFrame.rotation.copy(frame.rotation);

                // Copy texture if exists (clone to have separate material)
                if (frame.picture.material.map) {
                    const clonedTexture = frame.picture.material.map.clone();
                    clonedTexture.needsUpdate = true;
                    newFrame.setTexture(clonedTexture);
                }

                scene.add(newFrame);
                pictureFrames.push(newFrame);
                newFrames.push(newFrame);
            }
            // Deselect old frames, select new ones
            for (const f of selectedFrames) {
                f.setSelected(false);
            }
            selectedFrames.clear();
            for (const f of newFrames) {
                f.setSelected(true);
                selectedFrames.add(f);
            }
            updateGUIFromSelection();
        }

        // Save prior positions for undo (before movement starts)
        for (const frame of selectedFrames) {
            frame.savePriorPosition();
        }

        // Store start positions
        dragStartPositions.clear();
        for (const frame of selectedFrames) {
            dragStartPositions.set(frame, frame.position.clone());
        }
    } else if (event.altKey || event.shiftKey) {
        // No selected frame under mouse, but modifier held - allow navigation
        isMouseDown = true;
    }
});

document.addEventListener('mouseup', () => {
    isMouseDown = false;
    isDraggingFrames = false;
    isDuplicating = false;
    isResizing = false;
    resizeFrame = null;
    resizeCornerIndex = -1;
    dragStartPositions.clear();
    dragStartMousePos = null;
    constraintAxis = null;
});

document.addEventListener('mousemove', (event) => {
    // Handle resizing
    if (isResizing && resizeFrame && dragStartMousePos) {
        const dx = event.clientX - dragStartMousePos.x;
        const dy = event.clientY - dragStartMousePos.y;

        const resizeScale = 0.005 * spherical.radius;

        // Determine resize direction based on corner index
        // 0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right
        let widthChange = dx * resizeScale;
        let heightChange = -dy * resizeScale;

        // Adjust signs based on which corner is being dragged
        if (resizeCornerIndex === 0 || resizeCornerIndex === 2) {
            widthChange = -widthChange; // Left corners invert width
        }
        if (resizeCornerIndex === 2 || resizeCornerIndex === 3) {
            heightChange = -heightChange; // Bottom corners invert height
        }

        const newWidth = Math.max(0.1, resizeStartSize.width + widthChange);
        const newHeight = Math.max(0.1, resizeStartSize.height + heightChange);

        // Resize the frame
        resizeFrame.resize(newWidth, newHeight);

        // Update the GUI
        updateGUIFromSelection();
        return;
    }

    // Check corner proximity when frames are selected
    if (selectedFrames.size > 0 && !isDraggingFrames && !isResizing) {
        const cornerHit = checkCornerProximity(event);
        if (cornerHit) {
            showAllCornerMarkers();
        } else {
            hideAllCornerMarkers();
        }
    }

    if (isDraggingFrames && dragStartMousePos) {
        // Calculate movement in screen space
        const dx = event.clientX - dragStartMousePos.x;
        const dy = event.clientY - dragStartMousePos.y;

        // Determine constraint axis if shift is held and not yet determined
        if (event.shiftKey && constraintAxis !== 'none' && constraintAxis !== 'x' && constraintAxis !== 'y') {
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                constraintAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
        }

        // Convert screen movement to world movement
        const moveScale = 0.01 * spherical.radius;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());

        let worldDx = dx * moveScale;
        let worldDy = -dy * moveScale;

        // Apply constraint if shift is held and axis is determined
        if (event.shiftKey && (constraintAxis === 'x' || constraintAxis === 'y')) {
            if (constraintAxis === 'x') {
                worldDy = 0;
            } else {
                worldDx = 0;
            }
        }

        for (const frame of selectedFrames) {
            const startPos = dragStartPositions.get(frame);
            if (startPos) {
                frame.position.copy(startPos);
                frame.position.add(right.clone().multiplyScalar(worldDx));
                frame.position.add(up.clone().multiplyScalar(worldDy));

                // Snap to nearest wall if crossing boundaries
                snapFrameToNearestWall(frame);
            }
        }
        return;
    }

    if (!isMouseDown) return;

    const altKey = event.altKey;
    const shiftKey = event.shiftKey;

    if (altKey && shiftKey) {
        // Pan
        const panSpeed = 0.005;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());

        target.add(right.multiplyScalar(-event.movementX * panSpeed * spherical.radius));
        target.add(up.multiplyScalar(event.movementY * panSpeed * spherical.radius));
        updateCameraFromSpherical();
    } else if (altKey) {
        // Orbit
        const orbitSpeed = 0.005;
        spherical.theta -= event.movementX * orbitSpeed;
        spherical.phi -= event.movementY * orbitSpeed;

        // Clamp phi to prevent flipping
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
        updateCameraFromSpherical();
    }
});

document.addEventListener('wheel', (event) => {
    event.preventDefault();
    const zoomSpeed = 0.001;
    spherical.radius *= 1 + event.deltaY * zoomSpeed;
    spherical.radius = Math.max(0.5, Math.min(20, spherical.radius));
    updateCameraFromSpherical();
}, { passive: false });

// Drawing state for PictureFrame creation
const raycaster = new THREE.Raycaster();
const drawingPoints = [];
let isDrawing = false;
let drawingLine = null;
let currentWall = null;

const drawingMaterial = new THREE.LineBasicMaterial({
    color: 0xffaa00
});

const previewMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff
});

// Picture frame tracking and selection
const pictureFrames = [];
const selectedFrames = new Set();

function selectFrame(frame, addToSelection = false) {
    if (!addToSelection) {
        // Deselect all others
        for (const f of selectedFrames) {
            f.setSelected(false);
        }
        selectedFrames.clear();
    }
    if (!selectedFrames.has(frame)) {
        frame.setSelected(true);
        selectedFrames.add(frame);
    }
    updateGUIFromSelection();
}

function deselectFrame(frame) {
    if (selectedFrames.has(frame)) {
        frame.setSelected(false);
        selectedFrames.delete(frame);
    }
    updateGUIFromSelection();
}

function deselectAll() {
    for (const f of selectedFrames) {
        f.setSelected(false);
    }
    selectedFrames.clear();
    updateGUIFromSelection();
}

function toggleFrameSelection(frame, addToSelection = false) {
    if (selectedFrames.has(frame)) {
        deselectFrame(frame);
    } else {
        selectFrame(frame, addToSelection);
    }
}

// lil-gui setup for selected frames
const gui = new GUI({ title: 'Picture Frame' });
gui.domElement.style.display = 'none';

const guiParams = {
    width: 1,
    height: 0.75,
    posX: 0,
    posY: 0
};

// Store offsets from center for each frame
const frameOffsets = new Map();
let selectionCenter = new THREE.Vector3();

function computeSelectionCenter() {
    selectionCenter.set(0, 0, 0);
    if (selectedFrames.size === 0) return;

    for (const frame of selectedFrames) {
        selectionCenter.add(frame.position);
    }
    selectionCenter.divideScalar(selectedFrames.size);

    // Store offsets from center
    frameOffsets.clear();
    for (const frame of selectedFrames) {
        const offset = new THREE.Vector3().subVectors(frame.position, selectionCenter);
        frameOffsets.set(frame, offset);
    }
}

function updateGUIFromSelection() {
    if (selectedFrames.size === 0) {
        gui.domElement.style.display = 'none';
        return;
    }

    gui.domElement.style.display = '';

    // Compute center of all selected frames
    computeSelectionCenter();

    // Get size info from first selected frame
    const firstFrame = selectedFrames.values().next().value;
    guiParams.width = firstFrame.pictureWidth;
    guiParams.height = firstFrame.pictureHeight;

    // Use center position (X and Y only, Z is wall-constrained)
    guiParams.posX = selectionCenter.x;
    guiParams.posY = selectionCenter.y;

    gui.controllersRecursive().forEach(c => c.updateDisplay());
}

function applyGUIToSelection(property) {
    // Calculate new center position (keep Z from current center)
    const newCenter = new THREE.Vector3(guiParams.posX, guiParams.posY, selectionCenter.z);

    for (const frame of selectedFrames) {
        frame.savePriorPosition();

        // Get this frame's offset from the old center
        const offset = frameOffsets.get(frame) || new THREE.Vector3();

        // Apply new center plus offset, keeping frame's original Z offset
        frame.position.x = newCenter.x + offset.x;
        frame.position.y = newCenter.y + offset.y;

        // Snap to wall to maintain wall constraint
        snapFrameToNearestWall(frame);
    }

    // Update center and offsets after snapping
    computeSelectionCenter();
    guiParams.posX = selectionCenter.x;
    guiParams.posY = selectionCenter.y;
}

const posFolder = gui.addFolder('Position');
posFolder.add(guiParams, 'posX', -10, 10, 0.01).name('X').onChange(() => applyGUIToSelection('posX'));
posFolder.add(guiParams, 'posY', 0, 10, 0.01).name('Y').onChange(() => applyGUIToSelection('posY'));

const infoFolder = gui.addFolder('Info');
infoFolder.add(guiParams, 'width').name('Width').disable();
infoFolder.add(guiParams, 'height').name('Height').disable();

function getFrameIntersection(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    // Get all meshes from picture frames
    const frameMeshes = [];
    for (const frame of pictureFrames) {
        frame.traverse((child) => {
            if (child.isMesh) {
                child.userData.parentFrame = frame;
                frameMeshes.push(child);
            }
        });
    }

    const intersects = raycaster.intersectObjects(frameMeshes);
    if (intersects.length > 0) {
        return intersects[0].object.userData.parentFrame;
    }
    return null;
}

function getWallIntersection(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(walls);
    if (intersects.length > 0) {
        return intersects[0];
    }
    return null;
}

function updateDrawingLine() {
    if (drawingLine) {
        scene.remove(drawingLine);
        drawingLine.geometry.dispose();
    }
    if (drawingPoints.length < 2) return;

    const geometry = new THREE.BufferGeometry().setFromPoints(drawingPoints);
    drawingLine = new THREE.Line(geometry, drawingMaterial);
    scene.add(drawingLine);
}

function startDrawing(event) {
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (selectedFrames.size > 0) return;

    const intersection = getWallIntersection(event);
    if (intersection) {
        isDrawing = true;
        currentWall = intersection.object;
        drawingPoints.length = 0;
        // Offset slightly from wall to prevent z-fighting
        const point = intersection.point.clone().add(intersection.face.normal.multiplyScalar(0.01));
        drawingPoints.push(point);
    }
}

function continueDrawing(event) {
    if (!isDrawing) return;
    if (event.altKey || event.shiftKey) {
        // Cancel drawing if modifier pressed
        cancelDrawing();
        return;
    }

    const intersection = getWallIntersection(event);
    if (intersection && intersection.object === currentWall) {
        const point = intersection.point.clone().add(intersection.face.normal.multiplyScalar(0.01));
        drawingPoints.push(point);
        updateDrawingLine();
    }
}

function cancelDrawing() {
    isDrawing = false;
    if (drawingLine) {
        scene.remove(drawingLine);
        drawingLine.geometry.dispose();
        drawingLine = null;
    }
    drawingPoints.length = 0;
    currentWall = null;
}

function finishDrawing() {
    if (!isDrawing || drawingPoints.length < 3) {
        cancelDrawing();
        return;
    }

    isDrawing = false;

    // Close the polygon
    drawingPoints.push(drawingPoints[0].clone());
    updateDrawingLine();

    // Calculate bounding box in wall's local space
    const wallWorldMatrix = currentWall.matrixWorld.clone();
    const wallInverseMatrix = wallWorldMatrix.clone().invert();

    const localPoints = drawingPoints.map(p => p.clone().applyMatrix4(wallInverseMatrix));

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const p of localPoints) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const centerLocal = new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        0.01 // Slightly in front of wall
    );

    // Convert center back to world space
    const centerWorld = centerLocal.clone().applyMatrix4(wallWorldMatrix);

    // Create preview rectangle in local space then transform to world
    const rectPoints = [
        new THREE.Vector3(minX, minY, 0.015),
        new THREE.Vector3(maxX, minY, 0.015),
        new THREE.Vector3(maxX, maxY, 0.015),
        new THREE.Vector3(minX, maxY, 0.015),
        new THREE.Vector3(minX, minY, 0.015)
    ].map(p => p.applyMatrix4(wallWorldMatrix));

    const rectGeometry = new THREE.BufferGeometry().setFromPoints(rectPoints);
    const rectLine = new THREE.Line(rectGeometry, previewMaterial);
    scene.add(rectLine);

    // Create center cross
    const crossSize = Math.min(width, height) * 0.1;
    const crossPoints = [
        // Horizontal line
        new THREE.Vector3(centerLocal.x - crossSize, centerLocal.y, 0.015),
        new THREE.Vector3(centerLocal.x + crossSize, centerLocal.y, 0.015),
    ].map(p => p.applyMatrix4(wallWorldMatrix));

    const crossPoints2 = [
        // Vertical line
        new THREE.Vector3(centerLocal.x, centerLocal.y - crossSize, 0.015),
        new THREE.Vector3(centerLocal.x, centerLocal.y + crossSize, 0.015),
    ].map(p => p.applyMatrix4(wallWorldMatrix));

    const crossGeometry1 = new THREE.BufferGeometry().setFromPoints(crossPoints);
    const crossLine1 = new THREE.Line(crossGeometry1, previewMaterial);
    scene.add(crossLine1);

    const crossGeometry2 = new THREE.BufferGeometry().setFromPoints(crossPoints2);
    const crossLine2 = new THREE.Line(crossGeometry2, previewMaterial);
    scene.add(crossLine2);

    // Flicker effect then create frame
    let flickerCount = 0;
    const flickerInterval = setInterval(() => {
        if (drawingLine) {
            drawingLine.visible = !drawingLine.visible;
        }
        flickerCount++;
        if (flickerCount >= 20) { // 2 seconds at ~10 flickers/sec
            clearInterval(flickerInterval);
            if (drawingLine) {
                scene.remove(drawingLine);
                drawingLine.geometry.dispose();
                drawingLine = null;
            }

            // Remove preview lines
            scene.remove(rectLine);
            rectGeometry.dispose();
            scene.remove(crossLine1);
            crossGeometry1.dispose();
            scene.remove(crossLine2);
            crossGeometry2.dispose();

            // Create PictureFrame
            const frame = new PictureFrame({
                width: width,
                height: height
            });
            frame.position.copy(centerWorld);
            frame.rotation.copy(currentWall.rotation);
            scene.add(frame);
            pictureFrames.push(frame);

            drawingPoints.length = 0;
            currentWall = null;
        }
    }, 100);
}

// Drawing and selection event listeners
let mouseDownPos = null;
let didDrag = false;

renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
        mouseDownPos = { x: event.clientX, y: event.clientY };
        didDrag = false;

        if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            // Check if clicking on a frame first
            const frame = getFrameIntersection(event);
            if (!frame) {
                startDrawing(event);
            }
        }
    }
});

renderer.domElement.addEventListener('click', (event) => {
    if (event.button !== 0 || didDrag) return;
    if (event.altKey) return; // Alt is for orbit

    const frame = getFrameIntersection(event);

    if (frame) {
        if (event.ctrlKey || event.metaKey) {
            // Ctrl-click: remove from selection
            deselectFrame(frame);
        } else if (event.shiftKey) {
            // Shift-click: add to selection
            selectFrame(frame, true);
        } else {
            // Normal click: select (deselect others)
            selectFrame(frame, false);
        }
    } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Clicked on nothing (not a frame), deselect all
        // But only if we weren't drawing
        if (!isDrawing && drawingPoints.length === 0) {
            deselectAll();
        }
    }
});

renderer.domElement.addEventListener('mousemove', (event) => {
    // Track if we're dragging (moved more than 5 pixels)
    if (mouseDownPos) {
        const dx = event.clientX - mouseDownPos.x;
        const dy = event.clientY - mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
            didDrag = true;
        }
    }

    if (isDrawing) {
        continueDrawing(event);
    }
});

renderer.domElement.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
        if (isDrawing) {
            finishDrawing();
        }
        mouseDownPos = null;
    }
});

// Image drag-drop handling
renderer.domElement.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
});

renderer.domElement.addEventListener('drop', (event) => {
    event.preventDefault();

    const files = event.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    // Find which frame was dropped on
    const frame = getFrameIntersection(event);
    if (!frame) return;

    // Load the image
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Create texture from image
            const texture = new THREE.Texture(img);
            texture.needsUpdate = true;
            texture.colorSpace = THREE.SRGBColorSpace;

            // Calculate new frame size preserving area but matching aspect ratio
            const currentArea = frame.pictureWidth * frame.pictureHeight;
            const imageAspect = img.width / img.height;

            // area = width * height, aspect = width / height
            // width = aspect * height, so area = aspect * height^2
            // height = sqrt(area / aspect)
            const newHeight = Math.sqrt(currentArea / imageAspect);
            const newWidth = imageAspect * newHeight;

            // Resize frame and apply texture
            frame.resize(newWidth, newHeight);
            frame.setTexture(texture);

            // Update GUI if this frame is selected
            if (selectedFrames.has(frame)) {
                updateGUIFromSelection();
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

// Keyboard input
document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
    }

    // Delete selected frames
    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedFrames.size > 0) {
            event.preventDefault();
            for (const frame of selectedFrames) {
                scene.remove(frame);
                const index = pictureFrames.indexOf(frame);
                if (index > -1) {
                    pictureFrames.splice(index, 1);
                }
            }
            selectedFrames.clear();
            updateGUIFromSelection();
        }
    }

    // Select all frames
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        for (const frame of pictureFrames) {
            frame.setSelected(true);
            selectedFrames.add(frame);
        }
        updateGUIFromSelection();
    }

    // Undo position for selected frames
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        for (const frame of selectedFrames) {
            if (frame.hasPriorPosition) {
                frame.restorePriorPosition();
            }
        }
    }

    // Arrow key nudging for selected frames
    const nudgeStep = event.shiftKey ? 1.0 : 0.1;
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    if (arrowKeys.includes(event.key) && selectedFrames.size > 0) {
        event.preventDefault();

        // Get camera's right and up vectors for nudge direction
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());

        let nudgeDir = new THREE.Vector3();

        switch (event.key) {
            case 'ArrowUp':
                nudgeDir = up.clone().multiplyScalar(nudgeStep);
                break;
            case 'ArrowDown':
                nudgeDir = up.clone().multiplyScalar(-nudgeStep);
                break;
            case 'ArrowRight':
                nudgeDir = right.clone().multiplyScalar(nudgeStep);
                break;
            case 'ArrowLeft':
                nudgeDir = right.clone().multiplyScalar(-nudgeStep);
                break;
        }

        for (const frame of selectedFrames) {
            frame.savePriorPosition();
            frame.position.add(nudgeDir);
            snapFrameToNearestWall(frame);
        }
    }
});

document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = false;
    }
});

// Window resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Movement update (WASD moves the target/pivot point)
function updateMovement(delta) {
    // Disable movement when ctrl is held
    if (keys.control) return;

    // Get camera's forward and right directions (flattened to XZ plane)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const velocity = new THREE.Vector3();

    if (keys.w) velocity.add(forward);
    if (keys.s) velocity.sub(forward);
    if (keys.d) velocity.add(right);
    if (keys.a) velocity.sub(right);
    if (keys.e) velocity.y += 1;
    if (keys.q) velocity.y -= 1;

    if (velocity.length() > 0) {
        velocity.normalize();
        const speed = keys.shift ? moveSpeed * 2 : moveSpeed;
        velocity.multiplyScalar(speed * delta);
        target.add(velocity);
        updateCameraFromSpherical();
    }
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    updateMovement(delta);

    renderer.render(scene, camera);
}

animate();
