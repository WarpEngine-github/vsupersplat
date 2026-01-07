/**
 * =============================================================================
 * SplatLoader - 3D Gaussian Splatting Asset Loader
 * =============================================================================
 * 
 * OVERVIEW:
 * This module handles loading pre-converted 3D Gaussian Splatting (3DGS) assets
 * from binary files and creates renderable mesh objects.
 * 
 * DATA FLOW:
 * 
 *   [Python Converter]     [Binary Files]        [SplatLoader]        [Three.js]
 *   ──────────────────────────────────────────────────────────────────────────────
 *   
 *   Original .pkl file  →  header.json    ┐
 *   (from 3DGS training)   splats.bin     ├──→  SplatLoader.load()  →  SplatMesh
 *                          weights.bin    │         ↓
 *                          animation.bin  ┘    SplatAsset object
 * 
 * FILE FORMAT (produced by scripts/converter.py):
 * 
 *   header.json:
 *     - numSplats: Total number of Gaussian primitives
 *     - numBones: Skeleton bone count for animation
 *     - numFrames: Animation frame count
 *     - bounds: Axis-aligned bounding box {min, max}
 * 
 *   splats.bin (48 bytes per splat, interleaved):
 *     - Position (3 x float32 = 12 bytes): Center of Gaussian in 3D space
 *     - Scale (3 x float32 = 12 bytes): Size along each axis
 *     - Rotation (4 x float32 = 16 bytes): Quaternion (x, y, z, w)
 *     - Color (4 x uint8 = 4 bytes): RGBA color
 *     - Opacity (1 x float32 = 4 bytes): Alpha value [0, 1]
 * 
 *   weights.bin (24 bytes per splat):
 *     - Bone Indices (4 x uint16 = 8 bytes): Top 4 influencing bones
 *     - Bone Weights (4 x float32 = 16 bytes): Normalized weights
 * 
 *   animation.bin (16 floats per bone per frame):
 *     - 4x4 transformation matrices in column-major order
 * 
 * 3D GAUSSIAN SPLATTING BASICS:
 * 
 *   Each "splat" represents a 3D Gaussian distribution:
 *   
 *   G(x) = exp(-0.5 * (x - μ)ᵀ Σ⁻¹ (x - μ))
 *   
 *   Where:
 *     - μ (mu): Mean position (center of the Gaussian)
 *     - Σ (Sigma): 3x3 covariance matrix (shape/orientation)
 *   
 *   The covariance Σ is decomposed into:
 *     Σ = R * S * Sᵀ * Rᵀ
 *   
 *   Where:
 *     - R: Rotation matrix (from quaternion)
 *     - S: Diagonal scale matrix
 *   
 *   This allows efficient storage and GPU computation.
 */

import * as THREE from 'three';
import { SplatMesh } from './SplatMesh';
import type { AssetHeader } from '../types';

/**
 * Complete loaded asset containing mesh, metadata, and animation data.
 */
export interface SplatAsset {
    /** The renderable Three.js mesh with GPU-ready splat data */
    mesh: SplatMesh;
    
    /** Asset metadata (splat count, bone count, bounds, etc.) */
    header: AssetHeader;
    
    /** Raw animation data (bone matrices for all frames), null if static */
    animationData: Float32Array | null;
}

/**
 * Map of filename to URL for loading from dropped files.
 * Key: filename (e.g., "header.json")
 * Value: blob URL or fetch URL
 */
export type FileMap = Map<string, string>;

/**
 * SplatLoader Class
 * 
 * Responsible for loading and parsing 3DGS asset files into GPU-ready format.
 * 
 * Usage:
 *   const loader = new SplatLoader();
 *   const asset = await loader.load('/assets');
 *   scene.add(asset.mesh);
 */
