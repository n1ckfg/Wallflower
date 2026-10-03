# Architecture: Wallflower

Wallflower is a lightweight 3D gallery builder application running in the browser. It allows users to navigate a 3D space, draw picture frames onto the walls, customize them, drop images into them, and save/load gallery layouts.

## Core Technologies

- **Vanilla JavaScript (ES Modules)**: The application is written in standard ES modules without a build step or bundler.
- **Three.js**: Used for all 3D rendering, scene management, raycasting, and math (vectors, matrices). Loaded via an import map from a CDN.
- **lil-gui**: A lightweight GUI library used for the contextual property panel.
- **http-server**: Used via the launch scripts (`run.bat`, `run.command`) to serve the static files locally.

## File Structure

- `index.html`: The entry point. Sets up the canvas, UI overlay, and defines the ES module import map for dependencies.
- `main.js`: The core application script containing scene initialization, the render loop, user interaction logic, and state management.
- `picture-frame.js`: Encapsulates the `PictureFrame` custom class (extending `THREE.Group`), which handles the generation and manipulation of the individual frame 3D models.
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
- **Drawing Frames**: Clicking and dragging on a wall casts rays against the wall meshes, calculating a bounding box to instantiate a new `PictureFrame`.
- **Selection & Manipulation**: Rays are cast against the meshes of existing `PictureFrame` instances to select, drag, and resize them. Snapping logic ensures frames remain anchored to walls.

### 4. Frame Encapsulation (`PictureFrame`)
The `PictureFrame` class dynamically constructs and updates its geometry based on its width, height, and the aspect ratio of the applied texture. It consists of multiple meshes (top/bottom/side borders, a mat, and the picture plane itself). It also manages selection highlights and corner resize markers.

### 5. Data Serialization (Save/Load)
The application can export the current state to a JSON file.
- **Save**: Serializes camera position/target and all frame properties (position, rotation, dimensions). Images are converted to base64 strings via a 2D canvas context and embedded directly in the JSON.
- **Load**: Parses the JSON, clears the current scene, restores the camera state, instantiates new `PictureFrame` objects, and re-applies the base64 textures.

### 6. Contextual UI
The `lil-gui` panel is dynamically updated and toggled based on the current selection state. When one or more frames are selected, the panel allows users to adjust position, scaling, and alignment, synchronizing state between the DOM inputs and the 3D scene.
