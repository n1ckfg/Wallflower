import * as THREE from 'three';
import { GUI } from 'lil-gui';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PictureFrame } from './picture-frame.js';
import { VideoProjector, VIDEO_SOURCES } from './video-projector.js';
import { loadModelFiles, MODEL_FILE_PATTERN } from './model-loader.js';
import { Recorder } from './recorder.js';
import { Palette } from './palette.js';
import { LevelsShader } from './levels.js';

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

// Post-processing (from gltFpsViewer): the palette's levels pass runs last, after
// OutputPass has encoded the frame to sRGB, so it adjusts display values. Neutral
// levels skip the chain entirely and render straight to the canvas.
const composer = new EffectComposer(renderer);
// The composer's default targets have no MSAA; set before they are first allocated
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;
composer.setPixelRatio(window.devicePixelRatio);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const levelsPass = new ShaderPass(LevelsShader);
composer.addPass(levelsPass);
let useComposer = false;

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

// Drawing on these creates a video projector instead of a picture frame
const projectorSurfaces = [floor, ceiling];
const CEILING_PROJECTOR_DROP = 0.5; // How far a ceiling-mounted projector hangs below the ceiling
const FLOOR_PROJECTOR_HEIGHT = 1.2; // Stand height of a floor-mounted projector
const PROJECTOR_WALL_MARGIN = 0.5; // Closest a projector may get to a wall
const PROJECTOR_MIN_X = -roomWidth / 2 + PROJECTOR_WALL_MARGIN;
const PROJECTOR_MAX_X = roomWidth / 2 - PROJECTOR_WALL_MARGIN;
const PROJECTOR_MIN_Z = -roomDepth / 2 + PROJECTOR_WALL_MARGIN;
const PROJECTOR_MAX_Z = roomDepth / 2 - PROJECTOR_WALL_MARGIN;
const PROJECTOR_MIN_Y = 0.3;
const PROJECTOR_MAX_Y = roomHeight - 0.3;

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
let isDraggingProjector = false;
let projectorDragStartPosition = null;

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
    // Presses on the GUI panels or palette are not aimed at the scene
    if (event.target !== renderer.domElement) return;

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
        constraintAxis = null;

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
                    newFrame.setImageScale(frame.imageScale);
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
    isDraggingProjector = false;
    projectorDragStartPosition = null;
    isDuplicating = false;
    isResizing = false;
    resizeFrame = null;
    resizeCornerIndex = -1;
    dragStartPositions.clear();
    dragStartMousePos = null;
    constraintAxis = null;
    clearAlignmentLines();
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

    // Handle dragging the selected projector along its floor/ceiling
    if (isDraggingProjector && selectedProjector && dragStartMousePos) {
        const dx = event.clientX - dragStartMousePos.x;
        const dy = event.clientY - dragStartMousePos.y;
        const moveScale = 0.01 * spherical.radius;
        const { forward, right } = getCameraGroundAxes();

        selectedProjector.position.copy(projectorDragStartPosition);
        selectedProjector.position.add(right.multiplyScalar(dx * moveScale));
        selectedProjector.position.add(forward.multiplyScalar(-dy * moveScale));
        clampProjectorToRoom(selectedProjector);

        updateProjectorGUI();
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

        // Determine constraint axis dynamically when shift is held
        if (event.shiftKey) {
            // Determine axis based on dominant movement direction
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                constraintAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
        } else {
            // Reset constraint when shift is released
            constraintAxis = null;
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

        // Update alignment guides
        updateAlignmentLines();
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
let currentSurface = null; // Wall, floor or ceiling being drawn on

const drawingMaterial = new THREE.LineBasicMaterial({
    color: 0xffaa00
});

const previewMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff
});

// Picture frame tracking and selection
const pictureFrames = [];
const selectedFrames = new Set();
let lastSelectedFrame = null;

// Video projector tracking and selection (one projector selected at a time,
// never together with frames)
const projectors = [];
let selectedProjector = null;

function addProjector(projector) {
    scene.add(projector);
    // SpotLightHelper follows the light's world matrix, so it lives at the scene root
    scene.add(projector.helper);
    projectors.push(projector);
}

function removeProjector(projector) {
    scene.remove(projector);
    scene.remove(projector.helper);
    projector.dispose();
    const index = projectors.indexOf(projector);
    if (index > -1) {
        projectors.splice(index, 1);
    }
}

// Camera forward/right flattened onto the XZ plane, for moving things across the floor/ceiling
function getCameraGroundAxes() {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return { forward, right };
}

function clampProjectorToRoom(projector) {
    projector.position.x = THREE.MathUtils.clamp(projector.position.x, PROJECTOR_MIN_X, PROJECTOR_MAX_X);
    projector.position.y = THREE.MathUtils.clamp(projector.position.y, PROJECTOR_MIN_Y, PROJECTOR_MAX_Y);
    projector.position.z = THREE.MathUtils.clamp(projector.position.z, PROJECTOR_MIN_Z, PROJECTOR_MAX_Z);
}

// Default aim: the wall the camera is facing, at the wall's vertical center
function getDefaultProjectorAim(from) {
    const { forward } = getCameraGroundAxes();
    const origin = new THREE.Vector3(from.x, roomHeight / 2, from.z);
    const aimRaycaster = new THREE.Raycaster(origin, forward);
    const intersects = aimRaycaster.intersectObjects(walls);
    if (intersects.length > 0) {
        return intersects[0].point;
    }
    return origin.add(forward.multiplyScalar(roomDepth / 2));
}

function createProjectorOnSurface(point, surface) {
    const mount = surface === ceiling ? 'ceiling' : 'floor';
    const projector = new VideoProjector({
        mount: mount,
        surfaceY: surface.position.y
    });
    projector.position.set(
        point.x,
        mount === 'ceiling' ? roomHeight - CEILING_PROJECTOR_DROP : FLOOR_PROJECTOR_HEIGHT,
        point.z
    );
    clampProjectorToRoom(projector);
    projector.aim.copy(getDefaultProjectorAim(projector.position));
    addProjector(projector);
    return projector;
}

