/**
 * =============================================================================
 * SplatMesh - GPU-Accelerated 3D Gaussian Splatting Renderer
 * =============================================================================
 * 
 * OVERVIEW:
 * This module creates a renderable Three.js mesh from parsed 3DGS data.
 * It uses instanced rendering and data textures for efficient GPU processing.
 * 
 * RENDERING PIPELINE:
 * 
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │                        CPU (JavaScript)                                 │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │  1. SplatLoader parses binary files into typed arrays                   │
 *   │  2. SplatMesh packs data into DataTextures (positions, rotations, etc.) │
 *   │  3. Creates instanced geometry (1 quad × N instances)                   │
 *   └──────────────────────────────┬──────────────────────────────────────────┘
 *                                  │ Upload to GPU
 *                                  ▼
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │                        GPU (WebGL Shaders)                              │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │  Vertex Shader (splat.vert):                                            │
 *   │    1. Fetch splat data from textures using instance index               │
 *   │    2. Transform position to view space                                  │
 *   │    3. Compute 2D covariance from 3D Gaussian                            │
 *   │    4. Calculate screen-space quad size                                  │
 *   │    5. Output screen-space vertex positions                              │
 *   │                                                                         │
 *   │  Fragment Shader (splat.frag):                                          │
 *   │    1. Compute Gaussian falloff from quad center                         │
 *   │    2. Apply color and alpha blending                                    │
 *   │    3. Discard low-contribution fragments                                │
 *   └─────────────────────────────────────────────────────────────────────────┘
 * 
 * KEY CONCEPTS:
 * 
 * 1. INSTANCED RENDERING:
 *    Instead of drawing N separate quads, we draw 1 quad N times with
 *    per-instance data. This reduces draw calls from N to 1.
 *    
 *    Single Quad Geometry:
 *      (-1,1)────(1,1)
 *        │    ╲    │
 *        │     ╲   │      × 63,441 instances = 1 draw call
 *        │      ╲  │
 *      (-1,-1)───(1,-1)
 * 
 * 2. DATA TEXTURES:
 *    GPU attributes are limited, so we store splat data in textures.
 *    Each pixel = 1 splat's data, addressed by instance index.
 *    
 *    Texture Layout (252×252 for 63,441 splats):
 *    ┌────────────────────────┐
 *    │ [0]  [1]  [2]  ... [251]│
 *    │ [252][253][254]...     │
 *    │ ...                    │
 *    └────────────────────────┘
 *    
 *    Addressing: UV = (index % width + 0.5, floor(index / width) + 0.5) / size
 * 
 * 3. 2D PROJECTION OF 3D GAUSSIAN:
 *    A 3D Gaussian projects to a 2D Gaussian on screen.
 *    The 2D covariance determines the ellipse shape.
 *    
 *    3D Covariance:  Σ₃ᴅ = R · S · Sᵀ · Rᵀ  (3×3 matrix)
 *                         ↓ Jacobian projection
 *    2D Covariance:  Σ₂ᴅ = J · W · Σ₃ᴅ · Wᵀ · Jᵀ  (2×2 matrix)
 *    
 *    Where:
 *      - W: World-to-view rotation (3×3)
 *      - J: Jacobian of projection (2×3)
 */

import * as THREE from 'three';

// Import shaders as raw strings (Vite handles this with ?raw suffix)
// @ts-ignore - Vite raw import
import splatVert from '../shaders/splat.vert?raw';
// @ts-ignore - Vite raw import
import splatFrag from '../shaders/splat.frag?raw';

/**
 * SplatMesh Class
 * 
 * A Three.js Mesh subclass that renders 3D Gaussian Splats using
 * instanced rendering and custom shaders.
 * 
 * Extends THREE.Mesh to integrate seamlessly with Three.js scene graph.
 */
export class SplatMesh extends THREE.Mesh {
    // Three.js overrides (more specific types)
    geometry: THREE.InstancedBufferGeometry;
    material: THREE.ShaderMaterial;
    
    // =========================================================================
    // Data Textures - Store splat attributes for GPU access
    // =========================================================================
    
