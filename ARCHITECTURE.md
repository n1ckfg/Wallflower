# Architecture: Wallflower

Wallflower is a lightweight 3D gallery builder application running in the browser. It allows users to navigate a 3D space, draw picture frames onto the walls, customize them, drop images into them, draw video projectors onto the floor or ceiling, drop movies into them, drop in glTF models and transform them with a gizmo, recolor the room light, take photos and record video, and save/load gallery layouts.

## Core Technologies

- **Vanilla JavaScript (ES Modules)**: The application is written in standard ES modules without a build step or bundler.
- **Three.js** (r160): Used for all 3D rendering, scene management, raycasting, and math (vectors, matrices). Loaded via an import map from a local copy in `js/libraries/three/`, which also maps `three/addons/` for `GLTFLoader`, `TransformControls`, and the post-processing passes.
- **lil-gui** (0.19.2): A lightweight GUI library used for the contextual property panel, also vendored in `js/libraries/lil-gui/`.
- **http-server**: Used via the launch scripts (`run.bat`, `run.command`) to serve the static files locally.

## File Structure

- `index.html`: The entry point. Sets up the canvas, UI overlay, and defines the ES module import map for dependencies.
- `js/main.js`: The core application script containing scene initialization, the render loop, user interaction logic, and state management.
- `js/picture-frame.js`: Encapsulates the `PictureFrame` custom class (extending `THREE.Group`), which handles the generation and manipulation of the individual frame 3D models.
- `js/video-projector.js`: Encapsulates the `VideoProjector` custom class (extending `THREE.Group`), a physical video projector ported from the `projection_sim` project.
- `js/model-loader.js`: `loadModelFiles()`, the drag-and-drop glTF loader ported from the `gltFpsViewer` project.
- `js/recorder.js`: The `Recorder` class from `gltFpsViewer` (unchanged), wrapping `MediaRecorder` to capture the canvas to a video file.
- `js/palette.js`: The `Palette` panel from `gltFpsViewer`, adapted so its swatches set the room light's colour instead of the background; it also holds the levels sliders.
- `js/levels.js`: The `LevelsShader` from `gltFpsViewer` (unchanged), used by the levels post-processing pass.
- `js/libraries/`: Local copies of the third-party modules (with their licenses), so the app runs without network access. It mirrors each npm package's layout: `three/build/three.module.js`, only the `three/examples/jsm/` addons the app imports (plus the files they import), and `lil-gui/dist/lil-gui.esm.min.js`. To use another addon, copy it (and its relative imports) from the same three.js version into the matching path.
- `css/style.css`: Minimal styling to ensure the canvas fills the viewport and UI elements are positioned correctly.
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
- **Selection & Manipulation**: Rays are cast against the meshes of existing `PictureFrame` instances to select, drag, and resize them. Snapping logic ensures frames remain anchored to walls. Projectors are picked via their hardware meshes (not the beam) and are checked first, then models, then frames. Frames (multi-select), a projector, or a model can be selected, but never more than one kind at once. A selected projector can be dragged or arrow-nudged across the room's XZ plane.
- **Input Routing**: Mouse presses that land on a DOM panel (lil-gui, the palette) are ignored by the scene handlers, and key presses are ignored while a text field or dropdown has focus, so typing into a GUI number field never moves the camera or deletes the selection.

### 4. Frame Encapsulation (`PictureFrame`)
The `PictureFrame` class dynamically constructs and updates its geometry based on its width, height, and the aspect ratio of the applied texture. It consists of multiple meshes (top/bottom/side borders, a mat, and the picture plane itself). It also manages selection highlights and corner resize markers.

### 5. Projector Encapsulation (`VideoProjector`)
The projector casts its image as real light: a `THREE.SpotLight` whose `.map` is a `THREE.CanvasTexture`, so geometry in the beam (including frames) occludes it and casts shadows.
- **Video Source**: Each projector owns a 1024x1024 canvas redrawn every frame by `update(t)` (called from the render loop). Content (test pattern, grid, plasma, or movie) is drawn into a 16:9 rectangle; the black surround projects no light, mimicking lens masking.
- **Movies**: Dropping a video file (e.g. `.mp4`) onto a projector, or anywhere in the view while a projector is selected, calls `setVideo()`. This plays the file muted and looped in a hidden `<video>` element (from an object URL), which is letterboxed into the 16:9 frame each tick without the alignment overlay, and switches the source to "Movie". Playback pauses whenever another source is chosen. The original `Blob` is kept on the projector (`videoBlob`) for saving. "Movie" with no file loaded projects a slate prompting for one.
- **Assembly**: The group stays upright at the projector head's position. An inner `head` group (housing, lens, light, cosmetic beam cone) pivots via `lookAt()` to face the `aim` point, while a vertical stalk and plate are rescaled each frame to reach the ceiling or floor (`mount` / `surfaceY`). The spotlight target rides on the head's -Z axis, so the optional pan sweep only needs to rotate the head.
- **Helper**: The `SpotLightHelper` tracks the light's world matrix, so `main.js` adds it to the scene root alongside the projector (`addProjector` / `removeProjector`).
- **Limits**: Each projector uses two fragment texture units (light map + shadow map), so GPUs with 16 units fit roughly seven projectors.