// glTF model tracking and selection (one model selected at a time, never together
// with frames or a projector). The selected model gets gltFpsViewer's
// translate/rotate/scale gizmo; keys 1/2/3 switch its mode.
const models = [];
const modelSources = new Map(); // Model -> the dropped files it was loaded from, kept for saving
let selectedModel = null;
let modelSelectionHelper = null;
let modelPriorTransform = null;

const transformControl = new TransformControls(camera, renderer.domElement);
scene.add(transformControl);

// Remember where the model was before each gizmo drag, for Ctrl/Cmd+Z
transformControl.addEventListener('mouseDown', () => {
    if (!transformControl.object) return;
    modelPriorTransform = {
        position: transformControl.object.position.clone(),
        quaternion: transformControl.object.quaternion.clone(),
        scale: transformControl.object.scale.clone()
    };
});

function addModel(model, files) {
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    scene.add(model);
    models.push(model);
    modelSources.set(model, files);
}

function removeModel(model) {
    if (model === selectedModel) {
        deselectModel();
    }
    scene.remove(model);
    model.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
    });
    const index = models.indexOf(model);
    if (index > -1) {
        models.splice(index, 1);
    }
    modelSources.delete(model);
}

// Models keep their authored scale (glTF units are meters) unless they wouldn't fit in the room
function fitModelToRoom(model) {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const fit = Math.min(1, (roomWidth - 1) / size.x, (roomDepth - 1) / size.z, (roomHeight - 0.5) / size.y);
    if (fit < 1) {
        model.scale.multiplyScalar(fit);
    }
}

// Stand the model on the floor, centered on the given point and kept inside the walls
function placeModelOnFloor(model, point) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const halfX = (box.max.x - box.min.x) / 2;
    const halfZ = (box.max.z - box.min.z) / 2;
    const x = THREE.MathUtils.clamp(point.x, -roomWidth / 2 + halfX, roomWidth / 2 - halfX);
    const z = THREE.MathUtils.clamp(point.z, -roomDepth / 2 + halfZ, roomDepth / 2 - halfZ);
    model.position.x += x - center.x;
    model.position.y -= box.min.y;
    model.position.z += z - center.z;
}

function dropModel(files, event) {
    const intersection = getDrawSurfaceIntersection(event);
    const dropPoint = intersection ? intersection.point : new THREE.Vector3();

    loadModelFiles(files).then(({ model, files: usedFiles }) => {
        fitModelToRoom(model);
        placeModelOnFloor(model, dropPoint);
        addModel(model, usedFiles);
        selectModel(model);
    }).catch((err) => {
        console.error('Error loading model:', err);
        alert(err.message || 'Error loading model.');
    });
}

function getModelIntersection(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(models, true);
    if (intersects.length > 0) {
        // Walk up from the mesh hit to the model's root
        let model = intersects[0].object;
        while (model.parent && !models.includes(model)) {
            model = model.parent;
        }
        return models.includes(model) ? model : null;
    }
    return null;
}

function selectModel(model) {
    deselectFrames();
    deselectProjector();
    if (model === selectedModel) return;
    deselectModel();

    selectedModel = model;
    modelPriorTransform = null;
    transformControl.attach(model);
    modelSelectionHelper = new THREE.BoxHelper(model, 0x00ff00);
    scene.add(modelSelectionHelper);
}

function deselectModel() {
    if (modelSelectionHelper) {
        scene.remove(modelSelectionHelper);
        modelSelectionHelper.dispose();
        modelSelectionHelper = null;
    }
    selectedModel = null;
    transformControl.detach();
}

// The gizmo is being hovered or dragged, so pointer input belongs to it
function isUsingGizmo() {
    return transformControl.dragging || transformControl.axis !== null;
}

// Alignment guide lines
const alignmentLineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false });
const alignmentLines = [];
const ALIGNMENT_THRESHOLD = 0.02;

function clearAlignmentLines() {
    for (const line of alignmentLines) {
        scene.remove(line);
        line.geometry.dispose();
    }
    alignmentLines.length = 0;
}

function createAlignmentLine(point1, point2) {
    const geometry = new THREE.BufferGeometry().setFromPoints([point1, point2]);
    const line = new THREE.Line(geometry, alignmentLineMaterial);
    line.renderOrder = 1000;
    scene.add(line);
    alignmentLines.push(line);
}

function getFrameEdges(frame) {
    const fw = frame._frameWidth;
    const halfW = frame.pictureWidth / 2 + fw;
    const halfH = frame.pictureHeight / 2 + fw;

    // Get local edge positions
    const localEdges = {
        top: new THREE.Vector3(0, halfH, 0),
        bottom: new THREE.Vector3(0, -halfH, 0),
        left: new THREE.Vector3(-halfW, 0, 0),
        right: new THREE.Vector3(halfW, 0, 0)
    };

    // Convert to world space
    const worldEdges = {};
    for (const [name, localPos] of Object.entries(localEdges)) {
        const worldPos = localPos.clone();
        frame.localToWorld(worldPos);
        worldEdges[name] = worldPos;
    }

    // Also store the edge values for comparison
    worldEdges.topY = worldEdges.top.y;
    worldEdges.bottomY = worldEdges.bottom.y;
    worldEdges.leftX = worldEdges.left.x;
    worldEdges.rightX = worldEdges.right.x;
    worldEdges.leftZ = worldEdges.left.z;
    worldEdges.rightZ = worldEdges.right.z;

    return worldEdges;
}