    /** Position texture: RGB = xyz center position, A = 1.0 */
    texPosition: THREE.DataTexture;
    
    /** Rotation texture: RGBA = quaternion (x, y, z, w) */
    texRotation: THREE.DataTexture;
    
    /** Scale texture: RGB = xyz scale factors, A = 1.0 */
    texScale: THREE.DataTexture;
    
    /** Color texture: RGBA = color + opacity (8-bit per channel) */
    texColor: THREE.DataTexture;
    
    /** Skinning indices texture: RGBA = 4 bone indices (optional) */
    texSkinIndices?: THREE.DataTexture;
    
    /** Skinning weights texture: RGBA = 4 bone weights (optional) */
    texSkinWeights?: THREE.DataTexture;
    
    // =========================================================================
    // Sorting State - For proper alpha blending (back-to-front order)
    // =========================================================================
    
    /** Total number of Gaussian splats */
    splatCount: number;
    
    /** Instance indices buffer (updated during sorting) */
    splatIndices: Float32Array;
    
    /** CPU copy of splat centers for depth sorting */
    centers: Float32Array;
    
    // Pre-allocated arrays to avoid garbage collection pressure
    private sortIndices: Int32Array;
    private sortDepths: Float32Array;
    private sortModelView: THREE.Matrix4;
    private sortViewportSize: THREE.Vector2;
    private lastSortTime: number = 0;
    private sortInterval: number = 500;  // Sort every 500ms max
    private sortEnabled: boolean = false; // Disabled for performance
    
