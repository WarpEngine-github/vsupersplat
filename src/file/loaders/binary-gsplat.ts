import { GSplatData } from 'playcanvas';

import { AssetSource, createReadSource } from './asset-source';

/**
 * Asset header structure from header.json
 */
interface AssetHeader {
    numSplats: number;
    numBones: number;
    numFrames: number;
    bounds: {
        min: number[];
        max: number[];
    };
}

/**
 * Animation data structure
 */
interface BinaryGsplatAnimationData {
    weights: {
        indices: Uint16Array;  // 4 bone indices per splat
        weights: Float32Array;  // 4 bone weights per splat
    };
    animation: {
        data: Float32Array;     // All frames: numFrames × numBones × 16 floats
        numFrames: number;
        numBones: number;
    };
}

/**
 * Result structure containing both GSplatData and optional animation data
 */
interface BinaryGsplatResult {
    gsplatData: GSplatData;
    animationData?: BinaryGsplatAnimationData;
    header: AssetHeader;
}

/**
 * Load binary Gaussian splat format (header.json + splats.bin)
 * 
 * Binary format (48 bytes per splat):
 * - Position: 3 x float32 (12 bytes)
 * - Scale: 3 x float32 (12 bytes) - linear scales
 * - Rotation: 4 x float32 (16 bytes) - quaternion (x, y, z, w)
 * - Color: 4 x uint8 (4 bytes) - RGBA
 * - Opacity: 1 x float32 (4 bytes) - linear opacity [0, 1]
 */