function updateAlignmentLines() {
    clearAlignmentLines();

    if (!isDraggingFrames || !lastSelectedFrame || selectedFrames.has(lastSelectedFrame)) {
        return;
    }

    // Check if lastSelectedFrame still exists
    if (!pictureFrames.includes(lastSelectedFrame)) {
        lastSelectedFrame = null;
        return;
    }

    const refEdges = getFrameEdges(lastSelectedFrame);
    const refHalfW = lastSelectedFrame.pictureWidth / 2 + lastSelectedFrame._frameWidth;
    const refHalfH = lastSelectedFrame.pictureHeight / 2 + lastSelectedFrame._frameWidth;

    for (const frame of selectedFrames) {
        const edges = getFrameEdges(frame);
        const halfW = frame.pictureWidth / 2 + frame._frameWidth;
        const halfH = frame.pictureHeight / 2 + frame._frameWidth;

        // Check top-top alignment
        if (Math.abs(edges.topY - refEdges.topY) < ALIGNMENT_THRESHOLD) {
            const p1 = new THREE.Vector3(
                lastSelectedFrame.position.x,
                refEdges.topY,
                lastSelectedFrame.position.z + 0.02
            );
            const p2 = new THREE.Vector3(
                frame.position.x,
                edges.topY,
                frame.position.z + 0.02
            );
            createAlignmentLine(p1, p2);
        }

        // Check bottom-bottom alignment
        if (Math.abs(edges.bottomY - refEdges.bottomY) < ALIGNMENT_THRESHOLD) {
            const p1 = new THREE.Vector3(
                lastSelectedFrame.position.x,
                refEdges.bottomY,
                lastSelectedFrame.position.z + 0.02
            );
            const p2 = new THREE.Vector3(
                frame.position.x,
                edges.bottomY,
                frame.position.z + 0.02
            );
            createAlignmentLine(p1, p2);
        }

        // Check left-left alignment (only for frames on same/parallel walls)
        if (Math.abs(edges.leftX - refEdges.leftX) < ALIGNMENT_THRESHOLD &&
            Math.abs(edges.leftZ - refEdges.leftZ) < 0.5) {
            const p1 = new THREE.Vector3(
                refEdges.leftX,
                lastSelectedFrame.position.y,
                lastSelectedFrame.position.z + 0.02
            );
            const p2 = new THREE.Vector3(
                edges.leftX,
                frame.position.y,
                frame.position.z + 0.02
            );
            createAlignmentLine(p1, p2);
        }

        // Check right-right alignment
        if (Math.abs(edges.rightX - refEdges.rightX) < ALIGNMENT_THRESHOLD &&
            Math.abs(edges.rightZ - refEdges.rightZ) < 0.5) {
            const p1 = new THREE.Vector3(
                refEdges.rightX,
                lastSelectedFrame.position.y,
                lastSelectedFrame.position.z + 0.02
            );
            const p2 = new THREE.Vector3(
                edges.rightX,
                frame.position.y,
                frame.position.z + 0.02
            );
            createAlignmentLine(p1, p2);
        }
    }
}

function selectFrame(frame, addToSelection = false) {
    // Frames are never selected together with a projector or model
    deselectProjector();
    deselectModel();

    // Track the last selected frame before changing selection
    if (selectedFrames.size > 0 && !addToSelection) {
        // Get the first (or only) currently selected frame as the reference
        lastSelectedFrame = selectedFrames.values().next().value;
    }

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
    clearAlignmentLines();
    updateGUIFromSelection();
}

function deselectFrames() {
    for (const f of selectedFrames) {
        f.setSelected(false);
    }
    selectedFrames.clear();
    clearAlignmentLines();
    updateGUIFromSelection();
}

function deselectAll() {
    deselectFrames();
    deselectProjector();
    deselectModel();
}

function selectProjector(projector) {
    // A projector is never selected together with frames or a model
    deselectFrames();
    deselectModel();

    if (selectedProjector && selectedProjector !== projector) {
        selectedProjector.setSelected(false);
    }
    selectedProjector = projector;
    projector.setSelected(true);
    updateProjectorGUI();
}

