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

const hallwayWallMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8b8b4,
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

// Door dimensions
const doorWidth = 1.2;
const doorHeight = 2.4;
const hallwayWidth = 2;
const hallwayLength = roomDepth * 0.25; // 25% of wall length

// Front wall (north) with door opening - split into 3 sections
// Left section
const leftWallWidth = (roomWidth - doorWidth) / 2;
createWall(leftWallWidth, roomHeight, -roomWidth / 2 + leftWallWidth / 2, roomHeight / 2, -roomDepth / 2, 0);
// Right section
createWall(leftWallWidth, roomHeight, roomWidth / 2 - leftWallWidth / 2, roomHeight / 2, -roomDepth / 2, 0);
// Top section (above door)
const topSectionHeight = roomHeight - doorHeight;
createWall(doorWidth, topSectionHeight, 0, doorHeight + topSectionHeight / 2, -roomDepth / 2, 0);

// Hallway - extends north then turns right
const hallwayZ = -roomDepth / 2 - hallwayLength / 2;
const hallwayEndZ = -roomDepth / 2 - hallwayLength;
const turnLength = hallwayLength;

// Hallway floor (north section)
const hallwayFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(hallwayWidth, hallwayLength),
    floorMaterial
);
hallwayFloor.rotation.x = -Math.PI / 2;
hallwayFloor.position.set(0, 0, hallwayZ);
hallwayFloor.receiveShadow = true;
scene.add(hallwayFloor);

// Hallway ceiling (north section)
const hallwayCeiling = new THREE.Mesh(
    new THREE.PlaneGeometry(hallwayWidth, hallwayLength),
    ceilingMaterial
);
hallwayCeiling.rotation.x = Math.PI / 2;
hallwayCeiling.position.set(0, roomHeight, hallwayZ);
scene.add(hallwayCeiling);

// Hallway left wall (north section)
createWall(hallwayLength, roomHeight, -hallwayWidth / 2, roomHeight / 2, hallwayZ, Math.PI / 2, hallwayWallMaterial);

// Turn section (extends right/+X)
const turnFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(turnLength, hallwayWidth),
    floorMaterial
);
turnFloor.rotation.x = -Math.PI / 2;
turnFloor.position.set(hallwayWidth / 2 + turnLength / 2, 0, hallwayEndZ + hallwayWidth / 2);
turnFloor.receiveShadow = true;
scene.add(turnFloor);

const turnCeiling = new THREE.Mesh(
    new THREE.PlaneGeometry(turnLength, hallwayWidth),
    ceilingMaterial
);
turnCeiling.rotation.x = Math.PI / 2;
turnCeiling.position.set(hallwayWidth / 2 + turnLength / 2, roomHeight, hallwayEndZ + hallwayWidth / 2);
scene.add(turnCeiling);

// Turn back wall (north wall of turn section)
createWall(turnLength, roomHeight, hallwayWidth / 2 + turnLength / 2 - 2, roomHeight / 2, hallwayEndZ, 0, hallwayWallMaterial);

// Turn front wall (south wall of turn, closes the corner)
createWall(turnLength, roomHeight, hallwayWidth / 2 + turnLength / 2, roomHeight / 2, hallwayEndZ + hallwayWidth, Math.PI, hallwayWallMaterial);

// Close off the corner where hallway meets turn (west side of turn)
const cornerWall = new THREE.Mesh(
    new THREE.PlaneGeometry(hallwayWidth, roomHeight),
    hallwayWallMaterial
);
cornerWall.position.set(-hallwayWidth / 2, roomHeight / 2, hallwayEndZ + hallwayWidth / 2);
cornerWall.rotation.y = Math.PI / 2;
cornerWall.receiveShadow = true;
scene.add(cornerWall);
walls.push(cornerWall);

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
    const centerWorld = centerLocal.applyMatrix4(wallWorldMatrix);

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

            // Create PictureFrame
            const frame = new PictureFrame({
                width: width,
                height: height
            });
            frame.position.copy(centerWorld);
            frame.rotation.copy(currentWall.rotation);
            scene.add(frame);

            drawingPoints.length = 0;
            currentWall = null;
        }
    }, 100);
}

// Drawing event listeners
renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button === 0 && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        startDrawing(event);
    }
});

renderer.domElement.addEventListener('mousemove', (event) => {
    if (isDrawing) {
        continueDrawing(event);
    }
});

renderer.domElement.addEventListener('mouseup', (event) => {
    if (event.button === 0 && isDrawing) {
        finishDrawing();
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
