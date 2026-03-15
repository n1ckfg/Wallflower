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
        const top = new THREE.Mesh(topGeom, frameMaterial);
        top.position.set(0, height / 2 + frameWidth / 2, 0);
        this.add(top);

        // Bottom frame piece
        const bottom = new THREE.Mesh(topGeom, frameMaterial);
        bottom.position.set(0, -height / 2 - frameWidth / 2, 0);
        this.add(bottom);

        // Left frame piece
        const sideGeom = new THREE.BoxGeometry(frameWidth, height, frameDepth);
        const left = new THREE.Mesh(sideGeom, frameMaterial);
        left.position.set(-width / 2 - frameWidth / 2, 0, 0);
        this.add(left);

        // Right frame piece
        const right = new THREE.Mesh(sideGeom, frameMaterial);
        right.position.set(width / 2 + frameWidth / 2, 0, 0);
        this.add(right);

        // Mat/backing
        const matGeom = new THREE.PlaneGeometry(width, height);
        this.mat = new THREE.Mesh(matGeom, matMaterial);
        this.mat.position.set(0, 0, -frameDepth / 2 + 0.001);
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
        this.picture.position.set(0, 0, -frameDepth / 2 + 0.002);
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
}