function deselectProjector() {
    if (selectedProjector) {
        selectedProjector.setSelected(false);
        selectedProjector = null;
    }
    updateProjectorGUI();
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
    posY: 0,
    imageScale: 100
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
    guiParams.imageScale = firstFrame.imageScale * 100;

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

const imageFolder = gui.addFolder('Image');
imageFolder.add(guiParams, 'imageScale', 10, 200, 1).name('Scale %').onChange(() => {
    for (const frame of selectedFrames) {
        frame.setImageScale(guiParams.imageScale / 100);
    }
});

const infoFolder = gui.addFolder('Info');
infoFolder.add(guiParams, 'width').name('Width').disable();
infoFolder.add(guiParams, 'height').name('Height').disable();

// Alignment functions
function getWallInfo(frame) {
    // Determine which wall the frame is on based on rotation
    const rotY = frame.rotation.y;
    const tolerance = 0.1;

    if (Math.abs(rotY) < tolerance) {
        // Front wall (north), facing +Z
        return { axis: 'x', wallCenter: 0, wallSize: roomWidth, wall: 'front' };
    } else if (Math.abs(rotY - Math.PI) < tolerance || Math.abs(rotY + Math.PI) < tolerance) {
        // Back wall (south), facing -Z
        return { axis: 'x', wallCenter: 0, wallSize: roomWidth, wall: 'back' };
    } else if (Math.abs(rotY - Math.PI / 2) < tolerance) {
        // Left wall (west), facing +X
        return { axis: 'z', wallCenter: 0, wallSize: roomDepth, wall: 'left' };
    } else if (Math.abs(rotY + Math.PI / 2) < tolerance) {
        // Right wall (east), facing -X
        return { axis: 'z', wallCenter: 0, wallSize: roomDepth, wall: 'right' };
    }
    return null;
}

function alignHorizontal() {
    if (selectedFrames.size === 0) return;

    const frames = Array.from(selectedFrames);

    // Save prior positions for undo
    for (const frame of frames) {
        frame.savePriorPosition();
    }

    // Get wall info from first frame
    const wallInfo = getWallInfo(frames[0]);
    if (!wallInfo) return;

    const axis = wallInfo.axis; // 'x' or 'z' depending on wall orientation

    if (frames.length === 1) {
        // Single frame: just center horizontally on wall
        frames[0].position[axis] = wallInfo.wallCenter;
    } else {
        // Multiple frames: align Y positions, distribute along axis, then center

        // 1. Align all frames to average Y (horizontal alignment = same Y)
        const avgY = frames.reduce((sum, f) => sum + f.position.y, 0) / frames.length;
        for (const frame of frames) {
            frame.position.y = avgY;
        }

        // 2. Sort frames by their position on the axis
        frames.sort((a, b) => a.position[axis] - b.position[axis]);

        // 3. Calculate total width of all frames
        const totalFrameWidth = frames.reduce((sum, f) => {
            return sum + f.pictureWidth + f._frameWidth * 2;
        }, 0);

        // 4. Calculate even spacing
        const availableSpace = wallInfo.wallSize * 0.9; // Use 90% of wall
        const gap = (availableSpace - totalFrameWidth) / (frames.length + 1);

        // 5. Distribute frames evenly
        let currentPos = wallInfo.wallCenter - availableSpace / 2 + gap;
        for (const frame of frames) {
            const frameHalfWidth = (frame.pictureWidth + frame._frameWidth * 2) / 2;
            frame.position[axis] = currentPos + frameHalfWidth;
            currentPos += frameHalfWidth * 2 + gap;
        }

        // 6. Center the group on the wall
        const groupMin = frames[0].position[axis] - (frames[0].pictureWidth + frames[0]._frameWidth * 2) / 2;
        const lastFrame = frames[frames.length - 1];
        const groupMax = lastFrame.position[axis] + (lastFrame.pictureWidth + lastFrame._frameWidth * 2) / 2;
        const groupCenter = (groupMin + groupMax) / 2;
        const offset = wallInfo.wallCenter - groupCenter;

        for (const frame of frames) {
            frame.position[axis] += offset;
        }
    }

    updateGUIFromSelection();

    // Restore keyboard focus
    if (document.activeElement) {
        document.activeElement.blur();
    }
}

function alignVertical() {
    if (selectedFrames.size === 0) return;

    const frames = Array.from(selectedFrames);

    // Save prior positions for undo
    for (const frame of frames) {
        frame.savePriorPosition();
    }

    // Get wall info from first frame
    const wallInfo = getWallInfo(frames[0]);
    if (!wallInfo) return;

    const axis = wallInfo.axis; // 'x' or 'z' depending on wall orientation
    const wallVerticalCenter = roomHeight / 2;

    if (frames.length === 1) {
        // Single frame: just center vertically on wall
        frames[0].position.y = wallVerticalCenter;
    } else {
        // Multiple frames: align on axis positions, distribute along Y, then center

        // 1. Align all frames to average axis position (vertical alignment = same X or Z)
        const avgAxis = frames.reduce((sum, f) => sum + f.position[axis], 0) / frames.length;
        for (const frame of frames) {
            frame.position[axis] = avgAxis;
        }

        // 2. Sort frames by their Y position (top to bottom)
        frames.sort((a, b) => b.position.y - a.position.y);

        // 3. Calculate total height of all frames
        const totalFrameHeight = frames.reduce((sum, f) => {
            return sum + f.pictureHeight + f._frameWidth * 2;
        }, 0);

        // 4. Calculate even spacing
        const availableSpace = roomHeight * 0.85; // Use 85% of wall height
        const gap = (availableSpace - totalFrameHeight) / (frames.length + 1);

        // 5. Distribute frames evenly from top
        let currentPos = wallVerticalCenter + availableSpace / 2 - gap;
        for (const frame of frames) {
            const frameHalfHeight = (frame.pictureHeight + frame._frameWidth * 2) / 2;
            frame.position.y = currentPos - frameHalfHeight;
            currentPos -= frameHalfHeight * 2 + gap;
        }

        // 6. Center the group vertically on the wall
        const groupMax = frames[0].position.y + (frames[0].pictureHeight + frames[0]._frameWidth * 2) / 2;
        const lastFrame = frames[frames.length - 1];
        const groupMin = lastFrame.position.y - (lastFrame.pictureHeight + lastFrame._frameWidth * 2) / 2;
        const groupCenter = (groupMin + groupMax) / 2;
        const offset = wallVerticalCenter - groupCenter;

        for (const frame of frames) {
            frame.position.y += offset;
        }
    }

    updateGUIFromSelection();

    // Restore keyboard focus
    if (document.activeElement) {
        document.activeElement.blur();
    }
}

const alignFolder = gui.addFolder('Align');
alignFolder.add({ alignHorizontal }, 'alignHorizontal').name('Align Horizontal');
alignFolder.add({ alignVertical }, 'alignVertical').name('Align Vertical');

const fileFolder = gui.addFolder('File');
fileFolder.add({ save: saveGallery }, 'save').name('Save Gallery');
fileFolder.add({ load: openFileDialog }, 'load').name('Load Gallery');

// lil-gui setup for the selected projector
const projectorGui = new GUI({ title: 'Projector' });
projectorGui.domElement.style.display = 'none';

const projectorParams = {
    content: VIDEO_SOURCES[0],
    intensity: 150,
    sweep: false,
    showBeam: true,
    helper: false,
    posX: 0,
    posZ: 0,
    height: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 0,
    mount: '',
    movie: ''
};

function updateProjectorGUI() {
    if (!selectedProjector) {
        projectorGui.domElement.style.display = 'none';
        return;
    }

    projectorGui.domElement.style.display = '';

    projectorParams.content = selectedProjector.content;
    projectorParams.intensity = selectedProjector.intensity;
    projectorParams.sweep = selectedProjector.sweep;
    projectorParams.showBeam = selectedProjector.showBeam;
    projectorParams.helper = selectedProjector.showHelper;
    projectorParams.posX = selectedProjector.position.x;
    projectorParams.posZ = selectedProjector.position.z;
    projectorParams.height = selectedProjector.position.y;
    projectorParams.aimX = selectedProjector.aim.x;
    projectorParams.aimY = selectedProjector.aim.y;
    projectorParams.aimZ = selectedProjector.aim.z;
    projectorParams.mount = selectedProjector.mount;
    projectorParams.movie = selectedProjector.videoName || 'none (drop an .mp4)';

    projectorGui.controllersRecursive().forEach(c => c.updateDisplay());
}

function applyGUIToProjector() {
    if (!selectedProjector) return;
    selectedProjector.savePriorPosition();
    selectedProjector.position.set(projectorParams.posX, projectorParams.height, projectorParams.posZ);
    clampProjectorToRoom(selectedProjector);
    selectedProjector.aim.set(projectorParams.aimX, projectorParams.aimY, projectorParams.aimZ);
}

projectorGui.add(projectorParams, 'content', VIDEO_SOURCES).name('video source').onChange(v => {
    if (selectedProjector) selectedProjector.content = v;
});
projectorGui.add(projectorParams, 'intensity', 0, 800).onChange(v => {
    if (selectedProjector) selectedProjector.intensity = v;
});
projectorGui.add(projectorParams, 'sweep').name('pan projector').onChange(v => {
    if (selectedProjector) selectedProjector.sweep = v;
});
projectorGui.add(projectorParams, 'showBeam').name('show beam cone').onChange(v => {
    if (selectedProjector) selectedProjector.showBeam = v;
});
projectorGui.add(projectorParams, 'helper').name('light helper').onChange(v => {
    if (selectedProjector) selectedProjector.showHelper = v;
});

const projectorPosFolder = projectorGui.addFolder('Position');
projectorPosFolder.add(projectorParams, 'posX', PROJECTOR_MIN_X, PROJECTOR_MAX_X, 0.01).name('X').onChange(applyGUIToProjector);
projectorPosFolder.add(projectorParams, 'posZ', PROJECTOR_MIN_Z, PROJECTOR_MAX_Z, 0.01).name('Z').onChange(applyGUIToProjector);
projectorPosFolder.add(projectorParams, 'height', PROJECTOR_MIN_Y, PROJECTOR_MAX_Y, 0.01).name('Height').onChange(applyGUIToProjector);

const projectorAimFolder = projectorGui.addFolder('Aim');
projectorAimFolder.add(projectorParams, 'aimX', -roomWidth / 2, roomWidth / 2, 0.01).name('X').onChange(applyGUIToProjector);
projectorAimFolder.add(projectorParams, 'aimY', 0, roomHeight, 0.01).name('Y').onChange(applyGUIToProjector);
projectorAimFolder.add(projectorParams, 'aimZ', -roomDepth / 2, roomDepth / 2, 0.01).name('Z').onChange(applyGUIToProjector);

const projectorInfoFolder = projectorGui.addFolder('Info');
projectorInfoFolder.add(projectorParams, 'mount').name('Mount').disable();
projectorInfoFolder.add(projectorParams, 'movie').name('Movie').disable();

const projectorFileFolder = projectorGui.addFolder('File');
projectorFileFolder.add({ save: saveGallery }, 'save').name('Save Gallery');
projectorFileFolder.add({ load: openFileDialog }, 'load').name('Load Gallery');

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

function getProjectorIntersection(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const projectorMeshes = projectors.flatMap(p => p.pickMeshes);
    const intersects = raycaster.intersectObjects(projectorMeshes);
    if (intersects.length > 0) {
        return intersects[0].object.userData.parentProjector;
    }
    return null;
}

// Walls (for picture frames) plus floor and ceiling (for projectors)
function getDrawSurfaceIntersection(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([...walls, ...projectorSurfaces]);
    if (intersects.length > 0) {
        return intersects[0];
    }
    return null;
}

// Hit point offset slightly off the surface (along its world-space normal) to prevent z-fighting
function getDrawPoint(intersection) {
    const normal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld);
    return intersection.point.clone().add(normal.multiplyScalar(0.01));
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
    if (selectedFrames.size > 0 || selectedProjector || selectedModel) return;

    const intersection = getDrawSurfaceIntersection(event);
    if (intersection) {
        isDrawing = true;
        currentSurface = intersection.object;
        drawingPoints.length = 0;
        drawingPoints.push(getDrawPoint(intersection));
    }
}

