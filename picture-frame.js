import * as THREE from 'three';

export class PictureFrame extends THREE.Group {
    constructor({
        width = 1,
        height = 0.75,
        frameDepth = 0.05,
        frameWidth = 0.05,
        frameColor = 0x2a2a2a,
        matColor = 0xf5f5f0,
        texture = null
    } = {}) {
        super();

        this.pictureWidth = width;
        this.pictureHeight = height;
        this._frameDepth = frameDepth;

        const frameMaterial = new THREE.MeshStandardMaterial({
            color: frameColor,
            roughness: 0.4,
            metalness: 0.1
        });

        const matMaterial = new THREE.MeshStandardMaterial({
            color: matColor,
            roughness: 0.9,
            metalness: 0.0
        });

        // Frame pieces (4 sides)
        const outerWidth = width + frameWidth * 2;
        const outerHeight = height + frameWidth * 2;

        // Top frame piece
        const topGeom = new THREE.BoxGeometry(outerWidth, frameWidth, frameDepth);
        this._topFrame = new THREE.Mesh(topGeom, frameMaterial);
        this._topFrame.position.set(0, height / 2 + frameWidth / 2, 0);
        this.add(this._topFrame);

        // Bottom frame piece
        this._bottomFrame = new THREE.Mesh(topGeom.clone(), frameMaterial);
        this._bottomFrame.position.set(0, -height / 2 - frameWidth / 2, 0);
        this.add(this._bottomFrame);

        // Left frame piece
        const sideGeom = new THREE.BoxGeometry(frameWidth, height, frameDepth);
        this._leftFrame = new THREE.Mesh(sideGeom, frameMaterial);
        this._leftFrame.position.set(-width / 2 - frameWidth / 2, 0, 0);
        this.add(this._leftFrame);

        // Right frame piece
        this._rightFrame = new THREE.Mesh(sideGeom.clone(), frameMaterial);
        this._rightFrame.position.set(width / 2 + frameWidth / 2, 0, 0);
        this.add(this._rightFrame);

        // Mat/backing
        const matGeom = new THREE.PlaneGeometry(width, height);
        this.mat = new THREE.Mesh(matGeom, matMaterial);
        this.mat.position.set(0, 0, frameDepth / 2 + 0.001);
        this.add(this.mat);

        // Picture plane (for texture)
        const pictureGeom = new THREE.PlaneGeometry(width * 0.85, height * 0.85);
        const pictureMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.5,
            metalness: 0.0,
            map: texture
        });
        this.picture = new THREE.Mesh(pictureGeom, pictureMaterial);
        this.picture.position.set(0, 0, frameDepth / 2 + 0.002);
        this.add(this.picture);

        // Enable shadows on all meshes
        this.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Selection state
        this._selected = false;
        this._originalFrameColor = frameColor;
        this._frameMaterial = frameMaterial;

        // Undo state
        this._priorPosition = null;

        // Selection highlight outline
        const outlineGeom = new THREE.EdgesGeometry(
            new THREE.BoxGeometry(outerWidth + 0.02, outerHeight + 0.02, frameDepth + 0.02)
        );
        this._selectionOutline = new THREE.LineSegments(
            outlineGeom,
            new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 })
        );
        this._selectionOutline.visible = false;
        this.add(this._selectionOutline);

        // Corner markers for resize
        this._frameWidth = frameWidth;
        this._cornerMarkers = [];
        const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const cornerGeom = new THREE.SphereGeometry(0.1, 12, 12);

        const cornerOffsets = [
            { x: -width / 2 - frameWidth, y: height / 2 + frameWidth },   // top-left
            { x: width / 2 + frameWidth, y: height / 2 + frameWidth },    // top-right
            { x: -width / 2 - frameWidth, y: -height / 2 - frameWidth },  // bottom-left
            { x: width / 2 + frameWidth, y: -height / 2 - frameWidth }    // bottom-right
        ];

        for (const offset of cornerOffsets) {
            const marker = new THREE.Mesh(cornerGeom, cornerMaterial);
            marker.position.set(offset.x, offset.y, frameDepth / 2 + 0.01);
            marker.visible = false;
            this.add(marker);
            this._cornerMarkers.push(marker);
        }
    }

    setTexture(texture) {
        this.picture.material.map = texture;
        this.picture.material.needsUpdate = true;
    }

    get selected() {
        return this._selected;
    }

    setSelected(selected) {
        this._selected = selected;
        this._selectionOutline.visible = selected;
        if (selected) {
            this._frameMaterial.emissive.setHex(0x444400);
            this._frameMaterial.emissiveIntensity = 0.5;
        } else {
            this._frameMaterial.emissive.setHex(0x000000);
            this._frameMaterial.emissiveIntensity = 0;
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

    getCornerWorldPositions() {
        const positions = [];
        for (const marker of this._cornerMarkers) {
            const worldPos = new THREE.Vector3();
            marker.getWorldPosition(worldPos);
            positions.push(worldPos);
        }
        return positions;
    }

    showCornerMarkers(visible) {
        for (const marker of this._cornerMarkers) {
            marker.visible = visible;
        }
    }

    getCornerIndex(worldPos, threshold = 0.1) {
        const corners = this.getCornerWorldPositions();
        for (let i = 0; i < corners.length; i++) {
            if (corners[i].distanceTo(worldPos) < threshold) {
                return i;
            }
        }
        return -1;
    }

    resize(newWidth, newHeight) {
        this.pictureWidth = newWidth;
        this.pictureHeight = newHeight;

        const frameWidth = this._frameWidth;
        const frameDepth = this._frameDepth;
        const outerWidth = newWidth + frameWidth * 2;
        const outerHeight = newHeight + frameWidth * 2;

        // Update top/bottom frame pieces
        this._topFrame.geometry.dispose();
        this._topFrame.geometry = new THREE.BoxGeometry(outerWidth, frameWidth, frameDepth);
        this._topFrame.position.set(0, newHeight / 2 + frameWidth / 2, 0);

        this._bottomFrame.geometry.dispose();
        this._bottomFrame.geometry = new THREE.BoxGeometry(outerWidth, frameWidth, frameDepth);
        this._bottomFrame.position.set(0, -newHeight / 2 - frameWidth / 2, 0);

        // Update left/right frame pieces
        this._leftFrame.geometry.dispose();
        this._leftFrame.geometry = new THREE.BoxGeometry(frameWidth, newHeight, frameDepth);
        this._leftFrame.position.set(-newWidth / 2 - frameWidth / 2, 0, 0);

        this._rightFrame.geometry.dispose();
        this._rightFrame.geometry = new THREE.BoxGeometry(frameWidth, newHeight, frameDepth);
        this._rightFrame.position.set(newWidth / 2 + frameWidth / 2, 0, 0);

        // Update mat
        this.mat.geometry.dispose();
        this.mat.geometry = new THREE.PlaneGeometry(newWidth, newHeight);
        this.mat.position.set(0, 0, frameDepth / 2 + 0.001);

        // Update picture
        this.picture.geometry.dispose();
        this.picture.geometry = new THREE.PlaneGeometry(newWidth * 0.85, newHeight * 0.85);
        this.picture.position.set(0, 0, frameDepth / 2 + 0.002);

        // Update selection outline
        this._selectionOutline.geometry.dispose();
        this._selectionOutline.geometry = new THREE.EdgesGeometry(
            new THREE.BoxGeometry(outerWidth + 0.02, outerHeight + 0.02, frameDepth + 0.02)
        );

        // Update corner markers
        const cornerOffsets = [
            { x: -newWidth / 2 - frameWidth, y: newHeight / 2 + frameWidth },
            { x: newWidth / 2 + frameWidth, y: newHeight / 2 + frameWidth },
            { x: -newWidth / 2 - frameWidth, y: -newHeight / 2 - frameWidth },
            { x: newWidth / 2 + frameWidth, y: -newHeight / 2 - frameWidth }
        ];

        for (let i = 0; i < this._cornerMarkers.length; i++) {
            this._cornerMarkers[i].position.set(
                cornerOffsets[i].x,
                cornerOffsets[i].y,
                frameDepth / 2 + 0.01
            );
        }
    }
}
