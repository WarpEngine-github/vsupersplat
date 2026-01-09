// src/armature/armature.ts
import { ElementType } from '../core/element';
import { SceneObject } from '../core/scene-object';
import { ArmatureData, AnimationData } from '../file/loaders/binary-gsplat';
import { Events } from '../events';
import { SphereShape } from '../shapes/sphere-shape';
import { Mat4, Quat, Vec3 } from 'playcanvas';
import { Splat } from '../splat/splat';

/**
 * Armature class - drives skeletal animation and bone visualization
 * One armature per skeletal data, drives all linked splats
 */
export class Armature extends SceneObject {
    armatureData: ArmatureData;
    animationData?: AnimationData;
    numFrames: number;
    numBones: number;
    boneSpheres: SphereShape[] = [];
    
    // Linked splats that use this armature for skinning
    linkedSplats: Set<Splat> = new Set();
    
    // Timeline event handlers
    private timelineTimeHandle: any = null;
    private timelineFrameHandle: any = null;
    
    constructor(name: string, armatureData: ArmatureData, animationData?: AnimationData) {
        super(ElementType.armature);
        this._name = name;
        this.armatureData = armatureData;
        this.animationData = animationData;
        this.numBones = armatureData.numBones;
        this.numFrames = animationData ? animationData.numFrames : 0;
    }
    
    add() {
        if (!this.scene) {
            console.warn('[Armature.add] Cannot add armature: scene not set');
            return;
        }
        
        console.log('[Armature.add] Initializing armature:', this.name, 'numBones:', this.numBones, 'numFrames:', this.numFrames);
        
        // Initialize bone visualization using rest pose
        const worldTransforms = this.calculateBoneTransforms();
        if (worldTransforms) {
            this.visualizeBones(worldTransforms);
        } else {
            console.warn('[Armature.add] Failed to calculate initial bone transforms');
        }
        
        // Set up timeline event handlers if we have animation data
        if (this.animationData && this.numFrames > 0) {
            // Helper function to update animation frame from timeline frame/time
            const updateFromTimeline = (timelineValue: number) => {
                // Convert timeline frames to time in seconds, then to animation frames
                const timelineFrameRate = this.scene.events.invoke('timeline.frameRate') as number || 30;
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
            this.timelineTimeHandle = this.scene.events.on('timeline.time', (time: number) => {
                updateFromTimeline(time);
            });
            
            // Also listen to timeline.frame (fires when scrubbing/dragging timeline)
            this.timelineFrameHandle = this.scene.events.on('timeline.frame', (frame: number) => {
                updateFromTimeline(frame);
            });
            
            // Set initial frame based on current timeline position
            const currentTimelineFrame = this.scene.events.invoke('timeline.frame') as number || 0;
            const timelineFrameRate = this.scene.events.invoke('timeline.frameRate') as number || 30;
            const animationFrameRate = 30; // Assume animation is also 30 FPS
            const timeInSeconds = currentTimelineFrame / timelineFrameRate;
            const initialFrame = Math.min(
                Math.floor(timeInSeconds * animationFrameRate),
                this.numFrames - 1
            );
            this.setFrame(initialFrame);
        }
    }
    
    remove() {
        this.clearBoneVisualization();
        this.cleanupEventHandlers();
    }
    
    /**
     * Calculate all world space bone transforms for the current frame
     * Returns an array of Mat4 transforms, one per bone
     * @param frameIndex Optional frame index for animation. If not provided, uses rest pose.
     * @returns Array of world space bone transforms, or null if data is unavailable
     */
    calculateBoneTransforms(frameIndex?: number): Mat4[] | null {
        // Check if we should use animation data or rest pose data
        const useAnimation = frameIndex !== undefined && frameIndex >= 0 && this.numFrames > 0 && frameIndex < this.numFrames;
        
        // Check for required data
        if (useAnimation) {
            if (!this.animationData || !this.armatureData.stdMaleParents) {
                return null;
            }
        } else {
            if (!this.armatureData.joints || 
                !this.armatureData.stdMaleRestRotations || 
                !this.armatureData.stdMaleParents) {
                return null;
            }
        }
        
        const parents = this.armatureData.stdMaleParents!;
        const numBones = this.numBones;
        
        // Calculate world transforms by traversing hierarchy
        const worldTransforms = new Array<Mat4>(numBones);
        
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
        
        // Helper to get local transform for a bone
        const getLocalTransform = (boneIdx: number): Mat4 => {
            const localMat = new Mat4();
            
            if (useAnimation) {
                // Extract local transform from animation matrix (parent-relative)
                if (!this.animationData) {
                    throw new Error('Animation data not available');
                }
                const animationData = this.animationData.data;
                const FLOATS_PER_BONE = 16;
                const offset = frameIndex! * numBones * FLOATS_PER_BONE + boneIdx * FLOATS_PER_BONE;
                
                // Copy animation matrix directly
                for (let i = 0; i < 16; i++) {
                    localMat.data[i] = animationData[offset + i];
                }
            } else {
                // Use rest pose data
                const restTranslations = this.armatureData.joints!;
                const restRotations = this.armatureData.stdMaleRestRotations!;
                
                const tx = restTranslations[boneIdx * 3 + 0];
                const ty = restTranslations[boneIdx * 3 + 1];
                const tz = restTranslations[boneIdx * 3 + 2];
                
                const qx = restRotations[boneIdx * 4 + 0];
                const qy = restRotations[boneIdx * 4 + 1];
                const qz = restRotations[boneIdx * 4 + 2];
                const qw = restRotations[boneIdx * 4 + 3];
                
                // Create transform matrix: T * R
                localMat.setTRS(new Vec3(tx, ty, tz), new Quat(qx, qy, qz, qw), new Vec3(1, 1, 1));
            }
            
            return localMat;
        };
        
        // Initialize all transforms
        for (let i = 0; i < numBones; i++) {
            worldTransforms[i] = new Mat4();
        }
        
        // Set root bone world transforms (world = local for root)
        for (const rootIdx of rootBones) {
            worldTransforms[rootIdx] = getLocalTransform(rootIdx);
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
                const localMat = getLocalTransform(boneIdx);
                worldTransforms[boneIdx].mul2(worldTransforms[parentIdx], localMat);
            } else {
                // Invalid parent - use local transform as world transform
                worldTransforms[boneIdx] = getLocalTransform(boneIdx);
            }
        }
        
        return worldTransforms;
    }
    
