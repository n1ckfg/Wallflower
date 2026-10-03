import * as THREE from 'three';

// The projector's "slide" is a canvas redrawn every frame. Content is drawn
// inside a 16:9 rectangle inscribed in the spotlight's circular cone; the
// surrounding canvas stays black, and black projects no light — exactly like
// the masked-off area of a real projector lens.
const VC = 1024;
const AR = 16 / 9;
const FRAME_H = 0.95 * VC / Math.hypot(AR, 1);
const FRAME_W = AR * FRAME_H;
const FX = (VC - FRAME_W) / 2;
const FY = (VC - FRAME_H) / 2;

export const VIDEO_SOURCES = ['Test pattern', 'Grid', 'Plasma'];

const BAR_COLORS = ['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf'];

// Low-res scratch buffer for the plasma mode, scaled up like soft video (shared by all projectors)
const plasmaCanvas = document.createElement('canvas');
plasmaCanvas.width = 64;
plasmaCanvas.height = 36;
const pctx = plasmaCanvas.getContext('2d');
const plasmaImage = pctx.createImageData(64, 36);

// Distance from the light source to the front of the lens
const LENS_OFFSET = 0.4;
const UP = new THREE.Vector3(0, 1, 0);

function drawTestPattern(ctx, t) {
    const barsH = FRAME_H * 0.62;
    const barW = FRAME_W / BAR_COLORS.length;
    BAR_COLORS.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(FX + i * barW, FY, barW + 1, barsH);
    });
    // Lower strip: gradient sweep
    const g = ctx.createLinearGradient(FX, 0, FX + FRAME_W, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#fff');
    ctx.fillStyle = g;
    ctx.fillRect(FX, FY + barsH, FRAME_W, FRAME_H * 0.14);
    ctx.fillStyle = '#111';
    ctx.fillRect(FX, FY + barsH + FRAME_H * 0.14, FRAME_W, FRAME_H - barsH - FRAME_H * 0.14);
    // Bouncing ball
    const bx = FX + FRAME_W * (0.5 + 0.44 * Math.sin(t * 1.4));
    const by = FY + FRAME_H * (0.5 + 0.38 * Math.abs(Math.sin(t * 2.1)));
    const glow = ctx.createRadialGradient(bx, by, 4, bx, by, 60);
    glow.addColorStop(0, '#fff');
    glow.addColorStop(0.35, '#ffd34d');
    glow.addColorStop(1, 'rgba(255,160,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bx, by, 60, 0, Math.PI * 2);
    ctx.fill();
}

function drawGrid(ctx, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(FX, FY, FRAME_W, FRAME_H);
    ctx.strokeStyle = '#7fe8ff';
    ctx.lineWidth = 3;
    const n = 12;
    const rows = Math.round(n / AR);
    for (let i = 0; i <= n; i++) {
        const x = FX + (i / n) * FRAME_W;
        ctx.beginPath();
        ctx.moveTo(x, FY);
        ctx.lineTo(x, FY + FRAME_H);
        ctx.stroke();
    }
    for (let j = 0; j <= rows; j++) {
        const y = FY + (j / rows) * FRAME_H;
        ctx.beginPath();
        ctx.moveTo(FX, y);
        ctx.lineTo(FX + FRAME_W, y);
        ctx.stroke();
    }
    // Pulsing crosshair
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    const r = FRAME_H * (0.12 + 0.05 * Math.sin(t * 3));
    ctx.beginPath();
    ctx.arc(VC / 2, VC / 2, r, 0, Math.PI * 2);
    ctx.stroke();
}

function drawPlasma(ctx, t) {
    const d = plasmaImage.data;
    let k = 0;
    for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 64; x++) {
            const v = Math.sin(x * 0.22 + t) + Math.sin(y * 0.35 - t * 0.7)
                    + Math.sin((x + y) * 0.15 + t * 0.5) + Math.sin(Math.hypot(x - 32, y - 18) * 0.3 - t);
            d[k++] = 128 + 127 * Math.sin(v * Math.PI * 0.5);
            d[k++] = 128 + 127 * Math.sin(v * Math.PI * 0.5 + 2.1);
            d[k++] = 128 + 127 * Math.sin(v * Math.PI * 0.5 + 4.2);
            d[k++] = 255;
        }
    }
    pctx.putImageData(plasmaImage, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(plasmaCanvas, FX, FY, FRAME_W, FRAME_H);
}