const loadBinaryGsplat = async (assetSource: AssetSource): Promise<BinaryGsplatResult> => {
    // Helper to get base path from URL or filename
    const getBasePath = () => {
        // Prefer filename over URL for path extraction (more reliable)
        if (assetSource.filename) {
            const lastSlash = assetSource.filename.lastIndexOf('/');
            if (lastSlash >= 0) {
                return assetSource.filename.substring(0, lastSlash);
            }
            // If filename has no path, try to extract from URL
        }
        if (assetSource.url) {
            // Skip blob URLs (object URLs) - they don't have meaningful paths
            if (assetSource.url.startsWith('blob:')) {
                // For blob URLs, use filename if available, otherwise default
                return assetSource.filename ? 
                    assetSource.filename.substring(0, assetSource.filename.lastIndexOf('/')) || '/gs/assets/converted' :
                    '/gs/assets/converted';
            }
            // Remove filename from URL to get directory
            try {
                const url = new URL(assetSource.url, window.location.href);
                const pathname = url.pathname;
                const lastSlash = pathname.lastIndexOf('/');
                if (lastSlash >= 0) {
                    return pathname.substring(0, lastSlash);
                }
            } catch (e) {
                // If URL parsing fails, fall through to default
            }
        }
        return '/gs/assets/converted';
    };

    const basePath = getBasePath();
    
    // Helper to fetch files
    const fetchFile = async (filename: string): Promise<ArrayBuffer> => {
        // Check if we have a mapFile function (for drag-drop scenarios)
        if (assetSource.mapFile) {
            const fileSource = assetSource.mapFile(filename);
            if (fileSource) {
                const source = await createReadSource(fileSource);
                return await source.arrayBuffer();
            }
            // If mapFile doesn't find it, try URL fallback
        }
        
        // Fetch from URL (either provided URL or constructed from basePath)
        let url: string;
        if (assetSource.url && filename === 'header.json') {
            // Use the provided URL directly for header.json
            url = assetSource.url;
        } else {
            // Construct absolute URL from basePath to ensure proper resolution
            const fullPath = `${basePath}/${filename}`;
            url = new URL(fullPath, window.location.href).href;
        }
        
        console.log(`[loadBinaryGsplat] Fetching ${filename}:`, {
            basePath,
            fullPath: `${basePath}/${filename}`,
            url,
            assetSourceUrl: assetSource.url,
            assetSourceFilename: assetSource.filename,
            hasMapFile: !!assetSource.mapFile
        });
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load ${filename}: ${response.statusText} (tried: ${url})`);
        }
        return await response.arrayBuffer();
    };

    // Step 1: Load header.json
    const headerBuffer = await fetchFile('header.json');
    const headerText = new TextDecoder().decode(headerBuffer);
    const header: AssetHeader = JSON.parse(headerText);
    
    const numSplats = header.numSplats;
    console.log(`Loading binary splat: ${numSplats} splats from ${basePath}`);

    // Step 2: Load splats.bin
    const splatsBuffer = await fetchFile('splats.bin');
    const SPLAT_STRIDE = 48; // bytes per splat
    
    if (splatsBuffer.byteLength !== numSplats * SPLAT_STRIDE) {
        console.warn(`Splat buffer size mismatch! Expected ${numSplats * SPLAT_STRIDE}, got ${splatsBuffer.byteLength}`);
    }

    const splatData = new DataView(splatsBuffer);

    // Allocate typed arrays for PlayCanvas GSplatData format
    const storage_x = new Float32Array(numSplats);
    const storage_y = new Float32Array(numSplats);
    const storage_z = new Float32Array(numSplats);
    const storage_scale_0 = new Float32Array(numSplats);
    const storage_scale_1 = new Float32Array(numSplats);
    const storage_scale_2 = new Float32Array(numSplats);
    const storage_rot_0 = new Float32Array(numSplats);
    const storage_rot_1 = new Float32Array(numSplats);
    const storage_rot_2 = new Float32Array(numSplats);
    const storage_rot_3 = new Float32Array(numSplats);
    const storage_f_dc_0 = new Float32Array(numSplats);
    const storage_f_dc_1 = new Float32Array(numSplats);
    const storage_f_dc_2 = new Float32Array(numSplats);
    const storage_opacity = new Float32Array(numSplats);
    const storage_state = new Uint8Array(numSplats);

    // Spherical harmonics constant for color conversion
    const SH_C0 = 0.28209479177387814;
    const littleEndian = true;

    // Step 3: Parse binary data and convert to PlayCanvas format
    let offset = 0;
    for (let i = 0; i < numSplats; i++) {
        // Position (12 bytes) - direct copy
        storage_x[i] = splatData.getFloat32(offset + 0, littleEndian);
        storage_y[i] = splatData.getFloat32(offset + 4, littleEndian);
        storage_z[i] = splatData.getFloat32(offset + 8, littleEndian);
        offset += 12;

        // Scale (12 bytes) - convert linear to log scale
        const scaleX = splatData.getFloat32(offset + 0, littleEndian);
        const scaleY = splatData.getFloat32(offset + 4, littleEndian);
        const scaleZ = splatData.getFloat32(offset + 8, littleEndian);
        storage_scale_0[i] = Math.log(Math.max(scaleX, 1e-8)); // Clamp to avoid log(0)
        storage_scale_1[i] = Math.log(Math.max(scaleY, 1e-8));
        storage_scale_2[i] = Math.log(Math.max(scaleZ, 1e-8));
        offset += 12;

        // Rotation quaternion (16 bytes) - direct copy (already normalized)
        storage_rot_0[i] = splatData.getFloat32(offset + 0, littleEndian);
        storage_rot_1[i] = splatData.getFloat32(offset + 4, littleEndian);
        storage_rot_2[i] = splatData.getFloat32(offset + 8, littleEndian);
        storage_rot_3[i] = splatData.getFloat32(offset + 12, littleEndian);
        offset += 16;

        // Color RGBA (4 bytes) - convert uint8 to spherical harmonics
        const r = splatData.getUint8(offset + 0);
        const g = splatData.getUint8(offset + 1);
        const b = splatData.getUint8(offset + 2);
        // Convert RGB [0-255] to spherical harmonics f_dc_0/1/2
        // Formula: (value / 255 - 0.5) / SH_C0
        storage_f_dc_0[i] = (r / 255 - 0.5) / SH_C0;
        storage_f_dc_1[i] = (g / 255 - 0.5) / SH_C0;
        storage_f_dc_2[i] = (b / 255 - 0.5) / SH_C0;
        offset += 4;

        // Opacity (4 bytes) - convert linear [0,1] to log opacity
        const opacity = splatData.getFloat32(offset + 0, littleEndian);
        // Clamp opacity to valid range and convert to log space
        // Formula: -log(1 / opacity - 1) for sigmoid inverse
        const clampedOpacity = Math.max(0.0001, Math.min(0.9999, opacity));
        storage_opacity[i] = -Math.log(1 / clampedOpacity - 1);
        offset += 4;
    }

    // Step 4: Create GSplatData object
    const gsplatData = new GSplatData([{
        name: 'vertex',
        count: numSplats,
        properties: [
            { type: 'float', name: 'x', storage: storage_x, byteSize: 4 },
            { type: 'float', name: 'y', storage: storage_y, byteSize: 4 },
            { type: 'float', name: 'z', storage: storage_z, byteSize: 4 },
            { type: 'float', name: 'opacity', storage: storage_opacity, byteSize: 4 },
            { type: 'float', name: 'rot_0', storage: storage_rot_0, byteSize: 4 },
            { type: 'float', name: 'rot_1', storage: storage_rot_1, byteSize: 4 },
            { type: 'float', name: 'rot_2', storage: storage_rot_2, byteSize: 4 },
            { type: 'float', name: 'rot_3', storage: storage_rot_3, byteSize: 4 },
            { type: 'float', name: 'f_dc_0', storage: storage_f_dc_0, byteSize: 4 },
            { type: 'float', name: 'f_dc_1', storage: storage_f_dc_1, byteSize: 4 },
            { type: 'float', name: 'f_dc_2', storage: storage_f_dc_2, byteSize: 4 },
            { type: 'float', name: 'scale_0', storage: storage_scale_0, byteSize: 4 },
            { type: 'float', name: 'scale_1', storage: storage_scale_1, byteSize: 4 },
            { type: 'float', name: 'scale_2', storage: storage_scale_2, byteSize: 4 },
            { type: 'float', name: 'state', storage: storage_state, byteSize: 4 }
        ]
    }]);

    // Step 5: Load animation data if available
    let animationData: BinaryGsplatAnimationData | undefined;
    
    if (header.numBones > 0 && header.numFrames > 0) {
        try {
            // Load weights.bin (24 bytes per splat: 4×uint16 indices + 4×float32 weights)
            const weightsBuffer = await fetchFile('weights.bin');
            const WEIGHT_STRIDE = 24; // bytes per splat
            
            if (weightsBuffer.byteLength !== numSplats * WEIGHT_STRIDE) {
                console.warn(`Weights buffer size mismatch! Expected ${numSplats * WEIGHT_STRIDE}, got ${weightsBuffer.byteLength}`);
            }

            const weightsData = new DataView(weightsBuffer);
            const boneIndices = new Uint16Array(numSplats * 4);
            const boneWeights = new Float32Array(numSplats * 4);
            
            let weightsOffset = 0;
            for (let i = 0; i < numSplats; i++) {
                // Bone indices (8 bytes: 4×uint16)
                for (let j = 0; j < 4; j++) {
                    boneIndices[i * 4 + j] = weightsData.getUint16(weightsOffset + j * 2, littleEndian);
                }
                weightsOffset += 8;
                
                // Bone weights (16 bytes: 4×float32)
                for (let j = 0; j < 4; j++) {
                    boneWeights[i * 4 + j] = weightsData.getFloat32(weightsOffset + j * 4, littleEndian);
                }
                weightsOffset += 16;
            }

            // Load animation.bin (16 floats × numBones × numFrames)
            const animationBuffer = await fetchFile('animation.bin');
            const FLOATS_PER_BONE = 16; // 4×4 matrix
            const expectedSize = header.numFrames * header.numBones * FLOATS_PER_BONE * 4; // 4 bytes per float
            
            if (animationBuffer.byteLength !== expectedSize) {
                console.warn(`Animation buffer size mismatch! Expected ${expectedSize}, got ${animationBuffer.byteLength}`);
            }

            const animationArray = new Float32Array(animationBuffer);

            animationData = {
                weights: {
                    indices: boneIndices,
                    weights: boneWeights
                },
                animation: {
                    data: animationArray,
                    numFrames: header.numFrames,
                    numBones: header.numBones
                }
            };

            console.log(`Loaded animation: ${header.numFrames} frames, ${header.numBones} bones`);
        } catch (error) {
            console.warn('Failed to load animation data:', error);
            // Continue without animation
        }
    }

    return {
        gsplatData,
        animationData,
        header
    };
};

export { loadBinaryGsplat };
export type { BinaryGsplatAnimationData, BinaryGsplatResult };

