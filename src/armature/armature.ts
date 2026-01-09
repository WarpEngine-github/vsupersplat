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
    
    // Map of splat -> (bone index -> palette index) for each linked splat
    private splatBonePaletteMaps: Map<Splat, Map<number, number>> = new Map();
    
    // Cached inverse bind pose matrices (calculated once, reused for all frames)
    private inverseBindPose: Mat4[] | null = null;
    
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
        
        // Initialize inverse bind pose (needed for splat skinning)
        this.initializeInverseBindPose();
        
        // Initialize bone visualization using rest pose
        const worldTransforms = this.calculateBoneTransforms();
        if (worldTransforms) {
            this.visualizeBones(worldTransforms);
            // Also initialize splat bone mapping and apply initial transforms
            this.updateSplats(worldTransforms);
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
     * Calculate bind pose world transforms (where splats were bound to skeleton)
     * Uses joints.bin positions + std_male_rest_rotations
     * @returns Array of bind pose world transforms, or null if data is unavailable
     */
    calculateBindPoseTransforms(): Mat4[] | null {
        // Check for required data: joints.bin (bind pose positions) + std_male_rest_rotations
        if (!this.armatureData.joints || 
            !this.armatureData.stdMaleRestRotations || 
            !this.armatureData.stdMaleParents) {
            return null;
        }
        
        const parents = this.armatureData.stdMaleParents!;
        const numBones = this.numBones;
        const bindTranslations = this.armatureData.joints; // joints.bin = bind pose positions
        const bindRotations = this.armatureData.stdMaleRestRotations;
        
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
        
        // Helper to get local transform for a bone in bind pose
        const getLocalTransform = (boneIdx: number): Mat4 => {
            const localMat = new Mat4();
            
            // Use bind pose data: joints.bin positions + std_male_rest_rotations
            const tx = bindTranslations[boneIdx * 3 + 0];
            const ty = bindTranslations[boneIdx * 3 + 1];
            const tz = bindTranslations[boneIdx * 3 + 2];
            
            const qx = bindRotations[boneIdx * 4 + 0];
            const qy = bindRotations[boneIdx * 4 + 1];
            const qz = bindRotations[boneIdx * 4 + 2];
            const qw = bindRotations[boneIdx * 4 + 3];
            
            // Create transform matrix: T * R
            localMat.setTRS(new Vec3(tx, ty, tz), new Quat(qx, qy, qz, qw), new Vec3(1, 1, 1));
            
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
     * Initialize inverse bind pose matrices (calculated once, cached)
     * These are used to transform from bind pose space to bone local space
     */
    private initializeInverseBindPose() {
        if (this.inverseBindPose !== null) {
            return; // Already initialized
        }
        
        const bindPose = this.calculateBindPoseTransforms();
        if (!bindPose) {
            console.warn('[Armature] Cannot initialize inverse bind pose: bind pose data unavailable');
            this.inverseBindPose = [];
            return;
        }
        
        // Calculate inverse of each bind pose transform
        this.inverseBindPose = bindPose.map(bindMat => {
            const inv = new Mat4();
            inv.copy(bindMat);
            inv.invert();
            return inv;
        });
        
        console.log(`[Armature] Initialized inverse bind pose for ${this.inverseBindPose.length} bones`);
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
     * Uses the standard skinning formula: FinalTransform = Current × InverseBind
     * @param worldTransforms Array of world space bone transforms (from calculateBoneTransforms)
     */
    updateSplats(worldTransforms: Mat4[]) {
        if (this.linkedSplats.size === 0) {
            return;
        }
        
        // Ensure inverse bind pose is initialized
        if (this.inverseBindPose === null) {
            this.initializeInverseBindPose();
        }
        
        if (!this.inverseBindPose || this.inverseBindPose.length === 0) {
            console.warn('[Armature.updateSplats] Inverse bind pose not available, cannot update splats');
            return;
        }
        
        const { weights } = this.armatureData;
        if (!weights || !weights.indices || !weights.weights) {
            console.warn('[Armature.updateSplats] No weights data available');
            return;
        }
        
        // Calculate final transforms: Current × InverseBind
        // This transforms from bind pose space to current pose space
        const finalTransforms = new Array<Mat4>(worldTransforms.length);
        for (let boneIdx = 0; boneIdx < worldTransforms.length; boneIdx++) {
            const final = new Mat4();
            // FinalTransform = Current × InverseBind
            final.mul2(worldTransforms[boneIdx], this.inverseBindPose[boneIdx]);
            finalTransforms[boneIdx] = final;
        }
        
        // Update each linked splat
        for (const splat of this.linkedSplats) {
            // Get or create bone palette map for this splat
            let bonePaletteMap = this.splatBonePaletteMaps.get(splat);
            if (!bonePaletteMap) {
                // First time: allocate palette entries for all bones and map splats to primary bones
                bonePaletteMap = this.initializeSplatBoneMapping(splat);
                this.splatBonePaletteMaps.set(splat, bonePaletteMap);
            }
            
            // Update transform palette with final transforms (Current × InverseBind)
            const transformPalette = splat.transformPalette;
            for (let boneIdx = 0; boneIdx < finalTransforms.length; boneIdx++) {
                const paletteIndex = bonePaletteMap.get(boneIdx);
                if (paletteIndex !== undefined) {
                    transformPalette.setTransform(paletteIndex, finalTransforms[boneIdx]);
                }
            }
            
            // Refresh splat rendering
            splat.updatePositions();
        }
    }
    
    /**
     * Initialize bone mapping for a splat
     * Allocates palette entries for all bones and maps each splat to its primary bone
     * @param splat The splat to initialize
     * @returns Map of bone index -> palette index
     */
    private initializeSplatBoneMapping(splat: Splat): Map<number, number> {
        const { weights } = this.armatureData;
        if (!weights || !weights.indices || !weights.weights) {
            throw new Error('Cannot initialize splat bone mapping: no weights data');
        }
        
        const boneIndices = weights.indices;
        const boneWeights = weights.weights;
        const numSplats = boneIndices.length / 4;
        
        // Allocate palette entries for all bones (one per bone)
        const transformPalette = splat.transformPalette;
        const firstBonePaletteIndex = transformPalette.alloc(this.numBones);
        
        // Create mapping: bone index -> palette index
        const bonePaletteMap = new Map<number, number>();
        for (let boneIdx = 0; boneIdx < this.numBones; boneIdx++) {
            bonePaletteMap.set(boneIdx, firstBonePaletteIndex + boneIdx);
        }
        
        // Map each splat to its primary bone (bone with highest weight)
        const transformIndices = splat.transformTexture.lock() as Uint16Array;
        
        for (let splatIdx = 0; splatIdx < numSplats; splatIdx++) {
            // Find bone with highest weight
            let maxWeight = 0;
            let primaryBoneIdx = 0;
            
            for (let j = 0; j < 4; j++) {
                const weight = boneWeights[splatIdx * 4 + j];
                if (weight > maxWeight) {
                    maxWeight = weight;
                    primaryBoneIdx = boneIndices[splatIdx * 4 + j];
                }
            }
            
            // Map splat to its primary bone's palette index
            const paletteIndex = bonePaletteMap.get(primaryBoneIdx);
            if (paletteIndex !== undefined) {
                transformIndices[splatIdx] = paletteIndex;
            }
        }
        
        splat.transformTexture.unlock();
        
        return bonePaletteMap;
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
        // Bone mapping will be initialized on first updateSplats call
    }
    
    unlinkSplat(splat: Splat) {
        this.linkedSplats.delete(splat);
        // Clean up bone palette map
        this.splatBonePaletteMaps.delete(splat);
    }

    // rename() is inherited from SceneObject, which already uses SceneObjectRenameOp

    getDisplayName(): string {
        return 'Armature';
    }
}