import * as THREE from 'three';
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
    shift: false
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
document.addEventListener('mousedown', (event) => {
    if (event.altKey) {
        isMouseDown = true;
    }
});

document.addEventListener('mouseup', () => {
    isMouseDown = false;
});

document.addEventListener('mousemove', (event) => {
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
    color: 0xff6600,
    linewidth: 2
});

const previewMaterial = new THREE.LineBasicMaterial({
    color: 0x66ccff,
    linewidth: 2
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
}

function deselectFrame(frame) {
    if (selectedFrames.has(frame)) {
        frame.setSelected(false);
        selectedFrames.delete(frame);
    }
}

function deselectAll() {
    for (const f of selectedFrames) {
        f.setSelected(false);
    }
    selectedFrames.clear();
}

function toggleFrameSelection(frame, addToSelection = false) {
    if (selectedFrames.has(frame)) {
        deselectFrame(frame);
    } else {
        selectFrame(frame, addToSelection);
    }
}

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

// Keyboard input
document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
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