### 6. glTF Models (`model-loader.js`)
- **Drag-and-Drop**: Dropping a `.gltf`/`.glb` (together with any `.bin` or texture files it references) loads it with `GLTFLoader`. As in `gltFpsViewer`, a `LoadingManager` URL modifier maps each file the loader requests onto the dropped `File` of the same name via a Blob URL; names are URI-decoded so references like `my%20texture.png` resolve. The loader also reports which dropped files were actually used, and `main.js` keeps them (`modelSources`) for saving.
- **Placement**: Models keep their authored scale (glTF units are meters) unless they would not fit in the room, in which case they are scaled down to fit. They stand on the floor, centred on the point the drop ray hit and kept inside the walls. All meshes cast and receive shadows, so models also block projector beams.
- **Transform Gizmo**: Clicking a model selects its root, outlines it with a green `BoxHelper`, and attaches `gltFpsViewer`'s `TransformControls` gizmo; keys `1`/`2`/`3` switch between translate, rotate, and scale. While the gizmo is hovered or dragged, clicks and drawing are suppressed so the model stays selected. The transform from before each gizmo drag is kept for Ctrl/Cmd+Z, and `Delete`/`Backspace` removes the model. `gltFpsViewer`'s scene-graph navigation (arrow keys between sub-nodes) is not ported, so a model is always moved as a whole and its saved files fully describe it.

### 7. Light, Levels, Photos & Recording (from `gltFpsViewer`)
- **Light & Levels Palette**: `C` toggles the palette (`Esc` also closes it). Its swatches and colour picker set the colour of the ceiling point light and its fixture's glow; greys dim the room and black turns the light off, which is useful for seeing projections. The levels sliders (black point, white point, gamma) drive a `LevelsShader` pass that runs after `OutputPass`, on display-referred values. Neutral levels bypass the `EffectComposer` and render straight to the canvas (`renderFrame()`).
- **Photos**: `Space` sets a flag; `animate()` renders an extra frame with the editing UI hidden, reads it with `canvas.toBlob()` straight after the render (no `preserveDrawingBuffer` needed), and downloads `photo_*.png`. A white `#flash` overlay fades out; being DOM, it never appears in the image.
- **Recording**: `R` arms a 3-second countdown, then the `Recorder` captures the canvas (MP4/H.264 where supported, else WebM) until `R` is pressed again, downloading `capture_*.mp4`. `R` during the countdown cancels. While a take is armed or running, the renderer's pixel ratio is lowered to the capture resolution (`applyCaptureRenderScale()`). The `#recorder-hud` countdown and blinking `REC` timer (top centre) are DOM, so they are never recorded.
- **Hidden Editing UI**: `hideViewerChrome()` temporarily clears selection highlights (frame outlines and corner markers, projector highlight), and hides the model gizmo and box, alignment guides, the in-progress drawing line, and projector light helpers. It returns a function that restores them. Photos use it for their extra frame. During a recording every frame is rendered this way, so the video (and the screen) shows only the gallery while selection state is kept.

### 8. Data Serialization (Save/Load)
The application can export the current state to a JSON file.
- **Save**: Serializes camera position/target, the light colour and levels (`display`), all frame properties (position, rotation, dimensions), all projector properties (mount, position, aim, video source, intensity, sweep, beam visibility, movie file name), and all models (position, rotation, scale, and their source files). Images are converted to base64 strings via a 2D canvas context. Movies and model files are read from their `Blob`/`File` as base64 data URLs (asynchronously, so `saveGallery` is `async`). Everything is embedded directly in the JSON, so large movies or models make large gallery files.
- **Load**: Parses the JSON, clears the current scene, restores the camera and display state, instantiates new `PictureFrame` and `VideoProjector` objects, re-applies the base64 textures and movies, and reloads each model by turning its data URLs back into `File`s and running them through `loadModelFiles()`. Movie and model loads are asynchronous and are discarded if another gallery is loaded meanwhile. Files without `display`, `projectors`, or `models` (saved by older versions) still load, with the default light and levels.

### 9. Contextual UI
Two `lil-gui` panels are dynamically updated and toggled based on the current selection state. When one or more frames are selected, the "Picture Frame" panel allows users to adjust position, scaling, and alignment, synchronizing state between the DOM inputs and the 3D scene. When a projector is selected, the "Projector" panel exposes the `projection_sim` controls (video source, intensity, pan sweep, beam cone, light helper) plus position, aim, the loaded movie's name, and file actions.
