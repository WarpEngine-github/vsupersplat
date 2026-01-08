import { Mat4, Quat, Vec3 } from 'playcanvas';

import { BinaryGsplatAnimationData } from '../file/loaders/binary-gsplat';
import { Events } from '../events';
import { TransformPalette } from '../transform/transform-palette';
import { Splat } from './splat';
import { SphereShape } from '../shapes/sphere-shape';

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
    
    // Bone visualization spheres
    boneSpheres: SphereShape[] = [];
    
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
        // TEMPORARILY DISABLED: Comment out the line below to disable bone mapping (keeps transform indices at 0)
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
        
        // Visualize bones as spheres
        this.visualizeBones();
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
        // return;
        if (frameIndex < 0 || frameIndex >= this.numFrames) return;
        
        // TEST: Restore correct transform indices but fill all bone matrices with identity
        // First, restore the bone mapping (this was commented out in constructor)
        this.setupSplatBoneMapping();
        
        // TEST: Transform only head bone (bone index 9)
        const headBoneIdx = 9; // "head" bone from skeleton names
        const yOffset = frameIndex * 0.1;
        
        // Fill all bones with identity first
        const identityMat = new Mat4();
        for (let boneIdx = 0; boneIdx < this.numBones; boneIdx++) {
            const paletteIndex = this.bonePaletteIndices.get(boneIdx);
            if (paletteIndex !== undefined) {
                this.splat.transformPalette.setTransform(paletteIndex, identityMat);
            }
        }
        
        // Apply upward translation only to head bone
        const headMat = new Mat4();
        headMat.setTranslate(0, yOffset, 0);
        const headPaletteIndex = this.bonePaletteIndices.get(headBoneIdx);
        if (headPaletteIndex !== undefined) {
            this.splat.transformPalette.setTransform(headPaletteIndex, headMat);
        }
        
        // Trigger position update so splats reflect the transforms
        this.splat.updatePositions();
    }
    
    /**
     * Visualize all bones as spheres using std_male A-pose data
     * Traverses bone hierarchy to calculate world transforms
     */
    visualizeBones() {
        // Clear existing spheres
        this.clearBoneVisualization();
        
        if (!this.splat.scene) {
            console.warn('Cannot visualize bones: splat not added to scene');
            return;
        }
        
        // Check for required std_male data
        if (!this.animationData.stdMaleRestTranslations || 
            !this.animationData.stdMaleRestRotations || 
            !this.animationData.stdMaleParents) {
            console.warn('Cannot visualize bones: std_male skeleton data not available (need restTranslations, restRotations, and parents)');
            return;
        }
        
        const restTranslations = this.animationData.stdMaleRestTranslations;
        const restRotations = this.animationData.stdMaleRestRotations;
        const parents = this.animationData.stdMaleParents;
        const numBones = restTranslations.length / 3;
        
        if (numBones !== this.numBones || numBones !== parents.length) {
            console.warn(`Bone count mismatch: ${numBones} std_male bones vs ${this.numBones} animation bones`);
        }
        
        // Calculate world transforms by traversing hierarchy
        const worldTransforms = new Array<Mat4>(numBones);
        const bonePos = new Vec3();
        
        // Find root bones (parent = -1)
        const rootBones: number[] = [];
        for (let i = 0; i < numBones; i++) {
            if (parents[i] === -1) {
                rootBones.push(i);
            }
        }
        
        if (rootBones.length === 0) {
            console.warn('No root bone found (parent = -1), assuming bone 0 is root');
            rootBones.push(0);
        }
        
        // Helper to create transform matrix from translation and rotation quaternion
        const createLocalTransform = (boneIdx: number): Mat4 => {
            const tx = restTranslations[boneIdx * 3 + 0];
            const ty = restTranslations[boneIdx * 3 + 1];
            const tz = restTranslations[boneIdx * 3 + 2];
            
            const qx = restRotations[boneIdx * 4 + 0];
            const qy = restRotations[boneIdx * 4 + 1];
            const qz = restRotations[boneIdx * 4 + 2];
            const qw = restRotations[boneIdx * 4 + 3];
            
            // Create transform matrix: T * R
            const localMat = new Mat4();
            localMat.setTRS(new Vec3(tx, ty, tz), new Quat(qx, qy, qz, qw), new Vec3(1, 1, 1));
            return localMat;
        };
        
        // Initialize all transforms
        for (let i = 0; i < numBones; i++) {
            worldTransforms[i] = new Mat4();
        }
        
        // Set root bone world transforms (world = local for root)
        for (const rootIdx of rootBones) {
            worldTransforms[rootIdx] = createLocalTransform(rootIdx);
        }
        
        // Traverse hierarchy: process bones in order, accumulating parent transforms
        // This assumes bones are stored in hierarchical order (parents before children)
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            // Skip if already processed (root bones)
            if (rootBones.includes(boneIdx)) {
                continue;
            }
            
            const parentIdx = parents[boneIdx];
            
            if (parentIdx >= 0 && parentIdx < numBones) {
                // World transform = parent's world transform × local transform
                const localMat = createLocalTransform(boneIdx);
                worldTransforms[boneIdx].mul2(worldTransforms[parentIdx], localMat);
            } else {
                // Invalid parent - use local transform as world transform
                worldTransforms[boneIdx] = createLocalTransform(boneIdx);
            }
        }
        
        // Create spheres at world positions from transforms
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            // Extract translation from world transform matrix
            worldTransforms[boneIdx].getTranslation(bonePos);
            
            // Create sphere at bone position
            const sphere = new SphereShape();
            // Add to scene FIRST so scene is set before updateBound() is called
            this.splat.scene.add(sphere);
            // Then set properties (radius triggers updateBound which needs scene)
            sphere.radius = 0.01; // Small sphere for bones
            sphere.pivot.setPosition(bonePos);
            sphere.moved();
            
            this.boneSpheres.push(sphere);
        }
        
        console.log(`Visualized ${this.boneSpheres.length} bones as spheres using std_male hierarchy traversal (${rootBones.length} root bone(s))`);
    }
    
    /**
     * Clear bone visualization spheres
     */
    clearBoneVisualization() {
        for (const sphere of this.boneSpheres) {
            if (sphere.scene) {
                sphere.remove();
                sphere.destroy();
            }
        }
        this.boneSpheres = [];
    }
    
    /**
     * Clean up event handlers
     */
    destroy() {
        this.clearBoneVisualization();
        
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

