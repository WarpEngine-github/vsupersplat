import { Container, ContainerArgs, Label, NumericInput, VectorInput } from '@playcanvas/pcui';
import { Mat4, Quat, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { localize } from './localization';
import { Pivot } from '../transform/pivot';
import { SceneObject } from '../core/scene-object';

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

        this.append(position);
        this.append(rotation);
        this.append(scale);

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

        // toggle ui availability based on selection
        events.on('selection.changed', (selection) => {
            positionVector.enabled = rotationVector.enabled = scaleInput.enabled = !!selection;
        });

        events.on('pivot.placed', (pivot: Pivot) => {
            updateUI(pivot);
        });

        events.on('pivot.moved', (pivot: Pivot) => {
            if (!mouseUpdating) {
                updateUI(pivot);
            }
        });

        events.on('pivot.ended', (pivot: Pivot) => {
            updateUI(pivot);
        });
    }
}

export { Transform };
