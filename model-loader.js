import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Drag-and-drop glTF loading, ported from gltFpsViewer. Dropped files can't be
// fetched by URL, so a LoadingManager URL modifier maps each file the loader asks
// for (the .gltf/.glb itself, plus any .bin or texture files it references) onto
// the dropped File of the same name, served through a Blob URL.

export const MODEL_FILE_PATTERN = /\.(gltf|glb)$/i;

function getFilename(url) {
    let path = url;
    try {
        path = new URL(url, window.location.href).pathname;
    } catch (e) {
        // Not a parseable URL; fall back to the raw string
    }
    const name = path.substring(path.lastIndexOf('/') + 1);
    try {
        return decodeURIComponent(name);
    } catch (e) {
        return name;
    }
}

// Resolves with { model, files }: the loaded scene, and the subset of `files` it
// actually used (so the model can be saved and loaded again later).
export function loadModelFiles(files) {
    return new Promise((resolve, reject) => {
        const fileMap = new Map();
        let rootFile = null;

        for (const file of files) {
            fileMap.set(file.name, file);
            if (MODEL_FILE_PATTERN.test(file.name)) {
                rootFile = file;
            }
        }

        if (!rootFile) {
            reject(new Error('No .gltf or .glb file found in the dropped files.'));
            return;
        }

        const usedFiles = [rootFile];
        const objectURLs = [];

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
            const file = fileMap.get(getFilename(url));
            if (!file || file === rootFile) return url;
            if (!usedFiles.includes(file)) usedFiles.push(file);
            const blobUrl = URL.createObjectURL(file);
            objectURLs.push(blobUrl);
            return blobUrl;
        });

        const loader = new GLTFLoader(manager);
        const rootUrl = URL.createObjectURL(rootFile);
        objectURLs.push(rootUrl);

        loader.load(rootUrl, (gltf) => {
            objectURLs.forEach(url => URL.revokeObjectURL(url));
            resolve({ model: gltf.scene, files: usedFiles });
        }, undefined, (error) => {
            objectURLs.forEach(url => URL.revokeObjectURL(url));
            reject(error);
        });
    });
}
