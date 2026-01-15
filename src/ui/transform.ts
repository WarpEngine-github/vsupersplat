import { Container, ContainerArgs, Label, NumericInput, SelectInput, VectorInput } from '@playcanvas/pcui';
import { Mat4, Quat, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { localize } from './localization';
import { Pivot } from '../transform/pivot';
import { SceneObject } from '../core/scene-object';
import { Splat } from '../splat/splat';

const v = new Vec3();

class Transform extends Container {
    constructor(events: Events, args: ContainerArgs = {}) {
        args = {
            ...args,
            id: 'transform'
        };

        super(args);

        // position
        const position = new Container({
            class: 'transform-row'
        });

        const positionLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.position')
        });

        const positionVector = new VectorInput({
            class: 'transform-expand',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0],
            enabled: false
        });

        position.append(positionLabel);
        position.append(positionVector);

        // rotation
        const rotation = new Container({
            class: 'transform-row'
        });

        const rotationLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.rotation')
        });

        const rotationVector = new VectorInput({
            class: 'transform-expand',
            precision: 2,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0],
            enabled: false
        });

        rotation.append(rotationLabel);
        rotation.append(rotationVector);

        // scale
        const scale = new Container({
            class: 'transform-row'
        });

        const scaleLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.scale')
        });

        const scaleInput = new NumericInput({
            class: 'transform-expand',
            precision: 3,
            value: 1,
            min: 0.001,
            max: 10000,
            enabled: false
        });

        scale.append(scaleLabel);
        scale.append(scaleInput);

        // skeleton
        const skeleton = new Container({
            class: 'transform-row'
        });

        const skeletonLabel = new Label({
            class: 'transform-label',
            text: 'Skeleton'
        });

        const skeletonSelect = new SelectInput({
            class: 'transform-expand',
            defaultValue: 'none',
            options: [
                { v: 'none', t: 'None' },
                { v: 'skeleton_1', t: 'Skeleton 1' },
                { v: 'skeleton_2', t: 'Skeleton 2' },
                { v: 'skeleton_3', t: 'Skeleton 3' }
            ]
        });

        skeleton.append(skeletonLabel);
        skeleton.append(skeletonSelect);

        // animation
        const animation = new Container({
            class: 'transform-row'
        });

        const animationLabel = new Label({
            class: 'transform-label',
            text: 'Animation'
        });

        const animationSelect = new SelectInput({
            class: 'transform-expand',
            defaultValue: 'none',
            options: [
                { v: 'none', t: 'None' }
            ]
        });

        animation.append(animationLabel);
        animation.append(animationSelect);

        this.append(position);
        this.append(rotation);
        this.append(scale);
        this.append(skeleton);
        this.append(animation);

        const toArray = (v: Vec3) => {
            return [v.x, v.y, v.z];
        };

        let uiUpdating = false;
        let mouseUpdating = false;

        // update UI with pivot
        const updateUI = () => {
            const selection = events.invoke('selection') as SceneObject | null;
            if (!selection || !selection.entity) {
                return;
            }

            uiUpdating = true;
            
            // Get local transforms directly from entity
            const localPos = selection.entity.getLocalPosition();
            const localRot = selection.entity.getLocalRotation();
            const localScale = selection.entity.getLocalScale();
            
            localRot.getEulerAngles(v);
            positionVector.value = toArray(localPos);
            rotationVector.value = toArray(v);
            scaleInput.value = localScale.x;
            animationSelect.value = selection.selectedAnimation || 'none';
            skeletonSelect.value = selection instanceof Splat ? selection.selectedSkeleton : 'none';
            
            uiUpdating = false;
        };

        // update pivot with UI
        const updatePivot = (pivot: Pivot) => {
            const p = positionVector.value;
            const r = rotationVector.value;
            const q = new Quat().setFromEulerAngles(r[0], r[1], r[2]);
            const s = scaleInput.value;

            if (q.w < 0) {
                q.mulScalar(-1);
            }

            // Convert local transform to world space
            const localPosVec = new Vec3(p[0], p[1], p[2]);
            const localScaleVec = new Vec3(s, s, s);
            
            // Build local transform matrix
            const localMat = new Mat4();
            localMat.setTRS(localPosVec, q, localScaleVec);    

            const selection = events.invoke('selection') as SceneObject | null;
            if (!selection || !selection.entity) {
                return;
            }

            // Multiply by parent's world transform if parent exists
            const worldMat = new Mat4();
            if (selection.entity.parent) {
                const parentWorldMat = selection.entity.parent.getWorldTransform();
                worldMat.mul2(parentWorldMat, localMat);
            } else {
                worldMat.copy(localMat);
            }

            // Extract world transform components
            const worldPos = new Vec3();
            const worldRot = new Quat();
            const worldScale = new Vec3();
            worldMat.getTranslation(worldPos);
            worldRot.setFromMat4(worldMat);
            worldMat.getScale(worldScale);
            
            pivot.moveTRS(worldPos, worldRot, worldScale);
        };

        // handle a change in the UI state
        const change = () => {
            if (!uiUpdating) {
                const pivot = events.invoke('pivot') as Pivot;
                if (mouseUpdating) {
                    updatePivot(pivot);
                } else {
                    pivot.start();
                    updatePivot(pivot);
                    pivot.end();
                }
            }
        };

        const mousedown = () => {
            mouseUpdating = true;
            const pivot = events.invoke('pivot') as Pivot;
            pivot.start();
        };

        const mouseup = () => {
            const pivot = events.invoke('pivot') as Pivot;
            updatePivot(pivot);
            mouseUpdating = false;
            pivot.end();
        };

        [positionVector.inputs, rotationVector.inputs, scaleInput].flat().forEach((input) => {
            input.on('change', change);
            input.on('slider:mousedown', mousedown);
            input.on('slider:mouseup', mouseup);
        });

        animationSelect.on('change', (value: string) => {
            if (uiUpdating) {
                return;
            }
            const selection = events.invoke('selection') as SceneObject | null;
            if (!selection) {
                return;
            }
            selection.selectedAnimation = value || 'none';
        });

        const closeOtherSelects = (current: SelectInput) => {
            if (current !== animationSelect) {
                animationSelect.close();
            }
            if (current !== skeletonSelect) {
                skeletonSelect.close();
            }
        };

        const attachSelectClose = (select: SelectInput) => {
            select.on('click', () => closeOtherSelects(select));
            select.on('focus', () => closeOtherSelects(select));
        };

        attachSelectClose(animationSelect);
        attachSelectClose(skeletonSelect);

        const closeAllSelects = () => {
            animationSelect.close();
            skeletonSelect.close();
        };

        const onDocumentPointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                closeAllSelects();
                return;
            }
            const inAnimation = animationSelect.dom.contains(target);
            const inSkeleton = skeletonSelect.dom.contains(target);
            if (!inAnimation && !inSkeleton) {
                closeAllSelects();
            }
        };

        document.addEventListener('pointerdown', onDocumentPointerDown, true);

        const bindSkeleton = async (splat: Splat, value: string) => {
            if (value === 'none') {
                if (splat.linkedArmature) {
                    const existing = splat.linkedArmature;
                    existing.unlinkSplat(splat);
                    if (existing.linkedSplats.size === 0) {
                        existing.remove();
                    }
                }
                return;
            }

            const scene = window.scene;
            const library = scene?.skeletonLibrary;
            if (!scene || !library) {
                console.warn('No skeleton library loaded.');
                return;
            }

            const assetArmature = (splat.asset as any).__armatureData;
            const animationData = (splat.asset as any).__animationData;
            if (!assetArmature || !assetArmature.weights) {
                console.warn('No weights data on asset.');
                return;
            }

            const stdParentsCount = library.stdMaleParents ? library.stdMaleParents.length : 0;
            const restTransCount = library.stdMaleRestTranslations ? library.stdMaleRestTranslations.length / 3 : 0;
            const restRotCount = library.stdMaleRestRotations ? library.stdMaleRestRotations.length / 4 : 0;
            const namesCount = library.boneNames ? library.boneNames.length : 0;

            const expected = stdParentsCount || restTransCount || restRotCount || namesCount;
            const weightIndices: Uint16Array | undefined = assetArmature.weights?.indices;

            if (!expected || !weightIndices || !library.stdMaleRestTranslations || !library.stdMaleRestRotations || !library.stdMaleParents) {
                console.warn('Skeleton does not match splat bone data.');
                return;
            }

            let mappedIndices = weightIndices;
            let mappedWeights: Float32Array | undefined = assetArmature.weights?.weights;

            let maxWeightIndex = 0;
            for (let i = 0; i < weightIndices.length; i++) {
                if (weightIndices[i] > maxWeightIndex) {
                    maxWeightIndex = weightIndices[i];
                }
            }
            if (maxWeightIndex >= expected && library.boneNames && library.skeleton1185Names) {
                const nameTo441 = new Map<string, number>();
                library.boneNames.forEach((name, idx) => {
                    nameTo441.set(name, idx);
                });
                const map1185To441 = library.skeleton1185Names.map((name) => {
                    const idx = nameTo441.get(name);
                    return idx === undefined ? -1 : idx;
                });

                mappedIndices = new Uint16Array(weightIndices.length);
                mappedWeights = new Float32Array(mappedIndices.length);
                const sourceWeights: Float32Array | undefined = assetArmature.weights?.weights;
                for (let splatIdx = 0; splatIdx < mappedIndices.length / 4; splatIdx++) {
                    let sum = 0;
                    for (let j = 0; j < 4; j++) {
                        const idx = weightIndices[splatIdx * 4 + j];
                        const mapped = idx < map1185To441.length ? map1185To441[idx] : -1;
                        if (mapped >= 0) {
                            mappedIndices[splatIdx * 4 + j] = mapped;
                            mappedWeights[splatIdx * 4 + j] = sourceWeights ? sourceWeights[splatIdx * 4 + j] : 0;
                            sum += mappedWeights[splatIdx * 4 + j];
                        } else {
                            mappedIndices[splatIdx * 4 + j] = 0;
                            mappedWeights[splatIdx * 4 + j] = 0;
                        }
                    }
                    if (sum > 0) {
                        for (let j = 0; j < 4; j++) {
                            mappedWeights[splatIdx * 4 + j] /= sum;
                        }
                    }
                }
            }

            let hasMatch = false;
            for (let i = 0; i < mappedIndices.length; i++) {
                if (mappedIndices[i] < expected) {
                    hasMatch = true;
                    break;
                }
            }

            if (!hasMatch) {
                console.warn('Skeleton does not match splat bone data.');
                return;
            }

            if (splat.linkedArmature) {
                const existing = splat.linkedArmature;
                existing.unlinkSplat(splat);
                if (existing.linkedSplats.size === 0) {
                    existing.remove();
                }
            }

            const armatureData = {
                numBones: expected,
                weights: {
                    indices: mappedIndices,
                    weights: mappedWeights || assetArmature.weights.weights
                },
                joints: assetArmature.joints,
                skeleton: library.parents,
                stdMaleRestTranslations: library.stdMaleRestTranslations,
                stdMaleRestRotations: library.stdMaleRestRotations,
                stdMaleParents: library.stdMaleParents
            };

            const { Armature } = await import('../armature/armature');
            const armatureName = `${splat.name}_Armature`;
            const armature = new Armature(armatureName, armatureData);
            scene.add(armature);
            armature.linkSplat(splat);
        };

        skeletonSelect.on('change', (value: string) => {
            if (uiUpdating) {
                return;
            }
            const selection = events.invoke('selection') as SceneObject | null;
            if (!selection || !(selection instanceof Splat)) {
                return;
            }
            selection.selectedSkeleton = value || 'none';
            void bindSkeleton(selection, value || 'none');
        });

        // toggle ui availability based on selection
        const buildSkeletonOptions = () => {
            const scene = window.scene;
            const library = scene?.skeletonLibrary;
            const options = [{ v: 'none', t: 'None' }];

            const hasParents = !!(library?.parents && library.parents.length > 0);
            const hasStdMale = !!(library?.stdMaleRestRotations && library.stdMaleRestRotations.length > 0);

            if (hasParents && hasStdMale) {
                options.push({ v: 'skeleton', t: 'Skeleton' });
            } else if (hasParents) {
                options.push({ v: 'skeleton', t: 'Skeleton (parents only)' });
            } else if (hasStdMale) {
                options.push({ v: 'skeleton', t: 'Skeleton (std_male only)' });
            }

            return options;
        };

        const buildAnimationOptions = () => {
            const scene = window.scene;
            const options = [{ v: 'none', t: 'None' }];

            const library = scene?.animationLibrary;
            if (library) {
                for (const key of library.keys()) {
                    options.push({ v: key, t: key });
                }
            }

            return options;
        };

        const applySelectionState = (selection: SceneObject | null) => {
            const isSelected = !!selection;
            const isSplat = selection instanceof Splat;
            if (isSplat) {
                skeletonSelect.options = buildSkeletonOptions();
                animationSelect.options = buildAnimationOptions();
            }
            positionVector.enabled = rotationVector.enabled = scaleInput.enabled = isSelected;
            animationSelect.enabled = isSelected;
            skeletonSelect.enabled = isSplat;
            skeleton.hidden = !isSelected || !isSplat;
            if (isSelected) {
                uiUpdating = true;
                animationSelect.value = selection.selectedAnimation || 'none';
                const nextSkeleton = isSplat ? selection.selectedSkeleton : 'none';
                const hasOption = skeletonSelect.options.some((opt) => opt.v === nextSkeleton);
                skeletonSelect.value = hasOption ? nextSkeleton : 'none';
                uiUpdating = false;
            } else {
                uiUpdating = true;
                animationSelect.value = 'none';
                skeletonSelect.value = 'none';
                uiUpdating = false;
            }
        };

        events.on('selection.changed', (selection) => {
            applySelectionState(selection as SceneObject | null);
        });

        applySelectionState(events.invoke('selection') as SceneObject | null);

        events.on('pivot.placed', (pivot: Pivot) => {
            updateUI();
        });

        events.on('pivot.moved', (pivot: Pivot) => {
            if (!mouseUpdating) {
                updateUI();
            }
        });

        events.on('pivot.ended', (pivot: Pivot) => {
            updateUI();
        });
    }
}

export { Transform };
