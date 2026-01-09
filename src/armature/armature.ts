// src/armature/armature.ts
import { ElementType } from '../core/element';
import { SceneObject } from '../core/scene-object';
import { BinaryGsplatAnimationData } from '../file/loaders/binary-gsplat';
import { Events } from '../events';
import { SphereShape } from '../shapes/sphere-shape';
import { Mat4, Quat, Vec3 } from 'playcanvas';
import { Splat } from '../splat/splat';

export class Armature extends SceneObject {
    animationData: BinaryGsplatAnimationData;
    numFrames: number;
    numBones: number;
    boneSpheres: SphereShape[] = [];
    
    // Linked splats that use this armature for skinning
    linkedSplats: Set<Splat> = new Set();
    
    constructor(name: string, animationData: BinaryGsplatAnimationData) {
        super(ElementType.armature);
        this._name = name;
        this.animationData = animationData;
        this.numFrames = animationData.animation.numFrames;
        this.numBones = animationData.animation.numBones;
    }
    
    add() {
        // Initialize bone visualization
        this.visualizeBones();
        
        // Listen to timeline events
        // ... (similar to SplatAnimation)
    }
    
    remove() {
        this.clearBoneVisualization();
        // Clean up event handlers
    }
    
    visualizeBones(frameIndex?: number) {
        // Move bone visualization logic here from SplatAnimation
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
    
    setFrame(frameIndex: number) {
        // Update bone visualization
        // Update linked splats' transform palettes
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