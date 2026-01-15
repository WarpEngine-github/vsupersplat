import { GSplatData } from 'playcanvas';

import { AssetSource, createReadSource } from './asset-source';

/**
 * Asset header structure from header.json
 */
interface AssetHeader {
    numSplats: number;
    numBones: number;  // Number of bones for skinning weights (441)
    bounds: {
        min: number[];
        max: number[];
    };
    animation?: {
        file: string;
        format: string;
        numFrames: number;
        numBones: number;  // Number of bones in animation (1185)
        shape: number[];
        stride: number;
    };
    joints?: {
        count: number;
        file: string;
        format: string;
        stride: number;
    };
}

/**
 * Armature data structure (skeleton, weights, joints - everything except animation frames)
 */
interface ArmatureData {
    numBones: number;  // Number of bones in the skeleton
    joints?: Float32Array;      // Joint positions (numJoints × 3 floats) - absolute world positions
    skeleton?: Int32Array;      // Bone hierarchy: parent indices (numBones × int32), -1 for root
    stdMaleRestTranslations?: Float32Array;  // Standard male A-pose joint positions (numBones × 3 floats)
    stdMaleRestRotations?: Float32Array;    // Standard male A-pose joint rotations (numBones × 4 floats, quaternions)
    stdMaleParents?: Int32Array;            // Standard male bone hierarchy (numBones × int32), -1 for root
}

interface SplatWeights {
    indices: Uint16Array;
    weights: Float32Array;
}

/**
 * Animation data structure (just the animation frames)
 */
interface AnimationData {
    data: Float32Array;     // All frames: numFrames × numBones × 16 floats
    numFrames: number;
    numBones: number;
}

/**
 * Result structure containing both GSplatData and optional armature/animation data
 */
interface BinaryGsplatResult {
    gsplatData: GSplatData;
    armatureData?: ArmatureData;
    animationData?: AnimationData;
    header: AssetHeader;
    splatWeights?: SplatWeights;
}

/**
 * Load binary Gaussian splat format (header.json + splats.bin)
 * 
 * Binary format (48 bytes per splat):
 * - Position: 3 x float32 (12 bytes)
 * - Scale: 3 x float32 (12 bytes) - linear scales
 * - Rotation: 4 x float32 (16 bytes) - quaternion (x, y, z, w)
 * - Color: 4 x uint8 (4 bytes) - RGBA
 * - Opacity: 1 x float32 (4 bytes) - linear opacity [0, 1]
 */