    /**
     * Set animation to a specific frame
     * Updates bone visualization spheres and linked splats
     * Called automatically by timeline.time event listener
     */
    setFrame(frameIndex: number) {
        if (frameIndex < 0 || (this.numFrames > 0 && frameIndex >= this.numFrames)) return;
        
        // Calculate bone transforms once
        const worldTransforms = this.calculateBoneTransforms(frameIndex);
        if (!worldTransforms) {
            console.warn('[Armature.setFrame] Failed to calculate bone transforms');
            return;
        }
        
        // Update bone visualization
        this.visualizeBones(worldTransforms);
        
        // Update linked splats (mesh deformation - not implemented yet)
        this.updateSplats(worldTransforms);
    }
    
    /**
     * Visualize all bones as spheres using pre-calculated world transforms
     * @param worldTransforms Array of world space bone transforms (from calculateBoneTransforms)
     */
    visualizeBones(worldTransforms: Mat4[]) {
        if (!this.scene) {
            console.warn('Cannot visualize bones: armature not added to scene');
            return;
        }
        
        const numBones = worldTransforms.length;
        const bonePos = new Vec3();
        const boneRot = new Quat();
        
        // Create or update spheres at world positions from transforms
        const spheresNeedCreation = this.boneSpheres.length === 0;
        
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            // Extract translation and rotation from world transform matrix
            worldTransforms[boneIdx].getTranslation(bonePos);
            boneRot.setFromMat4(worldTransforms[boneIdx]);
            
            if (spheresNeedCreation) {
                // Create new sphere
                const sphere = new SphereShape();
                // Add to scene FIRST so scene is set before updateBound() is called
                this.scene.add(sphere);
                // Then set properties (radius triggers updateBound which needs scene)
                sphere.radius = 0.01; // Small sphere for bones
                sphere.pivot.setPosition(bonePos);
                sphere.pivot.setRotation(boneRot);
                sphere.moved();
                
                this.boneSpheres.push(sphere);
            } else {
                // Update existing sphere
                if (boneIdx < this.boneSpheres.length) {
                    const sphere = this.boneSpheres[boneIdx];
                    if (sphere && sphere.scene) {
                        sphere.pivot.setPosition(bonePos);
                        sphere.pivot.setRotation(boneRot);
                        sphere.moved();
                    }
                }
            }
        }
        
        if (spheresNeedCreation) {
            console.log(`Visualized ${this.boneSpheres.length} bones as spheres`);
        }
    }
    
    /**
     * Update linked splats using bone transforms
     * This applies the bone transforms to the splats' transform palettes
     * @param worldTransforms Array of world space bone transforms (from calculateBoneTransforms)
     */
    updateSplats(worldTransforms: Mat4[]) {
        // TODO: Implement mesh deformation
        // For now, this is a placeholder that will:
        // 1. Map each splat to its primary bone (from armatureData.weights)
        // 2. Update the splat's transformPalette with the bone's world transform
        // 3. Update the splat's transformTexture to point to the correct palette entry
        // 4. Call splat.updatePositions() to refresh rendering
        
        if (this.linkedSplats.size === 0) {
            return;
        }
        
        // Placeholder: mesh deformation not implemented yet
        // console.log(`[Armature.updateSplats] Would update ${this.linkedSplats.size} linked splats with ${worldTransforms.length} bone transforms`);
    }
    
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
    private cleanupEventHandlers() {
        if (this.timelineTimeHandle) {
            this.timelineTimeHandle.off();
            this.timelineTimeHandle = null;
        }
        if (this.timelineFrameHandle) {
            this.timelineFrameHandle.off();
            this.timelineFrameHandle = null;
        }
    }
    
    linkSplat(splat: Splat) {
        this.linkedSplats.add(splat);
    }
    
    unlinkSplat(splat: Splat) {
        this.linkedSplats.delete(splat);
    }

    // rename() is inherited from SceneObject, which already uses SceneObjectRenameOp

    getDisplayName(): string {
        return 'Armature';
    }
}