/**
 * =============================================================================
 * Shared Type Definitions for 3D Gaussian Splatting Web Engine
 * =============================================================================
 * 
 * This file contains shared TypeScript interfaces used across the application.
 * Centralizing types here ensures consistency and reduces code duplication.
 */

/**
 * Performance monitoring data structure.
 * Used to track real-time rendering performance metrics.
 */
export interface PerformanceData {
    /** Current frames per second (higher is better, target: 60) */
    fps: number;
    
    /** Time taken to render one frame in milliseconds */
    frameTime: number;
    
    /** Memory usage statistics (Chrome-specific APIs) */
    memory: {
        /** Currently used JavaScript heap size in MB */
        usedJSHeap: number;
        /** Total allocated JavaScript heap size in MB */
        totalJSHeap: number;
        /** Number of Three.js geometry objects in memory */
        geometries: number;
        /** Number of Three.js texture objects in memory */
        textures: number;
    };
    
    /** WebGL render statistics */
    render: {
        /** Number of draw calls per frame */
        calls: number;
        /** Total triangles rendered per frame */
        triangles: number;
        /** Total points rendered per frame */
        points: number;
        /** Total lines rendered per frame */
        lines: number;
    };
    
    /** Total number of Gaussian splats being rendered */
    splatCount: number;
}

/**
 * Asset file header information.
 * Loaded from header.json in the converted asset folder.
 */
export interface AssetHeader {
    /** Total number of Gaussian splats in the asset */
    numSplats: number;
    
    /** Number of skeleton bones for skinning animation */
    numBones: number;
    
    /** Total animation frames (0 if no animation) */
    numFrames: number;
    
    /** Axis-aligned bounding box of the asset */
    bounds: {
        /** Minimum corner [x, y, z] */
        min: number[];
        /** Maximum corner [x, y, z] */
        max: number[];
    };
}
