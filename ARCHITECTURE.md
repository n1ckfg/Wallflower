# Architecture: Wallflower

Wallflower is a lightweight 3D gallery builder application running in the browser. It allows users to navigate a 3D space, draw picture frames onto the walls, customize them, drop images into them, draw video projectors onto the floor or ceiling, drop movies into them, and save/load gallery layouts.

## Core Technologies

- **Vanilla JavaScript (ES Modules)**: The application is written in standard ES modules without a build step or bundler.
- **Three.js**: Used for all 3D rendering, scene management, raycasting, and math (vectors, matrices). Loaded via an import map from a CDN.
- **lil-gui**: A lightweight GUI library used for the contextual property panel.
- **http-server**: Used via the launch scripts (`run.bat`, `run.command`) to serve the static files locally.

## File Structure

- `index.html`: The entry point. Sets up the canvas, UI overlay, and defines the ES module import map for dependencies.
- `main.js`: The core application script containing scene initialization, the render loop, user interaction logic, and state management.
- `picture-frame.js`: Encapsulates the `PictureFrame` custom class (extending `THREE.Group`), which handles the generation and manipulation of the individual frame 3D models.
- `video-projector.js`: Encapsulates the `VideoProjector` custom class (extending `THREE.Group`), a physical video projector ported from the `projection_sim` project.
- `style.css`: Minimal styling to ensure the canvas fills the viewport and UI elements are positioned correctly.
- `run.bat` / `run.command`: Convenience scripts for Windows and macOS/Linux to find an available port and launch a local web server.

## Key Systems

### 1. Scene & Environment
The 3D environment is initialized in `main.js`. It consists of a simple room with procedurally generated floor, ceiling, and walls. Lights (ambient, point, and a modeled ceiling fixture) are added to illuminate the room and provide soft shadows.

### 2. Camera & Navigation
The camera is managed using a hybrid approach:
- **Orbit Controls**: Controlled by spherical coordinates (`radius`, `phi`, `theta`) orbiting a central `target` vector.
- **FPS-style Movement**: The WASD and Q/E keys move the central `target` vector, carrying the orbiting camera along with it.

### 3. Interaction & Raycasting
User interactions (clicking, dragging, drawing) rely heavily on Three.js's `Raycaster`.
- **Drawing Frames & Projectors**: Clicking and dragging casts rays against the walls, floor, and ceiling, calculating a bounding box on the hit surface. A stroke on a wall instantiates a new `PictureFrame`; a stroke on the floor or ceiling instantiates a `VideoProjector` at the stroke's center, aimed at the wall the camera is facing.
- **Selection & Manipulation**: Rays are cast against the meshes of existing `PictureFrame` instances to select, drag, and resize them. Snapping logic ensures frames remain anchored to walls. Projectors are picked via their hardware meshes (not the beam) and are checked before frames. Only one projector is selected at a time, and never together with frames; a selected projector can be dragged or arrow-nudged across the room's XZ plane.

### 4. Frame Encapsulation (`PictureFrame`)
The `PictureFrame` class dynamically constructs and updates its geometry based on its width, height, and the aspect ratio of the applied texture. It consists of multiple meshes (top/bottom/side borders, a mat, and the picture plane itself). It also manages selection highlights and corner resize markers.

### 5. Projector Encapsulation (`VideoProjector`)
The projector casts its image as real light: a `THREE.SpotLight` whose `.map` is a `THREE.CanvasTexture`, so geometry in the beam (including frames) occludes it and casts shadows.
- **Video Source**: Each projector owns a 1024x1024 canvas redrawn every frame by `update(t)` (called from the render loop). Content (test pattern, grid, plasma, or movie) is drawn into a 16:9 rectangle; the black surround projects no light, mimicking lens masking.
- **Movies**: Dropping a video file (e.g. `.mp4`) onto a projector, or anywhere in the view while a projector is selected, calls `setVideo()`. This plays the file muted and looped in a hidden `<video>` element (from an object URL), which is letterboxed into the 16:9 frame each tick without the alignment overlay, and switches the source to "Movie". Playback pauses whenever another source is chosen. The original `Blob` is kept on the projector (`videoBlob`) for saving. "Movie" with no file loaded projects a slate prompting for one.
- **Assembly**: The group stays upright at the projector head's position. An inner `head` group (housing, lens, light, cosmetic beam cone) pivots via `lookAt()` to face the `aim` point, while a vertical stalk and plate are rescaled each frame to reach the ceiling or floor (`mount` / `surfaceY`). The spotlight target rides on the head's -Z axis, so the optional pan sweep only needs to rotate the head.
- **Helper**: The `SpotLightHelper` tracks the light's world matrix, so `main.js` adds it to the scene root alongside the projector (`addProjector` / `removeProjector`).
- **Limits**: Each projector uses two fragment texture units (light map + shadow map), so GPUs with 16 units fit roughly seven projectors.

### 6. Data Serialization (Save/Load)
The application can export the current state to a JSON file.
- **Save**: Serializes camera position/target, all frame properties (position, rotation, dimensions), and all projector properties (mount, position, aim, video source, intensity, sweep, beam visibility, movie file name). Images are converted to base64 strings via a 2D canvas context, and movies are read from their `Blob` as base64 data URLs (asynchronously, so `saveGallery` is `async`); both are embedded directly in the JSON, so large movies make large gallery files.
- **Load**: Parses the JSON, clears the current scene, restores the camera state, instantiates new `PictureFrame` and `VideoProjector` objects, and re-applies the base64 textures and movies (each movie data URL is turned back into a `Blob` via `fetch`). Files without a `projectors` array (saved before projectors existed) still load.

### 7. Contextual UI
Two `lil-gui` panels are dynamically updated and toggled based on the current selection state. When one or more frames are selected, the "Picture Frame" panel allows users to adjust position, scaling, and alignment, synchronizing state between the DOM inputs and the 3D scene. When a projector is selected, the "Projector" panel exposes the `projection_sim` controls (video source, intensity, pan sweep, beam cone, light helper) plus position, aim, the loaded movie's name, and file actions.