const loadBinaryGsplat = async (assetSource: AssetSource): Promise<BinaryGsplatResult> => {
    // Helper to get base path from URL or filename
    // Helper to load files strictly from in-memory sources (no URL fetch)
    const fetchFile = async (filename: string, required = true): Promise<ArrayBuffer> => {
        if (assetSource.mapFile) {
            const fileSource = assetSource.mapFile(filename);
            if (fileSource) {
                const source = await createReadSource(fileSource);
                return await source.arrayBuffer();
            }
        }

        if (filename === 'header.json' && assetSource.contents) {
            const source = await createReadSource(assetSource);
            return await source.arrayBuffer();
        }

        if (required) {
            throw new Error(`Missing required file ${filename}`);
        }
        throw new Error(`Optional file ${filename} missing`);
    };

    const fetchFileOptional = async (filename: string): Promise<ArrayBuffer | null> => {
        try {
            return await fetchFile(filename, false);
        } catch (error) {
            return null;
        }
    };

    // Step 1: Load header.json
    const headerBuffer = await fetchFile('header.json', true);
    const headerText = new TextDecoder().decode(headerBuffer);
    const header: AssetHeader = JSON.parse(headerText);
    
    const numSplats = header.numSplats;
    console.log(`Loading binary splat: ${numSplats} splats`);

    // Step 2: Load splats.bin
    console.log('[loadBinaryGsplat] About to fetch splats.bin...');
    const splatsBuffer = await fetchFile('splats.bin', true);
    console.log('[loadBinaryGsplat] Successfully loaded splats.bin, size:', splatsBuffer.byteLength);
    const SPLAT_STRIDE = 48; // bytes per splat
    
    if (splatsBuffer.byteLength !== numSplats * SPLAT_STRIDE) {
        console.warn(`Splat buffer size mismatch! Expected ${numSplats * SPLAT_STRIDE}, got ${splatsBuffer.byteLength}`);
    }

    const splatData = new DataView(splatsBuffer);

    // Allocate typed arrays for PlayCanvas GSplatData format
    const storage_x = new Float32Array(numSplats);
    const storage_y = new Float32Array(numSplats);
    const storage_z = new Float32Array(numSplats);
    const storage_scale_0 = new Float32Array(numSplats);
    const storage_scale_1 = new Float32Array(numSplats);
    const storage_scale_2 = new Float32Array(numSplats);
    const storage_rot_0 = new Float32Array(numSplats);
    const storage_rot_1 = new Float32Array(numSplats);
    const storage_rot_2 = new Float32Array(numSplats);
    const storage_rot_3 = new Float32Array(numSplats);
    const storage_f_dc_0 = new Float32Array(numSplats);
    const storage_f_dc_1 = new Float32Array(numSplats);
    const storage_f_dc_2 = new Float32Array(numSplats);
    const storage_opacity = new Float32Array(numSplats);
    const storage_state = new Uint8Array(numSplats);

    // Spherical harmonics constant for color conversion
    const SH_C0 = 0.28209479177387814;
    const littleEndian = true;

    // Step 3: Parse binary data and convert to PlayCanvas format
    let offset = 0;
    for (let i = 0; i < numSplats; i++) {
        // Position (12 bytes) - direct copy
        storage_x[i] = splatData.getFloat32(offset + 0, littleEndian);
        storage_y[i] = splatData.getFloat32(offset + 4, littleEndian);
        storage_z[i] = splatData.getFloat32(offset + 8, littleEndian);
        offset += 12;

        // Scale (12 bytes) - convert linear to log scale
        const scaleX = splatData.getFloat32(offset + 0, littleEndian);
        const scaleY = splatData.getFloat32(offset + 4, littleEndian);
        const scaleZ = splatData.getFloat32(offset + 8, littleEndian);
        storage_scale_0[i] = Math.log(Math.max(scaleX, 1e-8)); // Clamp to avoid log(0)
        storage_scale_1[i] = Math.log(Math.max(scaleY, 1e-8));
        storage_scale_2[i] = Math.log(Math.max(scaleZ, 1e-8));
        offset += 12;

        // Rotation quaternion (16 bytes) - direct copy (already normalized)
        storage_rot_0[i] = splatData.getFloat32(offset + 0, littleEndian);
        storage_rot_1[i] = splatData.getFloat32(offset + 4, littleEndian);
        storage_rot_2[i] = splatData.getFloat32(offset + 8, littleEndian);
        storage_rot_3[i] = splatData.getFloat32(offset + 12, littleEndian);
        offset += 16;

        // Color RGBA (4 bytes) - convert uint8 to spherical harmonics
        const r = splatData.getUint8(offset + 0);
        const g = splatData.getUint8(offset + 1);
        const b = splatData.getUint8(offset + 2);
        // Convert RGB [0-255] to spherical harmonics f_dc_0/1/2
        // Formula: (value / 255 - 0.5) / SH_C0
        storage_f_dc_0[i] = (r / 255 - 0.5) / SH_C0;
        storage_f_dc_1[i] = (g / 255 - 0.5) / SH_C0;
        storage_f_dc_2[i] = (b / 255 - 0.5) / SH_C0;
        offset += 4;

        // Opacity (4 bytes) - convert linear [0,1] to log opacity
        const opacity = splatData.getFloat32(offset + 0, littleEndian);
        // Clamp opacity to valid range and convert to log space
        // Formula: -log(1 / opacity - 1) for sigmoid inverse
        const clampedOpacity = Math.max(0.0001, Math.min(0.9999, opacity));
        storage_opacity[i] = -Math.log(1 / clampedOpacity - 1);
        offset += 4;
    }

    // Step 4: Create GSplatData object
    const gsplatData = new GSplatData([{
        name: 'vertex',
        count: numSplats,
        properties: [
            { type: 'float', name: 'x', storage: storage_x, byteSize: 4 },
            { type: 'float', name: 'y', storage: storage_y, byteSize: 4 },
            { type: 'float', name: 'z', storage: storage_z, byteSize: 4 },
            { type: 'float', name: 'opacity', storage: storage_opacity, byteSize: 4 },
            { type: 'float', name: 'rot_0', storage: storage_rot_0, byteSize: 4 },
            { type: 'float', name: 'rot_1', storage: storage_rot_1, byteSize: 4 },
            { type: 'float', name: 'rot_2', storage: storage_rot_2, byteSize: 4 },
            { type: 'float', name: 'rot_3', storage: storage_rot_3, byteSize: 4 },
            { type: 'float', name: 'f_dc_0', storage: storage_f_dc_0, byteSize: 4 },
            { type: 'float', name: 'f_dc_1', storage: storage_f_dc_1, byteSize: 4 },
            { type: 'float', name: 'f_dc_2', storage: storage_f_dc_2, byteSize: 4 },
            { type: 'float', name: 'scale_0', storage: storage_scale_0, byteSize: 4 },
            { type: 'float', name: 'scale_1', storage: storage_scale_1, byteSize: 4 },
            { type: 'float', name: 'scale_2', storage: storage_scale_2, byteSize: 4 },
            { type: 'float', name: 'state', storage: storage_state, byteSize: 4 }
        ]
    }]);

    // Step 5: Load armature and animation data if available
    let armatureData: ArmatureData | undefined;
    let animationData: AnimationData | undefined;
    
    // Load weights.bin if available (needed for armature)
    let weightsLoaded = false;
    let boneIndices: Uint16Array | undefined;
    let boneWeights: Float32Array | undefined;
    let numBonesFromWeights: number | undefined;
    
    try {
        const weightsBuffer = await fetchFileOptional('weights.bin');
        if (!weightsBuffer) {
            // No weights provided; continue without weights
        } else {
            const WEIGHT_STRIDE = 24; // bytes per splat
            
            if (weightsBuffer.byteLength !== numSplats * WEIGHT_STRIDE) {
                console.warn(`Weights buffer size mismatch! Expected ${numSplats * WEIGHT_STRIDE}, got ${weightsBuffer.byteLength}`);
            }

            const weightsData = new DataView(weightsBuffer);
        boneIndices = new Uint16Array(numSplats * 4);
        boneWeights = new Float32Array(numSplats * 4);
            
            let weightsOffset = 0;
            for (let i = 0; i < numSplats; i++) {
                // Bone indices (8 bytes: 4×uint16)
                for (let j = 0; j < 4; j++) {
                    boneIndices[i * 4 + j] = weightsData.getUint16(weightsOffset + j * 2, littleEndian);
                }
                weightsOffset += 8;
                
                // Bone weights (16 bytes: 4×float32)
                for (let j = 0; j < 4; j++) {
                    boneWeights[i * 4 + j] = weightsData.getFloat32(weightsOffset + j * 4, littleEndian);
                }
                weightsOffset += 16;
            }

        // Determine number of bones from weights (max bone index + 1)
        if (boneIndices.length > 0) {
            let maxIndex = 0;
            for (let i = 0; i < boneIndices.length; i++) {
                const v = boneIndices[i];
                if (v > maxIndex) {
                    maxIndex = v;
                }
            }
            numBonesFromWeights = maxIndex + 1;
        }
        
            weightsLoaded = true;
        }
    } catch (error) {
        console.warn('Failed to load weights.bin:', error);
        // Continue without weights
    }
    
    // Load animation data if available (independent of armature)
    if (header.animation && header.animation.numFrames > 0 && header.animation.numBones > 0) {
        const animationInfo = header.animation;
        try {
            // Load animation.bin (16 floats × numBones × numFrames)
            const animationBuffer = await fetchFileOptional('animation.bin');
            if (!animationBuffer) {
                // No animation provided; skip
                throw new Error('animation.bin not provided');
            }
            const FLOATS_PER_BONE = 16; // 4×4 matrix
            let numBones = animationInfo.numBones;
            const expectedSize = animationInfo.numFrames * numBones * FLOATS_PER_BONE * 4; // 4 bytes per float
            
            if (animationBuffer.byteLength !== expectedSize) {
                // Calculate actual bone count from buffer size
                const actualBoneCount = (animationBuffer.byteLength / 4) / (animationInfo.numFrames * FLOATS_PER_BONE);
                if (Number.isInteger(actualBoneCount) && actualBoneCount > 0) {
                    console.warn(`Animation buffer size mismatch! Expected ${expectedSize} (${numBones} bones), got ${animationBuffer.byteLength} (${actualBoneCount} bones). Using actual bone count.`);
                    numBones = actualBoneCount;
                } else {
                    console.warn(`Animation buffer size mismatch! Expected ${expectedSize}, got ${animationBuffer.byteLength}. Size doesn't match expected format.`);
                }
            }

            const animationArray = new Float32Array(animationBuffer);

            animationData = {
                    data: animationArray,
                numFrames: animationInfo.numFrames,
                numBones: numBones
            };

            console.log(`Loaded animation: ${animationInfo.numFrames} frames, ${numBones} bones`);
        } catch (error) {
            if ((error as Error).message !== 'animation.bin not provided') {
                console.warn('Failed to load animation data:', error);
            }
            // Continue without animation
        }
    }
    
    // Initialize armatureData if we have weights (independent of animation)
    // Load armature data (joints, skeleton, std_male) independently of animation
            const headerWithJoints = header as AssetHeader & { 
                joints?: { count: number; file: string; format: string; stride: number };
                skeleton?: { count: number; file: string; format: string; stride: number };
            };
    
    // Create armatureData if we have joints or skeleton data but no armatureData yet
    if (!armatureData && (headerWithJoints.joints || headerWithJoints.skeleton)) {
        // Determine numBones: from animation if available, otherwise from skeleton/joints count
        let numBones = animationData ? animationData.numBones : 0;
        if (numBones === 0 && headerWithJoints.skeleton) {
            numBones = headerWithJoints.skeleton.count;
        }
        if (numBones === 0 && headerWithJoints.joints) {
            numBones = headerWithJoints.joints.count;
        }
        
        if (numBones > 0) {
            armatureData = {
                numBones: numBones
            };
        }
    }
    
    // Load joints.bin if available
    if (headerWithJoints.joints && armatureData) {
                try {
                    const jointsBuffer = await fetchFileOptional('joints.bin');
                    if (!jointsBuffer) {
                        throw new Error('joints.bin not provided');
                    }
                    const FLOATS_PER_JOINT = 3; // x, y, z
                    const jointsInfo = headerWithJoints.joints;
                    const expectedJointsSize = jointsInfo.count * FLOATS_PER_JOINT * 4; // 4 bytes per float
                    
                    if (jointsBuffer.byteLength === expectedJointsSize) {
                        const jointsArray = new Float32Array(jointsBuffer);
                armatureData.joints = jointsArray;
                        console.log(`Loaded joints: ${jointsArray.length / 3} joint positions`);
                    } else {
                        console.warn(`Joints buffer size mismatch! Expected ${expectedJointsSize}, got ${jointsBuffer.byteLength}`);
                    }
                } catch (error) {
                    if ((error as Error).message !== 'joints.bin not provided') {
                    console.warn('Failed to load joints data:', error);
                    }
                    // Continue without joints
                }
            }
            
            // Load skeleton.bin if available (bone hierarchy: parent indices)
    if (headerWithJoints.skeleton && armatureData) {
                try {
                    const skeletonBuffer = await fetchFileOptional('skeleton.bin');
                    if (!skeletonBuffer) {
                        throw new Error('skeleton.bin not provided');
                    }
                    const skeletonInfo = headerWithJoints.skeleton;
                    const expectedSkeletonSize = skeletonInfo.count * 4; // 4 bytes per int32
                    
                    if (skeletonBuffer.byteLength === expectedSkeletonSize) {
                        const skeletonArray = new Int32Array(skeletonBuffer);
                armatureData.skeleton = skeletonArray;
                        console.log(`Loaded skeleton hierarchy: ${skeletonArray.length} bones`);
                    } else {
                        console.warn(`Skeleton buffer size mismatch! Expected ${expectedSkeletonSize}, got ${skeletonBuffer.byteLength}`);
                    }
                } catch (error) {
                    if ((error as Error).message !== 'skeleton.bin not provided') {
                    console.warn('Failed to load skeleton data:', error);
                    }
                    // Continue without skeleton
                }
    }
    
    // Load std_male skeleton data if available (rest translations, rotations, and parents)
    const headerWithStdMale = header as AssetHeader & {
        stdMaleModel?: {
            restTranslations?: { file: string; count: number; stride: number };
            restRotations?: { file: string; count: number; stride: number };
            parents?: { file: string; count: number; stride: number };
        };
    };
    
    if (headerWithStdMale.stdMaleModel && armatureData) {
        // Load rest translations
        if (headerWithStdMale.stdMaleModel.restTranslations) {
            try {
                const stdMaleBuffer = await fetchFileOptional(headerWithStdMale.stdMaleModel.restTranslations.file);
                if (!stdMaleBuffer) {
                    throw new Error(`${headerWithStdMale.stdMaleModel.restTranslations.file} not provided`);
                }
                const stdMaleInfo = headerWithStdMale.stdMaleModel.restTranslations;
                const expectedStdMaleSize = stdMaleInfo.count * 3 * 4; // count × 3 floats × 4 bytes
                
                if (stdMaleBuffer.byteLength === expectedStdMaleSize) {
                    const stdMaleArray = new Float32Array(stdMaleBuffer);
                    armatureData.stdMaleRestTranslations = stdMaleArray;
                    console.log(`Loaded std_male rest translations: ${stdMaleArray.length / 3} joint positions`);
                } else {
                    console.warn(`Std male translations buffer size mismatch! Expected ${expectedStdMaleSize}, got ${stdMaleBuffer.byteLength}`);
                }
            } catch (error) {
                if ((error as Error).message !== `${headerWithStdMale.stdMaleModel.restTranslations.file} not provided`) {
                    console.warn('Failed to load std_male rest translations:', error);
                }
            }
        }
        
        // Load rest rotations
        if (headerWithStdMale.stdMaleModel.restRotations) {
            try {
                const stdMaleBuffer = await fetchFileOptional(headerWithStdMale.stdMaleModel.restRotations.file);
                if (!stdMaleBuffer) {
                    throw new Error(`${headerWithStdMale.stdMaleModel.restRotations.file} not provided`);
                }
                const stdMaleInfo = headerWithStdMale.stdMaleModel.restRotations;
                const expectedStdMaleSize = stdMaleInfo.count * 4 * 4; // count × 4 floats × 4 bytes
                
                if (stdMaleBuffer.byteLength === expectedStdMaleSize) {
                    const stdMaleArray = new Float32Array(stdMaleBuffer);
                    armatureData.stdMaleRestRotations = stdMaleArray;
                    console.log(`Loaded std_male rest rotations: ${stdMaleArray.length / 4} quaternions`);
                } else {
                    console.warn(`Std male rotations buffer size mismatch! Expected ${expectedStdMaleSize}, got ${stdMaleBuffer.byteLength}`);
                }
            } catch (error) {
                if ((error as Error).message !== `${headerWithStdMale.stdMaleModel.restRotations.file} not provided`) {
                    console.warn('Failed to load std_male rest rotations:', error);
                }
            }
        }
        
        // Load parents (bone hierarchy)
        if (headerWithStdMale.stdMaleModel.parents) {
            try {
                const stdMaleBuffer = await fetchFileOptional(headerWithStdMale.stdMaleModel.parents.file);
                if (!stdMaleBuffer) {
                    throw new Error(`${headerWithStdMale.stdMaleModel.parents.file} not provided`);
                }
                const stdMaleInfo = headerWithStdMale.stdMaleModel.parents;
                const expectedStdMaleSize = stdMaleInfo.count * 4; // count × 4 bytes (int32)
                
                if (stdMaleBuffer.byteLength === expectedStdMaleSize) {
                    const stdMaleArray = new Int32Array(stdMaleBuffer);
                    armatureData.stdMaleParents = stdMaleArray;
                    console.log(`Loaded std_male parents: ${stdMaleArray.length} bone hierarchy entries`);
                } else {
                    console.warn(`Std male parents buffer size mismatch! Expected ${expectedStdMaleSize}, got ${stdMaleBuffer.byteLength}`);
            }
        } catch (error) {
                if ((error as Error).message !== `${headerWithStdMale.stdMaleModel.parents.file} not provided`) {
                    console.warn('Failed to load std_male parents:', error);
                }
            }
        }
    }

    console.log('[loadBinaryGsplat] Loading complete. Armature data:', armatureData ? 'present' : 'missing', 'Animation data:', animationData ? 'present' : 'missing');

    return {
        gsplatData,
        armatureData,
        animationData,
        header,
        splatWeights: boneIndices && boneWeights ? { indices: boneIndices, weights: boneWeights } : undefined
    };
};

export { loadBinaryGsplat };
export type { ArmatureData, AnimationData, BinaryGsplatResult };