export class SplatLoader {
    /**
     * Load a 3DGS asset from a directory or file map.
     * 
     * @param url - Base URL path to asset directory (e.g., '/assets')
     * @param fileMap - Optional map for loading from drag-dropped files
     * @returns Promise resolving to loaded SplatAsset
     * 
     * @example
     * // Load from server
     * const asset = await loader.load('/assets/character');
     * 
     * @example
     * // Load from dropped files
     * const fileMap = new Map();
     * fileMap.set('header.json', URL.createObjectURL(headerFile));
     * const asset = await loader.load('', fileMap);
     */
    async load(url: string, fileMap?: FileMap): Promise<SplatAsset> {
        const basePath = url.replace(/\/$/, '');
        console.warn(`Loading splat from ${basePath}...`);
        
        // Helper function to fetch files from URL or FileMap
        const fetchFile = async (name: string) => {
            if (fileMap && fileMap.has(name)) {
                return fetch(fileMap.get(name)!);
            }
            return fetch(`${basePath}/${name}`);
        };
        
        // =====================================================================
        // Step 1: Load Header (metadata)
        // =====================================================================
        const headerRes = await fetchFile('header.json');
        const header = await headerRes.json() as AssetHeader;
        
        console.warn(`Header: ${header.numSplats} splats, ${header.numBones} bones`);
        
        // =====================================================================
        // Step 2: Load and Parse Splat Data
        // =====================================================================
        const splatsRes = await fetchFile('splats.bin');
        const splatsBuffer = await splatsRes.arrayBuffer();
        
        // Binary layout per splat (48 bytes total):
        // | Offset | Size | Type    | Field    |
        // |--------|------|---------|----------|
        // | 0      | 12   | 3xf32   | Position |
        // | 12     | 12   | 3xf32   | Scale    |
        // | 24     | 16   | 4xf32   | Rotation |
        // | 40     | 4    | 4xu8    | Color    |
        // | 44     | 4    | 1xf32   | Opacity  |
        const numSplats = header.numSplats;
        const SPLAT_STRIDE = 48; // bytes per splat
        
        if (splatsBuffer.byteLength !== numSplats * SPLAT_STRIDE) {
            console.warn(`Splat buffer size mismatch! Expected ${numSplats * SPLAT_STRIDE}, got ${splatsBuffer.byteLength}`);
        }
        
        const splatData = new DataView(splatsBuffer);
        
        // Allocate typed arrays for each attribute
        const positions = new Float32Array(numSplats * 3);  // xyz per splat
        const scales = new Float32Array(numSplats * 3);     // xyz scale per splat
        const rotations = new Float32Array(numSplats * 4);  // quaternion (xyzw)
        const colors = new Uint8Array(numSplats * 4);       // RGBA (0-255)
        const opacities = new Float32Array(numSplats);      // alpha (0-1)
        
        let offset = 0;
        const littleEndian = true; // Binary files use little-endian format
        
        // Parse interleaved data for each splat
        for (let i = 0; i < numSplats; i++) {
            // Position (12 bytes)
            positions[i * 3 + 0] = splatData.getFloat32(offset + 0, littleEndian);
            positions[i * 3 + 1] = splatData.getFloat32(offset + 4, littleEndian);
            positions[i * 3 + 2] = splatData.getFloat32(offset + 8, littleEndian);
            offset += 12;
            
            // Scale (12 bytes) - eigenvalues of covariance matrix
            scales[i * 3 + 0] = splatData.getFloat32(offset + 0, littleEndian);
            scales[i * 3 + 1] = splatData.getFloat32(offset + 4, littleEndian);
            scales[i * 3 + 2] = splatData.getFloat32(offset + 8, littleEndian);
            offset += 12;
            
            // Rotation quaternion (16 bytes) - eigenvectors of covariance
            rotations[i * 4 + 0] = splatData.getFloat32(offset + 0, littleEndian);
            rotations[i * 4 + 1] = splatData.getFloat32(offset + 4, littleEndian);
            rotations[i * 4 + 2] = splatData.getFloat32(offset + 8, littleEndian);
            rotations[i * 4 + 3] = splatData.getFloat32(offset + 12, littleEndian);
            offset += 16;
            
            // Color RGBA (4 bytes)
            colors[i * 4 + 0] = splatData.getUint8(offset + 0); // R
            colors[i * 4 + 1] = splatData.getUint8(offset + 1); // G
            colors[i * 4 + 2] = splatData.getUint8(offset + 2); // B
            colors[i * 4 + 3] = splatData.getUint8(offset + 3); // A (unused, see opacity)
            offset += 4;
            
            // Opacity (4 bytes) - separate from color alpha for precision
            opacities[i] = splatData.getFloat32(offset + 0, littleEndian);
            offset += 4;
        }
        
        // =====================================================================
        // Step 3: Load Skinning Weights (for skeletal animation)
        // =====================================================================
        let skinIndices: Uint16Array | undefined;
        let skinWeights: Float32Array | undefined;
        
        try {
            const weightsRes = await fetchFile('weights.bin');
            if (weightsRes.ok) {
                const weightsBuffer = await weightsRes.arrayBuffer();
                
                // Binary layout per splat (24 bytes total):
                // | Offset | Size | Type    | Field        |
                // |--------|------|---------|--------------|
                // | 0      | 8    | 4xu16   | Bone Indices |
                // | 8      | 16   | 4xf32   | Bone Weights |
                const WEIGHT_STRIDE = 24;
                const weightData = new DataView(weightsBuffer);
                
                skinIndices = new Uint16Array(numSplats * 4);
                skinWeights = new Float32Array(numSplats * 4);
                
                offset = 0;
                for (let i = 0; i < numSplats; i++) {
                    // Top 4 bone indices
                    skinIndices[i * 4 + 0] = weightData.getUint16(offset + 0, littleEndian);
                    skinIndices[i * 4 + 1] = weightData.getUint16(offset + 2, littleEndian);
                    skinIndices[i * 4 + 2] = weightData.getUint16(offset + 4, littleEndian);
                    skinIndices[i * 4 + 3] = weightData.getUint16(offset + 6, littleEndian);
                    offset += 8;
                    
                    // Normalized bone weights (sum to 1.0)
                    skinWeights[i * 4 + 0] = weightData.getFloat32(offset + 0, littleEndian);
                    skinWeights[i * 4 + 1] = weightData.getFloat32(offset + 4, littleEndian);
                    skinWeights[i * 4 + 2] = weightData.getFloat32(offset + 8, littleEndian);
                    skinWeights[i * 4 + 3] = weightData.getFloat32(offset + 12, littleEndian);
                    offset += 16;
                }
            }
        } catch (e) {
            console.warn("No weights found or error loading weights", e);
        }
        
        // =====================================================================
        // Step 4: Create SplatMesh (GPU-ready representation)
        // =====================================================================
        const mesh = new SplatMesh(
            numSplats,
            positions,
            rotations,
            scales,
            colors,
            opacities,
            skinIndices,
            skinWeights
        );

        // =====================================================================
        // Step 5: Load Animation Data (bone transforms per frame)
        // =====================================================================
        let animationData: Float32Array | null = null;
        try {
            const animRes = await fetchFile('animation.bin');
            if (animRes.ok) {
                const animBuffer = await animRes.arrayBuffer();
                // Layout: [Frame][Bone][16 floats] - 4x4 column-major matrices
                animationData = new Float32Array(animBuffer);
            }
        } catch(e) {
            console.warn("No animation found", e);
        }
        
        return { mesh, header, animationData };
    }
}
