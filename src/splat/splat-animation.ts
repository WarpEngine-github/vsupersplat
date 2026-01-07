import { Mat4 } from 'playcanvas';
import { BinaryGsplatAnimationData } from '../file/loaders/binary-gsplat';
import { TransformPalette } from '../transform/transform-palette';
import { Splat } from './splat';

/**
 * Animation system for PlayCanvas Gaussian Splats
 * 
 * Uses the transformPalette system to apply skeletal animation:
 * - Each bone gets a palette entry (transform matrix)
 * - Each splat references its primary bone via transformTexture
 * - Animation updates bone matrices each frame
 */
export class SplatAnimation {
    splat: Splat;
    animationData: BinaryGsplatAnimationData;
    numFrames: number;
    numBones: number;
    
    currentTime: number = 0;
    frameRate: number = 30;
    isPlaying: boolean = false;
    
    // Bone palette indices (one per bone, starting from palette index 1)
    bonePaletteIndices: Map<number, number> = new Map();
    
    constructor(splat: Splat, animationData: BinaryGsplatAnimationData) {
        this.splat = splat;
        this.animationData = animationData;
        this.numFrames = animationData.animation.numFrames;
        this.numBones = animationData.animation.numBones;
        
        // Allocate palette entries for all bones
        // Index 0 is identity (unused), bones start at 1
        const firstBoneIndex = splat.transformPalette.alloc(this.numBones);
        
        // Map bone index -> palette index
        for (let boneIdx = 0; boneIdx < this.numBones; boneIdx++) {
            this.bonePaletteIndices.set(boneIdx, firstBoneIndex + boneIdx);
        }
        
        // Map splats to their primary bone (highest weight)
        this.setupSplatBoneMapping();
        
        // Set initial pose (frame 0)
        this.setFrame(0);
    }
    
    /**
     * Map each splat to its primary bone (bone with highest weight)
     * This is a simplification - ideally we'd blend multiple bones, but PlayCanvas
     * transformPalette only supports one transform per splat.
     */
    private setupSplatBoneMapping() {
        const { indices, weights } = this.animationData.weights;
        const transformIndices = this.splat.transformTexture.lock() as Uint16Array;
        
        const numSplats = indices.length / 4;
        
        for (let i = 0; i < numSplats; i++) {
            // Find bone with highest weight
            let maxWeight = 0;
            let primaryBoneIdx = 0;
            
            for (let j = 0; j < 4; j++) {
                const weight = weights[i * 4 + j];
                if (weight > maxWeight) {
                    maxWeight = weight;
                    primaryBoneIdx = indices[i * 4 + j];
                }
            }
            
            // Map splat to its primary bone's palette index
            const paletteIndex = this.bonePaletteIndices.get(primaryBoneIdx);
            if (paletteIndex !== undefined) {
                transformIndices[i] = paletteIndex;
            }
        }
        
        this.splat.transformTexture.unlock();
    }
    
    /**
     * Update animation based on elapsed time
     */
    update(deltaTime: number) {
        if (!this.isPlaying) return;
        
        this.currentTime += deltaTime;
        const frameIndex = Math.floor(this.currentTime * this.frameRate) % this.numFrames;
        this.setFrame(frameIndex);
    }
    
    /**
     * Set animation to a specific frame
     * Copies bone matrices for that frame to the transform palette
     */
    setFrame(frameIndex: number) {
        if (frameIndex < 0 || frameIndex >= this.numFrames) return;
        
        const { data } = this.animationData.animation;
        const FLOATS_PER_BONE = 16; // 4×4 matrix
        const frameSize = this.numBones * FLOATS_PER_BONE;
        const offset = frameIndex * frameSize;
        
        const mat = new Mat4();
        const matData = mat.data;
        
        // Update each bone's transform in the palette
        for (let boneIdx = 0; boneIdx < this.numBones; boneIdx++) {
            const boneOffset = offset + boneIdx * FLOATS_PER_BONE;
            
            // Copy 16 floats into Mat4 (column-major order)
            // PlayCanvas Mat4.data is column-major: [m00, m10, m20, m30, m01, m11, ...]
            for (let i = 0; i < 16; i++) {
                matData[i] = data[boneOffset + i];
            }
            
            const paletteIndex = this.bonePaletteIndices.get(boneIdx);
            if (paletteIndex !== undefined) {
                this.splat.transformPalette.setTransform(paletteIndex, mat);
            }
        }
        
        // Trigger position update so splats reflect new bone transforms
        this.splat.updatePositions();
    }
    
    play() {
        this.isPlaying = true;
    }
    
    pause() {
        this.isPlaying = false;
    }
    
    seek(time: number) {
        this.currentTime = time;
        const frameIndex = Math.floor(this.currentTime * this.frameRate) % this.numFrames;
        this.setFrame(frameIndex);
    }
}

