import { Mat4 } from 'playcanvas';
import { BinaryGsplatAnimationData } from '../file/loaders/binary-gsplat';
import { Events } from '../events';
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
    
    // Bone palette indices (one per bone, starting from palette index 1)
    bonePaletteIndices: Map<number, number> = new Map();
    
    // Timeline event handlers
    private timelineTimeHandle: any = null;
    private timelineFrameHandle: any = null;
    
    constructor(splat: Splat, animationData: BinaryGsplatAnimationData, events: Events) {
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
        
        // Helper function to update animation frame from timeline frame/time
        const updateFromTimeline = (timelineValue: number) => {
            // Convert timeline frames to time in seconds, then to animation frames
            // This ensures animation plays at correct speed regardless of timeline length
            const timelineFrameRate = events.invoke('timeline.frameRate') as number || 30;
            const animationFrameRate = 30; // Assume animation is also 30 FPS (standard)
            
            // Convert timeline frames to seconds
            const timeInSeconds = timelineValue / timelineFrameRate;
            
            // Convert seconds to animation frame (1:1 mapping if same frame rate)
            // Clamp to animation bounds instead of looping
            const frameIndex = Math.min(
                Math.floor(timeInSeconds * animationFrameRate),
                this.numFrames - 1
            );
            this.setFrame(frameIndex);
        };
        
        // Listen to timeline.time (fires during playback)
        this.timelineTimeHandle = events.on('timeline.time', (time: number) => {
            updateFromTimeline(time);
        });
        
        // Also listen to timeline.frame (fires when scrubbing/dragging timeline)
        this.timelineFrameHandle = events.on('timeline.frame', (frame: number) => {
            updateFromTimeline(frame);
        });
        
        // Set initial frame based on current timeline position
        const currentTimelineFrame = events.invoke('timeline.frame') as number || 0;
        const timelineFrameRate = events.invoke('timeline.frameRate') as number || 30;
        const animationFrameRate = 30; // Assume animation is also 30 FPS
        const timeInSeconds = currentTimelineFrame / timelineFrameRate;
        const initialFrame = Math.min(
            Math.floor(timeInSeconds * animationFrameRate),
            this.numFrames - 1
        );
        this.setFrame(initialFrame);
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
     * Set animation to a specific frame
     * Copies bone matrices for that frame to the transform palette
     * Called automatically by timeline.time event listener
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
    
    /**
     * Clean up event handlers
     */
    destroy() {
        if (this.timelineTimeHandle) {
            this.timelineTimeHandle.off();
            this.timelineTimeHandle = null;
        }
        if (this.timelineFrameHandle) {
            this.timelineFrameHandle.off();
            this.timelineFrameHandle = null;
        }
    }
}