    /**
     * Create a new SplatMesh.
     * 
     * @param splatCount - Number of Gaussian splats
     * @param positions - Float32Array of xyz positions (length: splatCount * 3)
     * @param rotations - Float32Array of quaternions (length: splatCount * 4)
     * @param scales - Float32Array of xyz scales (length: splatCount * 3)
     * @param colors - Uint8Array of RGBA colors (length: splatCount * 4)
     * @param opacities - Float32Array of alpha values (length: splatCount)
     * @param skinIndices - Optional Uint16Array of bone indices (length: splatCount * 4)
     * @param skinWeights - Optional Float32Array of bone weights (length: splatCount * 4)
     */
    constructor(
        splatCount: number,
        positions: Float32Array,
        rotations: Float32Array,
        scales: Float32Array,
        colors: Uint8Array,
        opacities: Float32Array,
        skinIndices?: Uint16Array,
        skinWeights?: Float32Array
    ) {
        super();
        this.splatCount = splatCount;
        this.centers = positions; // Keep reference for CPU sorting
        
        // =====================================================================
        // Step 1: Create Instanced Geometry
        // =====================================================================
        // We create a single quad that will be instanced N times.
        // Each instance represents one Gaussian splat.
        
        this.geometry = new THREE.InstancedBufferGeometry();
        this.geometry.instanceCount = splatCount;
        
        // Define a unit quad centered at origin (corners at ±1)
        // This quad will be scaled/positioned per-instance in the vertex shader
        const corners = new Float32Array([
            -1, -1, 0,   // Bottom-left
             1, -1, 0,   // Bottom-right
             1,  1, 0,   // Top-right
            -1,  1, 0    // Top-left
        ]);
        
        // Three.js requires a 'position' attribute for rendering
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
        
        // Also provide 2D corners for shader calculations
        const corners2d = new Float32Array([
            -1, -1,
             1, -1,
             1,  1,
            -1,  1
        ]);
        this.geometry.setAttribute('splatCorner', new THREE.Float32BufferAttribute(corners2d, 2));
        
        // Define triangle indices (two triangles form the quad)
        this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
        
        // Per-instance attribute: splat index (0 to N-1)
        // This tells each instance which splat's data to fetch from textures
        this.splatIndices = new Float32Array(splatCount);
        for (let i = 0; i < splatCount; i++) {
            this.splatIndices[i] = i;
        }
        this.geometry.setAttribute('splatIndex', new THREE.InstancedBufferAttribute(this.splatIndices, 1));
        
        // =====================================================================
        // Step 2: Create Data Textures
        // =====================================================================
        // Calculate texture dimensions (square-ish to minimize wasted pixels)
        const size = Math.ceil(Math.sqrt(splatCount));
        const width = size;
        const height = Math.ceil(splatCount / width);
        const texSize = width * height;
        
        console.warn(`SplatMesh: Created with ${splatCount} splats, texture size ${width}x${height}`);
        
        // Helper: Pad array to texture size and convert to RGBA format
        const padFloat = (data: Float32Array, stride: number) => {
            const out = new Float32Array(texSize * 4); // Always RGBA
            for (let i = 0; i < splatCount; i++) {
                for (let j = 0; j < stride; j++) {
                    out[i * 4 + j] = data[i * stride + j];
                }
                if (stride === 3) out[i * 4 + 3] = 1.0; // Default alpha
            }
            return out;
        };

        // Helper: Configure texture for optimal lookup performance
        const configureTexture = (tex: THREE.DataTexture) => {
            tex.minFilter = THREE.NearestFilter; // No interpolation
            tex.magFilter = THREE.NearestFilter; // Exact pixel lookup
            tex.generateMipmaps = false;         // Not needed for data
            tex.needsUpdate = true;              // Upload on next render
        };
        
        // Create position texture (RGBA32F)
        this.texPosition = new THREE.DataTexture(
            padFloat(positions, 3), width, height, THREE.RGBAFormat, THREE.FloatType
        );
        this.texPosition.internalFormat = 'RGBA32F';
        configureTexture(this.texPosition);
        
        // Create rotation texture (RGBA32F for quaternion)
        this.texRotation = new THREE.DataTexture(
            padFloat(rotations, 4), width, height, THREE.RGBAFormat, THREE.FloatType
        );
        this.texRotation.internalFormat = 'RGBA32F';
        configureTexture(this.texRotation);
        
        // Create scale texture (RGBA32F)
        this.texScale = new THREE.DataTexture(
            padFloat(scales, 3), width, height, THREE.RGBAFormat, THREE.FloatType
        );
        this.texScale.internalFormat = 'RGBA32F';
        configureTexture(this.texScale);

        // Create color texture (RGBA8 with opacity baked into alpha)
        const colorData = new Uint8Array(texSize * 4);
        for (let i = 0; i < splatCount; i++) {
            colorData[i * 4 + 0] = colors[i * 4 + 0]; // R
            colorData[i * 4 + 1] = colors[i * 4 + 1]; // G
            colorData[i * 4 + 2] = colors[i * 4 + 2]; // B
            // Pack opacity (0-1 float) into alpha channel (0-255 uint8)
            colorData[i * 4 + 3] = Math.floor(opacities[i] * 255);
        }
        this.texColor = new THREE.DataTexture(
            colorData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType
        );
        configureTexture(this.texColor);
        
        // Create skinning textures if animation data provided
        if (skinIndices && skinWeights) {
            // Bone indices (stored as float for texture compatibility)
            const skinIdxData = new Float32Array(texSize * 4);
            for (let i = 0; i < splatCount; i++) {
                skinIdxData[i * 4 + 0] = skinIndices[i * 4 + 0];
                skinIdxData[i * 4 + 1] = skinIndices[i * 4 + 1];
                skinIdxData[i * 4 + 2] = skinIndices[i * 4 + 2];
                skinIdxData[i * 4 + 3] = skinIndices[i * 4 + 3];
            }
            this.texSkinIndices = new THREE.DataTexture(
                skinIdxData, width, height, THREE.RGBAFormat, THREE.FloatType
            );
            configureTexture(this.texSkinIndices);
            
            // Bone weights (already float)
            this.texSkinWeights = new THREE.DataTexture(
                padFloat(skinWeights, 4), width, height, THREE.RGBAFormat, THREE.FloatType
            );
            configureTexture(this.texSkinWeights);
        }

        // =====================================================================
        // Step 3: Create Shader Material
        // =====================================================================
        this.material = new THREE.ShaderMaterial({
            vertexShader: splatVert,
            fragmentShader: splatFrag,
            uniforms: {
                // Data textures
                texPosition: { value: this.texPosition },
                texRotation: { value: this.texRotation },
                texScale: { value: this.texScale },
                texColor: { value: this.texColor },
                texSkinIndices: { value: this.texSkinIndices || null },
                texSkinWeights: { value: this.texSkinWeights || null },
                textureSize: { value: new THREE.Vector2(width, height) },
                
                // Camera/viewport uniforms (updated per-frame)
                viewport: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                focal: { value: new THREE.Vector2(1000, 1000) }, // Focal length in pixels
                
                // Animation uniforms
                boneTexture: { value: null },
                boneTextureSize: { value: 0 },
                useSkinning: { value: !!skinIndices },
                
                // Reserved for future optimization
                useCombinedTextures: { value: false }
            },
            
            // Rendering settings for transparent splats
            depthTest: true,        // Test against depth buffer
            depthWrite: false,      // Don't write to depth (transparent)
            transparent: true,      // Enable alpha blending
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide, // Render both sides
        });
        
        // Disable frustum culling (we handle it in the shader)
        this.frustumCulled = false;
        
        // Pre-allocate sorting arrays
        this.sortIndices = new Int32Array(splatCount);
        this.sortDepths = new Float32Array(splatCount);
        this.sortModelView = new THREE.Matrix4();
        this.sortViewportSize = new THREE.Vector2();
    }
    
