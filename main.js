import * as THREE from 'three';

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
    color: 0x4a4a4a,
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

// Walls
function createWall(width, height, x, y, z, rotationY = 0) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const wall = new THREE.Mesh(geometry, wallMaterial);
    wall.position.set(x, y, z);
    wall.rotation.y = rotationY;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
}

// Front wall
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
    e: false
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
    isMouseDown = true;
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
        spherical.phi += event.movementY * orbitSpeed;

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
        velocity.multiplyScalar(moveSpeed * delta);
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