function continueDrawing(event) {
    if (!isDrawing) return;
    if (event.altKey || event.shiftKey) {
        // Cancel drawing if modifier pressed
        cancelDrawing();
        return;
    }

    const intersection = getDrawSurfaceIntersection(event);
    if (intersection && intersection.object === currentSurface) {
        drawingPoints.push(getDrawPoint(intersection));
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
    currentSurface = null;
}

function finishDrawing() {
    if (!isDrawing || drawingPoints.length < 3) {
        cancelDrawing();
        return;
    }

    isDrawing = false;

    // Keep hold of the surface; a new stroke may start during the flicker below
    const surface = currentSurface;

    // Close the polygon
    drawingPoints.push(drawingPoints[0].clone());
    updateDrawingLine();

    // Calculate bounding box in the surface's local space
    const wallWorldMatrix = surface.matrixWorld.clone();
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

            if (projectorSurfaces.includes(surface)) {
                // Floor/ceiling: create a VideoProjector mounted at the drawn spot
                createProjectorOnSurface(centerWorld, surface);
            } else {
                // Wall: create a PictureFrame
                const frame = new PictureFrame({
                    width: width,
                    height: height
                });
                frame.position.copy(centerWorld);
                frame.rotation.copy(surface.rotation);
                scene.add(frame);
                pictureFrames.push(frame);
            }

            drawingPoints.length = 0;
            currentSurface = null;
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

        if (isUsingGizmo()) return;

        if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            // Pressing on the selected projector starts dragging it; any projector blocks drawing
            const projector = getProjectorIntersection(event);
            if (projector) {
                if (projector === selectedProjector) {
                    isDraggingProjector = true;
                    dragStartMousePos = { x: event.clientX, y: event.clientY };
                    projectorDragStartPosition = projector.position.clone();
                    projector.savePriorPosition();
                }
                return;
            }

            // Pressing on a model never starts a drawing on the surface behind it
            if (getModelIntersection(event)) return;

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
    if (isUsingGizmo()) return; // A click on a gizmo handle keeps the model selected

    // Projectors are checked first: they hang/stand in the room, in front of the walls' frames
    const projector = getProjectorIntersection(event);
    if (projector) {
        if (event.ctrlKey || event.metaKey) {
            // Ctrl-click: deselect
            if (projector === selectedProjector) {
                deselectProjector();
            }
        } else {
            selectProjector(projector);
        }
        return;
    }

    // Then models, which stand in the room in front of the walls
    const model = getModelIntersection(event);
    if (model) {
        if (event.ctrlKey || event.metaKey) {
            // Ctrl-click: deselect
            if (model === selectedModel) {
                deselectModel();
            }
        } else {
            selectModel(model);
        }
        return;
    }

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

// Keep files dropped outside the 3D view (e.g. on a GUI panel) from navigating away from the gallery
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

// Model/image/movie drag-drop handling
renderer.domElement.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
});

