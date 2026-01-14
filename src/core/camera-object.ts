import { BoundingBox, Color, Entity, Quat, StandardMaterial, Vec3 } from 'playcanvas';

import { ElementType } from './element';
import { SceneObject } from './scene-object';
import { Transform } from '../transform/transform';

const tmpVec = new Vec3();
const tmpQuat = new Quat();
const tmpScale = new Vec3();
const tmpMat = new Transform();

class CameraObject extends SceneObject {
    private _worldBound: BoundingBox | null = null;

    constructor() {
        super(ElementType.cameraObject);

        this._name = 'Camera Object';

        const entity = new Entity('cameraObject');
        entity.addComponent('render', { type: 'sphere' });

        const material = new StandardMaterial();
        material.diffuse = new Color(0.2, 0.6, 1.0);
        material.update();

        entity.render.meshInstances[0].material = material;
        entity.setLocalScale(0.2, 0.2, 0.2);

        this._entity = entity;
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) {
            this._entity.setLocalPosition(position);
        }
        if (rotation) {
            this._entity.setLocalRotation(rotation);
        }
        if (scale) {
            this._entity.setLocalScale(scale);
        }
        this.onMoved();
    }

    getPivot(mode: 'center' | 'boundCenter', selection: boolean, result: Transform, space: 'world' | 'local' = 'world') {
        if (space === 'local') {
            const localPos = this._entity.getLocalPosition();
            const localRot = this._entity.getLocalRotation();
            const localScale = this._entity.getLocalScale();

            switch (mode) {
                case 'center':
                    result.set(localPos, localRot, localScale);
                    break;
                case 'boundCenter':
                    result.set(localPos, localRot, localScale);
                    break;
            }
        } else {
            const worldMat = this._entity.getWorldTransform();
            worldMat.getTranslation(tmpVec);
            tmpQuat.setFromMat4(worldMat);
            worldMat.getScale(tmpScale);

            if (mode === 'boundCenter') {
                const bound = this.worldBound;
                if (bound && bound.halfExtents.length() > 0) {
                    result.set(bound.center, tmpQuat, tmpScale);
                    return;
                }
            }

            result.set(tmpVec, tmpQuat, tmpScale);
        }
    }

    get worldBound(): BoundingBox | null {
        const meshInstance = this._entity.render?.meshInstances?.[0];
        if (!meshInstance) {
            return null;
        }

        this._worldBound = meshInstance.aabb;
        return this._worldBound;
    }

    getDisplayName(): string {
        return 'Camera Object';
    }
}

export { CameraObject };