function drawVideoFrame(ctx, t, mode) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VC, VC);
    if (mode === 'Test pattern') drawTestPattern(ctx, t);
    else if (mode === 'Grid') drawGrid(ctx, t);
    else drawPlasma(ctx, t);
    // Frame border + timecode, like a projector alignment overlay
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(FX + 2, FY + 2, FRAME_W - 4, FRAME_H - 4);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px monospace';
    const s = Math.floor(t);
    const f = Math.floor((t % 1) * 30);
    const tc = `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    ctx.fillText(tc, FX + FRAME_W - ctx.measureText(tc).width - 24, FY + FRAME_H - 22);
}

// A physical video projector: a SpotLight whose .map is a live canvas texture,
// so the image is cast as real light (occluded by geometry, distorted by surfaces).
// The group stays upright at the projector head's position; the inner head pivots
// to aim while the mount stalk stays vertical, reaching up to the ceiling or down
// to the floor.
export class VideoProjector extends THREE.Group {
    constructor({
        mount = 'ceiling', // 'ceiling' or 'floor'
        surfaceY = 0, // World Y of the ceiling/floor the mount attaches to
        aim = new THREE.Vector3(0, 2, 0), // World-space point the lens points at
        content = 'Test pattern',
        intensity = 150,
        sweep = false,
        showBeam = true
    } = {}) {
        super();

        this.mount = mount;
        this.surfaceY = surfaceY;
        this.aim = aim.clone();
        this.content = content;
        this.sweep = sweep;

        // Video source
        this._canvas = document.createElement('canvas');
        this._canvas.width = this._canvas.height = VC;
        this._ctx = this._canvas.getContext('2d');
        this.videoTexture = new THREE.CanvasTexture(this._canvas);
        this.videoTexture.colorSpace = THREE.SRGBColorSpace;

        // Head (pivots to aim)
        this.head = new THREE.Group();
        this.add(this.head);

        this.spot = new THREE.SpotLight(0xffffff, intensity);
        this.spot.angle = Math.atan((FRAME_H / VC) * 0.72); // Cone sized so the 16:9 frame fills it
        this.spot.penumbra = 0.06;
        this.spot.decay = 2;
        this.spot.distance = 0; // No cutoff
        this.spot.map = this.videoTexture;
        this.spot.castShadow = true;
        this.spot.shadow.mapSize.set(2048, 2048);
        this.spot.shadow.camera.near = 0.5;
        this.spot.shadow.camera.far = 30;
        this.spot.shadow.bias = -0.0004;
        this.head.add(this.spot);

        // Target rides on the head's -Z axis, so the light follows the head's orientation
        this._spotTarget = new THREE.Object3D();
        this.head.add(this._spotTarget);
        this.spot.target = this._spotTarget;

        // Housing
        this._housingMaterial = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.6, metalness: 0.4 });
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.9), this._housingMaterial);
        housing.castShadow = true;
        this.head.add(housing);

        const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.11, 0.12, 24),
            new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.2,
                metalness: 0.8,
                emissive: 0xbfd9ff,
                emissiveIntensity: 2.5
            })
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0, -0.5);
        this.head.add(lens);

        // Mount: unit-height stalk scaled to reach the ceiling/floor, plus a plate where it attaches
        this._stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12), this._housingMaterial);
        this._stalk.castShadow = true;
        this.add(this._stalk);

        this._plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), this._housingMaterial);
        this._plate.castShadow = true;
        this.add(this._plate);

        // Subtle volumetric beam cone (purely cosmetic); unit length, scaled to reach the aim point
        this._beam = new THREE.Mesh(
            new THREE.ConeGeometry(Math.tan(this.spot.angle) * 1.05, 1, 48, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0x9db8ff,
                transparent: true,
                opacity: 0.03,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        this._beam.rotation.x = Math.PI / 2;
        this._beam.visible = showBeam;
        this.head.add(this._beam);

        // Light helper; SpotLightHelper tracks the light's world matrix, so the caller adds it to the scene root
        this.helper = new THREE.SpotLightHelper(this.spot);
        this.helper.visible = false;

        // Meshes that count as "the projector" for picking (not the beam cone)
        this.pickMeshes = [housing, lens, this._stalk, this._plate];
        for (const mesh of this.pickMeshes) {
            mesh.userData.parentProjector = this;
        }

        // Selection state
        this._selected = false;

        // Undo state
        this._priorPosition = null;

        // Selection highlight outline around the head (renders on top of everything)
        const outlineGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.74, 0.32, 1.06));
        this._selectionOutline = new THREE.LineSegments(
            outlineGeom,
            new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2, depthTest: false })
        );
        this._selectionOutline.position.z = -0.08;
        this._selectionOutline.visible = false;
        this._selectionOutline.renderOrder = 999;
        this.head.add(this._selectionOutline);
    }

    get intensity() {
        return this.spot.intensity;
    }

    set intensity(value) {
        this.spot.intensity = value;
    }

    get showBeam() {
        return this._beam.visible;
    }

    set showBeam(visible) {
        this._beam.visible = visible;
    }

    get showHelper() {
        return this.helper.visible;
    }

    set showHelper(visible) {
        this.helper.visible = visible;
        if (visible) this.helper.update();
    }

    // Call once per frame: redraws the video, aims the head, and fits the mount and beam
    update(t) {
        drawVideoFrame(this._ctx, t, this.content);
        this.videoTexture.needsUpdate = true;

        this.head.lookAt(this.aim);
        this.head.rotateY(Math.PI); // Housing's -Z faces the target
        if (this.sweep) {
            this.head.rotateOnWorldAxis(UP, Math.sin(t * 0.35) * 0.3);
            this.head.rotateX(Math.sin(t * 0.22) * 0.075);
        }

        const throwDistance = Math.max(0.5, this.position.distanceTo(this.aim));
        this._spotTarget.position.set(0, 0, -throwDistance);

        const beamLength = Math.max(0.1, throwDistance - LENS_OFFSET);
        this._beam.scale.setScalar(beamLength);
        this._beam.position.z = -LENS_OFFSET - beamLength / 2;

        // Positive reach = stalk runs up to the ceiling, negative = down to the floor
        const reach = this.surfaceY - this.position.y;
        this._stalk.scale.y = Math.max(0.01, Math.abs(reach));
        this._stalk.position.y = reach / 2;
        this._plate.position.y = reach;

        if (this.helper.visible) this.helper.update();
    }

    get selected() {
        return this._selected;
    }

    setSelected(selected) {
        this._selected = selected;
        this._selectionOutline.visible = selected;
        if (selected) {
            this._housingMaterial.emissive.setHex(0x444400);
            this._housingMaterial.emissiveIntensity = 0.5;
        } else {
            this._housingMaterial.emissive.setHex(0x000000);
            this._housingMaterial.emissiveIntensity = 0;
        }
    }

    savePriorPosition() {
        this._priorPosition = this.position.clone();
    }

    restorePriorPosition() {
        if (this._priorPosition) {
            const current = this.position.clone();
            this.position.copy(this._priorPosition);
            this._priorPosition = current;
        }
    }

    get hasPriorPosition() {
        return this._priorPosition !== null;
    }

    dispose() {
        this.videoTexture.dispose();
        this.spot.dispose(); // Frees the shadow map
        this.helper.dispose();
        this.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}
