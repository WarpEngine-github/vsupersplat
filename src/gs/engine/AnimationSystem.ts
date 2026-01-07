/**
 * =============================================================================
 * AnimationSystem - Skeletal Animation for 3D Gaussian Splats
 * =============================================================================
 * 
 * OVERVIEW:
 * This module handles skeletal animation by updating bone transformation
 * matrices and uploading them to the GPU for skinning calculations.
 * 
 * HOW SKELETAL ANIMATION WORKS:
 * 
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │ SKINNING = Deforming mesh based on skeleton movement                    │
 *   └─────────────────────────────────────────────────────────────────────────┘
 * 
 *   1. SKELETON: A hierarchy of "bones" (transform nodes)
 *   
 *      Root ─┬─ Spine ─┬─ Neck ─── Head
 *            │         │
 *            │         └─ L.Arm ─── L.Hand
 *            │
 *            └─ R.Leg ─── R.Foot
 * 
 *   2. SKINNING WEIGHTS: Each splat is influenced by up to 4 bones
 *   
 *      Splat A (on shoulder):
 *        Bone 0 (Spine):  0.5   ─┐
 *        Bone 1 (L.Arm):  0.3    ├── Sum = 1.0
 *        Bone 2 (Neck):   0.2   ─┘
 *        Bone 3 (unused): 0.0
 * 
 *   3. FINAL POSITION: Weighted blend of bone transforms
 *   
 *      P_final = Σ (weight_i × BoneMatrix_i × P_rest)
 * 
 * ANIMATION DATA LAYOUT:
 * 
 *   animation.bin structure:
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ Frame 0                                                          │
 *   │   Bone 0: [m00 m01 m02 m03 m10 m11 m12 m13 m20 ... m33] (16 f32) │
 *   │   Bone 1: [m00 m01 m02 m03 m10 m11 m12 m13 m20 ... m33] (16 f32) │
 *   │   ...                                                            │
 *   │   Bone N: [m00 m01 m02 m03 m10 m11 m12 m13 m20 ... m33] (16 f32) │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │ Frame 1                                                          │
 *   │   ...                                                            │
 *   └───────────────────────────────────────────────────────────────────┘
 * 
 *   Total size: numFrames × numBones × 16 × sizeof(float32)
 * 
 * BONE TEXTURE FORMAT:
 * 
 *   To pass 441 bone matrices to the GPU, we use a DataTexture:
 *   
 *   Width = numBones × 4 pixels (each bone needs 4 RGBA pixels for 16 floats)
 *   Height = 1
 *   
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ Bone0   │ Bone0   │ Bone0   │ Bone0   │ Bone1   │ ...              │
 *   │ col0    │ col1    │ col2    │ col3    │ col0    │                  │
 *   │ (RGBA)  │ (RGBA)  │ (RGBA)  │ (RGBA)  │ (RGBA)  │                  │
 *   └────────────────────────────────────────────────────────────────────┘
 *   
 *   Each RGBA pixel stores one column of the 4×4 matrix.
 *   Shader reads: boneMatrix[i] = mat4(tex[i*4], tex[i*4+1], tex[i*4+2], tex[i*4+3])
 */

import * as THREE from 'three';
import { SplatMesh } from './SplatMesh';

/**
 * AnimationSystem Class
 * 
 * Manages playback of skeletal animations for Gaussian Splat meshes.
 * Updates bone transformation matrices each frame and uploads to GPU.
 */
export class AnimationSystem {
    /** Reference to the SplatMesh being animated */
    mesh: SplatMesh;
    
    /** Raw animation data (all frames, all bones, all matrix elements) */
    data: Float32Array;
    
    /** Total number of animation frames */
    numFrames: number;
    
    /** Number of bones in the skeleton */
    numBones: number;
    
    /** Current playback time in seconds */
    currentTime: number = 0;
    
    /** Animation playback rate (frames per second) */
    frameRate: number = 30;
    
    /** Whether animation is currently playing */
    isPlaying: boolean = false;
    
    /** GPU texture containing current frame's bone matrices */
    boneTexture: THREE.DataTexture;
    
    /**
     * Create a new AnimationSystem.
     * 
     * @param mesh - The SplatMesh to animate
     * @param data - Raw animation data (Float32Array from animation.bin)
     * @param numFrames - Number of animation frames
     * @param numBones - Number of skeleton bones
     * 
     * @example
     * const anim = new AnimationSystem(mesh, animData, 975, 441);
     * anim.play();
     */
    constructor(mesh: SplatMesh, data: Float32Array, numFrames: number, numBones: number) {
        this.mesh = mesh;
        this.data = data;
        this.numFrames = numFrames;
        this.numBones = numBones;
        
        // =====================================================================
        // Create Bone Texture
        // =====================================================================
        // Each bone needs 16 floats (4×4 matrix), stored as 4 RGBA pixels
        // Texture width = numBones × 4, height = 1
        const width = numBones * 4;
        const height = 1;
        const textureData = new Float32Array(width * height * 4);
        
        this.boneTexture = new THREE.DataTexture(
            textureData, width, height, THREE.RGBAFormat, THREE.FloatType
        );
        this.boneTexture.minFilter = THREE.NearestFilter;
        this.boneTexture.magFilter = THREE.NearestFilter;
        this.boneTexture.generateMipmaps = false;
        this.boneTexture.needsUpdate = true;
        
        // Connect bone texture to mesh material
        this.mesh.material.uniforms.boneTexture.value = this.boneTexture;
        this.mesh.material.uniforms.boneTextureSize.value = width;
        this.mesh.material.uniforms.useSkinning.value = true;
        
        // Set initial pose (frame 0)
        this.setFrame(0);
    }
    
    /**
     * Update animation based on elapsed time.
     * Called every frame by the render loop when animation is playing.
     * 
     * @param delta - Time elapsed since last frame in seconds
     */
    update(delta: number) {
        if (!this.isPlaying) return;
        
        // Advance time and calculate current frame
        this.currentTime += delta;
        const frameIndex = Math.floor(this.currentTime * this.frameRate) % this.numFrames;
        this.setFrame(frameIndex);
    }
    
    /**
     * Set the animation to a specific frame.
     * Copies bone matrices for that frame to the GPU texture.
     * 
     * @param frameIndex - Frame number (0 to numFrames-1)
     */
    setFrame(frameIndex: number) {
        if (frameIndex < 0 || frameIndex >= this.numFrames) return;
        
        // Calculate byte offset in animation data
        // Layout: data[frame][bone][16 floats]
        const FLOATS_PER_BONE = 16;  // 4×4 matrix
        const frameSize = this.numBones * FLOATS_PER_BONE;
        const offset = frameIndex * frameSize;
        
        // Get reference to texture's internal data buffer
        const texData = this.boneTexture.image.data as Float32Array;
        
        // Copy frame data directly (texture layout matches animation layout)
        const frameData = this.data.subarray(offset, offset + frameSize);
        texData.set(frameData);
        
        // Mark texture for GPU upload
        this.boneTexture.needsUpdate = true;
    }
    
    /**
     * Start animation playback.
     */
    play() {
        this.isPlaying = true;
    }
    
    /**
     * Pause animation playback.
     */
    pause() {
        this.isPlaying = false;
    }
    
    /**
     * Seek to a specific time in the animation.
     * 
     * @param time - Time in seconds
     */
    seek(time: number) {
        this.currentTime = time;
        const frameIndex = Math.floor(this.currentTime * this.frameRate) % this.numFrames;
        this.setFrame(frameIndex);
    }
}
