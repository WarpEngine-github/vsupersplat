import { ElementType } from '../core/element';
import { SceneObject } from '../core/scene-object';
import { ArmatureData, AnimationData } from '../file/loaders/binary-gsplat';
import { Events } from '../events';
import { BoneShape } from '../shapes/bone-shape';
import { Mat4, Quat, Vec3 } from 'playcanvas';
import { Splat } from '../splat/splat';

export class Armature extends SceneObject {
    armatureData: ArmatureData;
    animationData?: AnimationData;
    numFrames: number;
    numBones: number;
    boneMeshes: BoneShape[] = [];
    linkedSplats: Set<Splat> = new Set();
    private splatBonePaletteMaps: Map<Splat, Map<number, number>> = new Map();
    private inverseBindPose: Mat4[] | null = null;
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
        
        this.initializeInverseBindPose();
        
        if (this.animationData && this.numFrames > 0) {
            const updateFromFrame = (frame: number) => {
                const timelineFrameRate = this.scene.events.invoke('timeline.frameRate') as number || 30;
                const animationFrameRate = 30;
                const timeInSeconds = frame / timelineFrameRate;
                const frameIndex = Math.min(
                    Math.floor(timeInSeconds * animationFrameRate),
                    this.numFrames - 1
                );
                this.setFrame(frameIndex);
            };
            
            this.timelineFrameHandle = this.scene.events.on('timeline.frame', (frame: number) => {
                updateFromFrame(frame);
            });
            
            this.timelineTimeHandle = this.scene.events.on('timeline.time', (time: number) => {
                updateFromFrame(time);
            });
            
            const currentTimelineFrame = this.scene.events.invoke('timeline.frame') as number || 0;
            const timelineFrameRate = this.scene.events.invoke('timeline.frameRate') as number || 30;
            const animationFrameRate = 30;
            const timeInSeconds = currentTimelineFrame / timelineFrameRate;
            const initialFrame = Math.min(
                Math.floor(timeInSeconds * animationFrameRate),
                this.numFrames - 1
            );
            this.setFrame(initialFrame);
        } else {
            const worldTransforms = this.calculateBoneTransforms();
            if (worldTransforms) {
                this.visualizeBones(worldTransforms);
                this.updateSplats(worldTransforms);
            } else {
                console.warn('[Armature.add] Failed to calculate initial bone transforms');
            }
        }
    }
    
    remove() {
        this.clearBoneVisualization();
        this.cleanupEventHandlers();
    }
    
    calculateBindPoseTransforms(): Mat4[] | null {
        if (!this.armatureData.stdMaleRestTranslations || 
            !this.armatureData.stdMaleRestRotations || 
            !this.armatureData.stdMaleParents) {
            return null;
        }
        
        const parents = this.armatureData.stdMaleParents!;
        const numBones = this.numBones;
        const bindTranslations = this.armatureData.stdMaleRestTranslations;
        const bindRotations = this.armatureData.stdMaleRestRotations;
        const worldTransforms = new Array<Mat4>(numBones);
        
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
        
        const getLocalTransform = (boneIdx: number): Mat4 => {
            const localMat = new Mat4();
            const tx = bindTranslations[boneIdx * 3 + 0];
            const ty = bindTranslations[boneIdx * 3 + 1];
            const tz = bindTranslations[boneIdx * 3 + 2];
            const qx = bindRotations[boneIdx * 4 + 0];
            const qy = bindRotations[boneIdx * 4 + 1];
            const qz = bindRotations[boneIdx * 4 + 2];
            const qw = bindRotations[boneIdx * 4 + 3];
            localMat.setTRS(new Vec3(tx, ty, tz), new Quat(qx, qy, qz, qw), new Vec3(1, 1, 1));
            return localMat;
        };
        
        for (let i = 0; i < numBones; i++) {
            worldTransforms[i] = new Mat4();
        }
        
        for (const rootIdx of rootBones) {
            worldTransforms[rootIdx] = getLocalTransform(rootIdx);
        }
        
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            if (rootBones.includes(boneIdx)) {
                continue;
            }
            
            const parentIdx = parents[boneIdx];
            if (parentIdx >= 0 && parentIdx < numBones) {
                const localMat = getLocalTransform(boneIdx);
                worldTransforms[boneIdx].mul2(worldTransforms[parentIdx], localMat);
            } else {
                worldTransforms[boneIdx] = getLocalTransform(boneIdx);
            }
        }
        
        return worldTransforms;
    }
    
    private initializeInverseBindPose() {
        if (this.inverseBindPose !== null) {
            return;
        }
        
        const bindPose = this.calculateBindPoseTransforms();
        if (!bindPose) {
            console.warn('[Armature] Cannot initialize inverse bind pose: bind pose data unavailable');
            this.inverseBindPose = [];
            return;
        }
        
        this.inverseBindPose = bindPose.map(bindMat => {
            const inv = new Mat4();
            inv.copy(bindMat);
            inv.invert();
            return inv;
        });
        
        console.log(`[Armature] Initialized inverse bind pose for ${this.inverseBindPose.length} bones`);
    }
    
    calculateBoneTransforms(frameIndex?: number): Mat4[] | null {
        const useAnimation = frameIndex !== undefined && frameIndex >= 0 && this.numFrames > 0 && frameIndex < this.numFrames;
        
        if (useAnimation) {
            if (!this.animationData || !this.armatureData.stdMaleParents) {
                return null;
            }
        } else {
            if (!this.armatureData.stdMaleRestTranslations || 
                !this.armatureData.stdMaleRestRotations || 
                !this.armatureData.stdMaleParents) {
                return null;
            }
        }
        
        const parents = this.armatureData.stdMaleParents!;
        const numBones = this.numBones;
        const worldTransforms = new Array<Mat4>(numBones);
        
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
        
        const getLocalTransform = (boneIdx: number): Mat4 => {
            const localMat = new Mat4();
            
            if (useAnimation) {
                if (!this.animationData) {
                    throw new Error('Animation data not available');
                }
                const animationData = this.animationData.data;
                const FLOATS_PER_BONE = 16;
                const offset = frameIndex! * numBones * FLOATS_PER_BONE + boneIdx * FLOATS_PER_BONE;
                for (let i = 0; i < 16; i++) {
                    localMat.data[i] = animationData[offset + i];
                }
            } else {
                const restTranslations = this.armatureData.stdMaleRestTranslations!;
                const restRotations = this.armatureData.stdMaleRestRotations!;
                const tx = restTranslations[boneIdx * 3 + 0];
                const ty = restTranslations[boneIdx * 3 + 1];
                const tz = restTranslations[boneIdx * 3 + 2];
                const qx = restRotations[boneIdx * 4 + 0];
                const qy = restRotations[boneIdx * 4 + 1];
                const qz = restRotations[boneIdx * 4 + 2];
                const qw = restRotations[boneIdx * 4 + 3];
                localMat.setTRS(new Vec3(tx, ty, tz), new Quat(qx, qy, qz, qw), new Vec3(1, 1, 1));
            }
            
            return localMat;
        };
        
        for (let i = 0; i < numBones; i++) {
            worldTransforms[i] = new Mat4();
        }
        
        for (const rootIdx of rootBones) {
            worldTransforms[rootIdx] = getLocalTransform(rootIdx);
        }
        
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            if (rootBones.includes(boneIdx)) {
                continue;
            }
            
            const parentIdx = parents[boneIdx];
            if (parentIdx >= 0 && parentIdx < numBones) {
                const localMat = getLocalTransform(boneIdx);
                worldTransforms[boneIdx].mul2(worldTransforms[parentIdx], localMat);
            } else {
                worldTransforms[boneIdx] = getLocalTransform(boneIdx);
            }
        }
        
        return worldTransforms;
    }
    
    setFrame(frameIndex: number) {
        if (frameIndex < 0 || (this.numFrames > 0 && frameIndex >= this.numFrames)) return;
        
        const worldTransforms = this.calculateBoneTransforms(frameIndex);
        if (!worldTransforms) {
            console.warn('[Armature.setFrame] Failed to calculate bone transforms');
            return;
        }
        
        this.visualizeBones(worldTransforms);
        this.updateSplats(worldTransforms);
    }
    
    visualizeBones(worldTransforms: Mat4[]) {
        if (!this.scene) {
            console.warn('Cannot visualize bones: armature not added to scene');
            return;
        }
        
        const numBones = worldTransforms.length;
        const bonePositions = worldTransforms.map(mat => {
            const pos = new Vec3();
            mat.getTranslation(pos);
            return pos;
        });
        
        const meshesNeedCreation = this.boneMeshes.length === 0;
        
        for (let boneIdx = 0; boneIdx < numBones; boneIdx++) {
            if (meshesNeedCreation) {
                const boneMesh = new BoneShape();
                this.scene.add(boneMesh);

                const parentIdx = this.armatureData.stdMaleParents![boneIdx];
                if (parentIdx >= 0 && parentIdx < bonePositions.length) {
                    boneMesh.setPivotPosition(bonePositions[parentIdx]);
                    boneMesh.setJointPosition(bonePositions[boneIdx]);
                } else {
                    boneMesh.setPivotPosition(bonePositions[boneIdx]);
                    boneMesh.setJointPosition(null);
                }
                boneMesh.pivot.enabled = true;
                this.boneMeshes.push(boneMesh);
            } else {
                const boneMesh = this.boneMeshes[boneIdx];
                if (boneMesh) {
                    const parentIdx = this.armatureData.stdMaleParents![boneIdx];
                    if (parentIdx >= 0 && parentIdx < bonePositions.length) {
                        boneMesh.setPivotPosition(bonePositions[parentIdx]);
                        boneMesh.setJointPosition(bonePositions[boneIdx]);
                    } else {
                        boneMesh.setPivotPosition(bonePositions[boneIdx]);
                        boneMesh.setJointPosition(null);
                    }
                }
            }
        }
        
        if (meshesNeedCreation) {
            console.log(`[Armature] Visualized ${this.boneMeshes.length} bones as spheres`);
        }
    }
    
    updateSplats(worldTransforms: Mat4[]) {
        if (this.linkedSplats.size === 0) {
            return;
        }
        
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
        
        const finalTransforms = new Array<Mat4>(worldTransforms.length);
        for (let boneIdx = 0; boneIdx < worldTransforms.length; boneIdx++) {
            const final = new Mat4();
            final.mul2(worldTransforms[boneIdx], this.inverseBindPose[boneIdx]);
            finalTransforms[boneIdx] = final;
        }
        
        for (const splat of this.linkedSplats) {
            let bonePaletteMap = this.splatBonePaletteMaps.get(splat);
            if (!bonePaletteMap) {
                bonePaletteMap = this.initializeSplatBoneMapping(splat);
                this.splatBonePaletteMaps.set(splat, bonePaletteMap);
            }
            
            const transformPalette = splat.transformPalette;
            for (let boneIdx = 0; boneIdx < finalTransforms.length; boneIdx++) {
                const paletteIndex = bonePaletteMap.get(boneIdx);
                if (paletteIndex !== undefined) {
                    transformPalette.setTransform(paletteIndex, finalTransforms[boneIdx]);
                }
            }
            
            splat.updatePositions();
        }
    }
    
    private initializeSplatBoneMapping(splat: Splat): Map<number, number> {
        const { weights } = this.armatureData;
        if (!weights || !weights.indices || !weights.weights) {
            throw new Error('Cannot initialize splat bone mapping: no weights data');
        }
        
        const boneIndices = weights.indices;
        const boneWeights = weights.weights;
        const numSplats = boneIndices.length / 4;
        const transformPalette = splat.transformPalette;
        const firstBonePaletteIndex = transformPalette.alloc(this.numBones);
        
        const bonePaletteMap = new Map<number, number>();
        for (let boneIdx = 0; boneIdx < this.numBones; boneIdx++) {
            bonePaletteMap.set(boneIdx, firstBonePaletteIndex + boneIdx);
        }
        
        if (!splat.boneIndicesTexture || !splat.boneWeightsTexture) {
            throw new Error('Bone indices/weights textures not initialized on splat');
        }
        
        const boneIndicesData = splat.boneIndicesTexture.lock() as Float32Array;
        const boneWeightsData = splat.boneWeightsTexture.lock() as Float32Array;
        
        for (let splatIdx = 0; splatIdx < numSplats; splatIdx++) {
            for (let j = 0; j < 4; j++) {
                const boneIdx = boneIndices[splatIdx * 4 + j];
                const paletteIndex = bonePaletteMap.get(boneIdx);
                boneIndicesData[splatIdx * 4 + j] = paletteIndex !== undefined ? paletteIndex : 0;
            }
            
            for (let j = 0; j < 4; j++) {
                boneWeightsData[splatIdx * 4 + j] = boneWeights[splatIdx * 4 + j];
            }
        }
        
        splat.boneIndicesTexture.unlock();
        splat.boneWeightsTexture.unlock();
        
        return bonePaletteMap;
    }
    
    clearBoneVisualization() {
        for (const mesh of this.boneMeshes) {
            if (mesh.scene) {
                mesh.remove();
                mesh.destroy();
            }
        }
        this.boneMeshes = [];
    }
    
    setBoneVisualizationVisible(visible: boolean) {
        for (const mesh of this.boneMeshes) {
            if (mesh.scene && mesh.pivot) {
                mesh.pivot.enabled = visible;
                this.scene.forceRender = true;
            }
        }
    }
    
    getBoneVisualizationVisible(): boolean {
        if (this.boneMeshes.length === 0) {
            return false;
        }
        return this.boneMeshes.some(mesh => mesh.scene && mesh.pivot && mesh.pivot.enabled);
    }
    
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
        this.splatBonePaletteMaps.delete(splat);
    }

    getDisplayName(): string {
        return 'Armature';
    }
}