    /**
     * Update per-frame uniforms (viewport size, focal length).
     * Called every frame by the render loop.
     * 
     * @param camera - The perspective camera used for rendering
     * @param renderer - The WebGL renderer instance
     */
    update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
        // Update viewport size
        renderer.getSize(this.sortViewportSize);
        this.material.uniforms.viewport.value.copy(this.sortViewportSize);
        
        // Calculate focal length in pixels from field of view
        // focal_y = height / (2 * tan(fov/2))
        const fovRad = camera.fov * Math.PI / 180;
        const fy = this.sortViewportSize.y / (2 * Math.tan(fovRad / 2));
        const fx = fy; // Assume square pixels
        this.material.uniforms.focal.value.set(fx, fy);
        
        // Perform depth sorting if enabled (throttled for performance)
        if (this.sortEnabled) {
            const now = performance.now();
            if (now - this.lastSortTime > this.sortInterval) {
                this.sort(camera);
                this.lastSortTime = now;
            }
        }
    }
    
    /**
     * Enable or disable depth sorting.
     * Sorting ensures correct alpha blending but has CPU overhead.
     * 
     * @param enabled - Whether to enable sorting
     */
    setSortEnabled(enabled: boolean) {
        this.sortEnabled = enabled;
    }
    
    /**
     * Sort splats by depth (back-to-front) for correct alpha blending.
     * This is a CPU-side operation that reorders instance indices.
     * 
     * @param camera - Camera to calculate depth from
     */
    sort(camera: THREE.Camera) {
        // Compute modelView matrix for depth calculation
        const matrixWorld = this.matrixWorld;
        const viewMatrix = camera.matrixWorldInverse;
        this.sortModelView.multiplyMatrices(viewMatrix, matrixWorld);
        
        const count = this.splatCount;
        const indices = this.sortIndices;
        const depths = this.sortDepths;
        const e = this.sortModelView.elements;
        
        // Extract Z row for efficient depth computation (z = m2*x + m6*y + m10*z + m14)
        const m2 = e[2], m6 = e[6], m10 = e[10], m14 = e[14];
        
        // Calculate view-space depth for each splat
        for (let i = 0; i < count; i++) {
            indices[i] = i;
            const x = this.centers[i * 3];
            const y = this.centers[i * 3 + 1];
            const z = this.centers[i * 3 + 2];
            depths[i] = x * m2 + y * m6 + z * m10 + m14;
        }
        
        // Sort indices by depth (ascending = furthest first for alpha blending)
        indices.sort((a, b) => depths[a] - depths[b]);
        
        // Update the instance index buffer
        for (let i = 0; i < count; i++) {
            this.splatIndices[i] = indices[i];
        }
        
        // Mark buffer for GPU upload
        this.geometry.attributes.splatIndex.needsUpdate = true;
    }
}