renderer.domElement.addEventListener('drop', (event) => {
    event.preventDefault();

    const files = event.dataTransfer.files;
    if (files.length === 0) return;

    // glTF models (dropped along with any .bin/texture files they use) stand on the floor where dropped
    if (Array.from(files).some(f => MODEL_FILE_PATTERN.test(f.name))) {
        dropModel(Array.from(files), event);
        return;
    }

    const file = files[0];

    // Movies go to the projector dropped on, or else the selected projector
    if (file.type.startsWith('video/')) {
        const projector = getProjectorIntersection(event) || selectedProjector;
        if (!projector) return;

        projector.setVideo(file, file.name).catch((err) => {
            console.error('Error loading movie:', err);
            alert(`Could not play ${file.name}`);
            if (projector === selectedProjector) {
                updateProjectorGUI();
            }
        });
        projector.content = 'Movie';

        if (projector === selectedProjector) {
            updateProjectorGUI();
        }
        return;
    }

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

// Save/Load gallery functions
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function saveGallery() {
    const data = {
        version: 1,
        camera: {
            target: {
                x: target.x,
                y: target.y,
                z: target.z
            },
            spherical: {
                radius: spherical.radius,
                phi: spherical.phi,
                theta: spherical.theta
            }
        },
        display: {
            light: palette.light,
            levels: { ...palette.levels }
        },
        frames: [],
        projectors: [],
        models: []
    };

    for (const frame of pictureFrames) {
        const frameData = {
            width: frame.pictureWidth,
            height: frame.pictureHeight,
            position: {
                x: frame.position.x,
                y: frame.position.y,
                z: frame.position.z
            },
            rotation: {
                x: frame.rotation.x,
                y: frame.rotation.y,
                z: frame.rotation.z
            },
            texture: null,
            imageScale: frame.imageScale
        };

        // Convert texture to base64 if exists
        if (frame.picture.material.map) {
            const canvas = document.createElement('canvas');
            const image = frame.picture.material.map.image;
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            frameData.texture = canvas.toDataURL('image/png');
        }

        data.frames.push(frameData);
    }

    // Movies and model files are read asynchronously, so they're collected and awaited below
    const fileConversions = [];

    for (const projector of projectors) {
        const projectorData = {
            mount: projector.mount,
            position: {
                x: projector.position.x,
                y: projector.position.y,
                z: projector.position.z
            },
            aim: {
                x: projector.aim.x,
                y: projector.aim.y,
                z: projector.aim.z
            },
            content: projector.content,
            intensity: projector.intensity,
            sweep: projector.sweep,
            showBeam: projector.showBeam,
            video: null,
            videoName: projector.videoName
        };

        // Convert movie to base64 if exists
        if (projector.videoBlob) {
            fileConversions.push(
                blobToDataURL(projector.videoBlob).then((dataURL) => {
                    projectorData.video = dataURL;
                })
            );
        }

        data.projectors.push(projectorData);
    }

    for (const model of models) {
        const modelData = {
            position: {
                x: model.position.x,
                y: model.position.y,
                z: model.position.z
            },
            rotation: {
                x: model.rotation.x,
                y: model.rotation.y,
                z: model.rotation.z
            },
            scale: {
                x: model.scale.x,
                y: model.scale.y,
                z: model.scale.z
            },
            files: []
        };

        // Embed the dropped files (.gltf/.glb plus any .bin/textures) as base64
        for (const file of modelSources.get(model)) {
            const fileData = { name: file.name, data: null };
            fileConversions.push(
                blobToDataURL(file).then((dataURL) => {
                    fileData.data = dataURL;
                })
            );
            modelData.files.push(fileData);
        }

        data.models.push(modelData);
    }

    try {
        await Promise.all(fileConversions);

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `gallery_${timestamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error saving gallery:', err);
        alert('Error saving gallery');
    }

    // Restore keyboard focus
    if (document.activeElement) {
        document.activeElement.blur();
    }
}

// Lets async model loads tell whether another gallery was loaded while they were in flight
let galleryLoadCount = 0;

// Light colour and levels, saved by galleries that have them; older files get the defaults
function applyDisplayState(display) {
    if (!display || typeof display !== 'object') {
        palette.reset();
        return;
    }
    if (typeof display.light === 'string' && /^#[0-9a-f]{6}$/i.test(display.light)) {
        palette.setLight(display.light.toLowerCase());
    }
    if (display.levels && typeof display.levels === 'object') {
        const levels = {};
        for (const key of ['blackPoint', 'whitePoint', 'gamma']) {
            if (Number.isFinite(display.levels[key])) levels[key] = display.levels[key];
        }
        palette.setLevels(levels);
    }
}

function loadGallery(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const loadCount = ++galleryLoadCount;

            // Clear existing frames
            for (const frame of pictureFrames) {
                scene.remove(frame);
            }
            pictureFrames.length = 0;
            selectedFrames.clear();
            updateGUIFromSelection();

            // Clear existing projectors
            for (const projector of [...projectors]) {
                removeProjector(projector);
            }
            selectedProjector = null;
            updateProjectorGUI();

            // Clear existing models
            for (const model of [...models]) {
                removeModel(model);
            }

            applyDisplayState(data.display);

            // Restore camera if saved
            if (data.camera) {
                if (data.camera.target) {
                    target.set(
                        data.camera.target.x,
                        data.camera.target.y,
                        data.camera.target.z
                    );
                }
                if (data.camera.spherical) {
                    spherical.radius = data.camera.spherical.radius;
                    spherical.phi = data.camera.spherical.phi;
                    spherical.theta = data.camera.spherical.theta;
                }
                updateCameraFromSpherical();
            }

            // Load frames
            for (const frameData of data.frames) {
                const frame = new PictureFrame({
                    width: frameData.width,
                    height: frameData.height
                });

                frame.position.set(
                    frameData.position.x,
                    frameData.position.y,
                    frameData.position.z
                );
                frame.rotation.set(
                    frameData.rotation.x,
                    frameData.rotation.y,
                    frameData.rotation.z
                );

                // Load texture if exists
                if (frameData.texture) {
                    const img = new Image();
                    img.onload = () => {
                        const texture = new THREE.Texture(img);
                        texture.needsUpdate = true;
                        texture.colorSpace = THREE.SRGBColorSpace;
                        frame.setTexture(texture);
                        if (frameData.imageScale !== undefined) {
                            frame.setImageScale(frameData.imageScale);
                        }
                    };
                    img.src = frameData.texture;
                }

                scene.add(frame);
                pictureFrames.push(frame);
            }

            // Load projectors (absent in galleries saved before projectors existed)
            for (const projectorData of data.projectors || []) {
                const projector = new VideoProjector({
                    mount: projectorData.mount,
                    surfaceY: projectorData.mount === 'ceiling' ? roomHeight : 0,
                    aim: new THREE.Vector3(projectorData.aim.x, projectorData.aim.y, projectorData.aim.z),
                    content: projectorData.content,
                    intensity: projectorData.intensity,
                    sweep: projectorData.sweep,
                    showBeam: projectorData.showBeam
                });
                projector.position.set(
                    projectorData.position.x,
                    projectorData.position.y,
                    projectorData.position.z
                );

                // Load movie if exists
                if (projectorData.video) {
                    fetch(projectorData.video)
                        .then((response) => response.blob())
                        .then((blob) => {
                            // Skip if another gallery was loaded in the meantime
                            if (!projectors.includes(projector)) return;
                            const loaded = projector.setVideo(blob, projectorData.videoName || 'movie');
                            if (projector === selectedProjector) {
                                updateProjectorGUI();
                            }
                            return loaded;
                        })
                        .catch((err) => console.error('Error loading projector movie:', err));
                }

                addProjector(projector);
            }

            // Load models (absent in galleries saved before models existed)
            for (const modelData of data.models || []) {
                Promise.all(modelData.files.map(fileData =>
                    fetch(fileData.data)
                        .then((response) => response.blob())
                        .then((blob) => new File([blob], fileData.name, { type: blob.type }))
                ))
                    .then((files) => loadModelFiles(files))
                    .then(({ model, files }) => {
                        // Skip if another gallery was loaded in the meantime
                        if (loadCount !== galleryLoadCount) return;
                        model.position.set(modelData.position.x, modelData.position.y, modelData.position.z);
                        model.rotation.set(modelData.rotation.x, modelData.rotation.y, modelData.rotation.z);
                        model.scale.set(modelData.scale.x, modelData.scale.y, modelData.scale.z);
                        addModel(model, files);
                    })
                    .catch((err) => console.error('Error loading model:', err));
            }

            // Restore keyboard focus
            if (document.activeElement) {
                document.activeElement.blur();
            }
        } catch (err) {
            console.error('Error loading gallery:', err);
            alert('Error loading gallery file');
        }
    };
    reader.readAsText(file);
}

function openFileDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            loadGallery(file);
        }
    };
    input.click();
}

// Keys typed into a text field or dropdown (GUI number inputs, the video source menu)
// belong to that control, not the scene
function isEditingControl(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
    return target.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(target.type);
}

// Keyboard input
document.addEventListener('keydown', (event) => {
    if (isEditingControl(event.target)) return;

    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
    }

    // Capture and display hotkeys (from gltFpsViewer), ignored when combined with Ctrl/Cmd
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.code === 'Escape' && palette.isOpen) {
            palette.close();
            return;
        }

        // R toggles recording (3-second countdown first; R during it cancels)
        if (event.code === 'KeyR') {
            if (!event.repeat) recorder.toggle();
            return;
        }

        // Space takes a photo. The canvas is only readable right after a render,
        // so the capture itself happens in animate().
        if (event.code === 'Space') {
            event.preventDefault();
            // A focused GUI button or checkbox would otherwise be pressed on keyup
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
            if (!event.repeat) photoRequested = true;
            return;
        }

        if (event.code === 'KeyC') {
            palette.toggle();
            return;
        }

        // 1/2/3 switch the model gizmo between translate, rotate and scale
        if (event.code === 'Digit1') transformControl.setMode('translate');
        if (event.code === 'Digit2') transformControl.setMode('rotate');
        if (event.code === 'Digit3') transformControl.setMode('scale');
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
                // Clear lastSelectedFrame if it was deleted
                if (frame === lastSelectedFrame) {
                    lastSelectedFrame = null;
                }
            }
            selectedFrames.clear();
            clearAlignmentLines();
            updateGUIFromSelection();
        }
        if (selectedProjector) {
            event.preventDefault();
            removeProjector(selectedProjector);
            selectedProjector = null;
            updateProjectorGUI();
        }
        if (selectedModel) {
            event.preventDefault();
            removeModel(selectedModel);
        }
    }

    // Select all frames
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        // If all frames are already selected, deselect all
        if (selectedFrames.size === pictureFrames.length && pictureFrames.length > 0) {
            deselectAll();
        } else {
            deselectProjector();
            deselectModel();
            for (const frame of pictureFrames) {
                frame.setSelected(true);
                selectedFrames.add(frame);
            }
            updateGUIFromSelection();
        }
    }

    // Undo position for selected frames
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        for (const frame of selectedFrames) {
            if (frame.hasPriorPosition) {
                frame.restorePriorPosition();
            }
        }
        if (selectedProjector && selectedProjector.hasPriorPosition) {
            selectedProjector.restorePriorPosition();
            updateProjectorGUI();
        }
        // Model: swap back to the transform from before the last gizmo drag
        if (selectedModel && modelPriorTransform) {
            const current = {
                position: selectedModel.position.clone(),
                quaternion: selectedModel.quaternion.clone(),
                scale: selectedModel.scale.clone()
            };
            selectedModel.position.copy(modelPriorTransform.position);
            selectedModel.quaternion.copy(modelPriorTransform.quaternion);
            selectedModel.scale.copy(modelPriorTransform.scale);
            modelPriorTransform = current;
        }
    }

    // Save gallery
    if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        saveGallery();
    }

    // Open gallery
    if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault();
        openFileDialog();
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

    // Arrow key nudging for the selected projector, across its floor/ceiling
    if (arrowKeys.includes(event.key) && selectedProjector) {
        event.preventDefault();

        const { forward, right } = getCameraGroundAxes();
        let nudgeDir = new THREE.Vector3();

        switch (event.key) {
            case 'ArrowUp':
                nudgeDir = forward.multiplyScalar(nudgeStep);
                break;
            case 'ArrowDown':
                nudgeDir = forward.multiplyScalar(-nudgeStep);
                break;
            case 'ArrowRight':
                nudgeDir = right.multiplyScalar(nudgeStep);
                break;
            case 'ArrowLeft':
                nudgeDir = right.multiplyScalar(-nudgeStep);
                break;
        }

        selectedProjector.savePriorPosition();
        selectedProjector.position.add(nudgeDir);
        clampProjectorToRoom(selectedProjector);
        updateProjectorGUI();
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
    composer.setSize(window.innerWidth, window.innerHeight);
    applyCaptureRenderScale();
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

// Light colour & levels palette, photos and video recording (from gltFpsViewer)

const palette = new Palette({
    onLightChange: setLightColor,
    onLevelsChange: setLevels
});

// The palette sets the room light (and its fixture's glow) rather than the background
function setLightColor(hex) {
    pointLight.color.set(hex);
    lightFixtureMaterial.emissive.set(hex);
}

function setLevels(levels) {
    levelsPass.uniforms['blackPoint'].value = levels.blackPoint;
    levelsPass.uniforms['whitePoint'].value = levels.whitePoint;
    levelsPass.uniforms['gamma'].value = levels.gamma;

    // Neutral levels are a pass-through, so skip the composer and draw straight to the canvas
    useComposer = levels.blackPoint !== 0 || levels.whitePoint !== 1 || levels.gamma !== 1;
}

function renderFrame() {
    if (useComposer) composer.render();
    else renderer.render(scene, camera);
}

// While a take is armed or running, render at the resolution the video is encoded
// at instead of the display's full device pixel ratio: far fewer pixels are drawn,
// and the recorder can capture the WebGL canvas directly instead of copying it.
const MATCH_RENDER_SCALE_TO_CAPTURE = true;
let currentPixelRatio = window.devicePixelRatio;

const countdownEl = document.getElementById('countdown');
const recIndicatorEl = document.getElementById('rec-indicator');
const recTimeEl = document.getElementById('rec-time');
const flashEl = document.getElementById('flash');
let recTimeLabel = '';
let photoRequested = false;

const recorder = new Recorder(renderer.domElement, {
    onStateChange: onRecorderStateChange
});
updateRecorderHud(recorder.state);

function onRecorderStateChange(state) {
    updateRecorderHud(state);
    applyCaptureRenderScale();
}

function applyCaptureRenderScale() {
    const capturing = MATCH_RENDER_SCALE_TO_CAPTURE && recorder.state !== 'idle';

    const ratio = capturing
        ? Math.min(window.devicePixelRatio,
                   recorder.maxWidth / window.innerWidth,
                   recorder.maxHeight / window.innerHeight)
        : window.devicePixelRatio;

    if (ratio === currentPixelRatio) return;
    currentPixelRatio = ratio;

    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function updateRecorderHud(state) {
    const countingDown = state === 'countdown';
    const recording = state === 'recording';

    countdownEl.style.display = countingDown ? 'block' : 'none';
    recIndicatorEl.style.display = recording ? 'flex' : 'none';

    if (countingDown) countdownEl.textContent = recorder.countdownRemaining;
    if (recording) {
        recTimeLabel = formatDuration(0);
        recTimeEl.textContent = recTimeLabel;
    }
}

function formatDuration(seconds) {
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Hide everything that is editing UI rather than gallery content (selection
// highlights, the model gizmo, resize markers, guides, light helpers) so photos
// and recordings show only the gallery. Returns a function that puts it back.
function hideViewerChrome() {
    const hidden = [];
    const hide = (object) => {
        if (object && object.visible) {
            object.visible = false;
            hidden.push(object);
        }
    };

    for (const frame of selectedFrames) {
        frame.setSelected(false);
        if (cornersHighlighted) frame.showCornerMarkers(false);
    }
    if (selectedProjector) selectedProjector.setSelected(false);
    hide(transformControl);
    hide(modelSelectionHelper);
    hide(drawingLine);
    alignmentLines.forEach(hide);
    projectors.forEach(p => hide(p.helper));

    return () => {
        hidden.forEach(object => { object.visible = true; });
        for (const frame of selectedFrames) {
            frame.setSelected(true);
            if (cornersHighlighted) frame.showCornerMarkers(true);
        }
        if (selectedProjector) selectedProjector.setSelected(true);
    };
}

// Save the frame that was just rendered as a PNG. Must run straight after the
// render: without preserveDrawingBuffer the canvas is only readable until the
// browser composites it. The flash is DOM over the canvas, so it never reaches
// the image (or a video being recorded at the same time).
function takePhoto() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // toBlob copies the pixels synchronously; only the PNG encode is deferred
    renderer.domElement.toBlob((blob) => {
        if (!blob) {
            console.error('Failed to capture photo');
            return;
        }
        downloadBlob(blob, `photo_${timestamp}.png`);
    }, 'image/png');

    flashEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    updateMovement(delta);

    for (const projector of projectors) {
        projector.update(clock.elapsedTime);
    }

    // Follow the model through gizmo edits
    if (modelSelectionHelper) modelSelectionHelper.update();

    // A photo gets a frame of its own with the editing UI hidden. The normal
    // render below then overwrites it, so nothing blinks off on screen.
    if (photoRequested) {
        photoRequested = false;
        const restoreChrome = hideViewerChrome();
        renderFrame();
        takePhoto();
        restoreChrome();
    }

    // Recordings never show the editing UI either; it is hidden for the render the
    // recorder captures and restored straight after, so selection state is kept
    const restoreChrome = recorder.isRecording() ? hideViewerChrome() : null;
    renderFrame();
    recorder.update();
    if (restoreChrome) restoreChrome();

    if (recorder.isRecording()) {
        const elapsed = formatDuration(recorder.elapsedSeconds);
        // Only touch the DOM when the displayed value actually changes
        if (elapsed !== recTimeLabel) {
            recTimeLabel = elapsed;
            recTimeEl.textContent = elapsed;
        }
    }
}

animate();
