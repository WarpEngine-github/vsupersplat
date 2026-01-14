import { BoundingBox, Color, Entity, Quat, Vec3 } from 'playcanvas';

import { ElementType } from './element';
import { SceneObject } from './scene-object';
import { Transform } from '../transform/transform';

const tmpVec = new Vec3();
const tmpQuat = new Quat();
const tmpScale = new Vec3();
const tmpMin = new Vec3();
const tmpMax = new Vec3();
const tmpA = new Vec3();
const tmpB = new Vec3();
const tmpC = new Vec3();
const tmpD = new Vec3();
const tmpWorldA = new Vec3();
const tmpWorldB = new Vec3();

class CameraObject extends SceneObject {
    private _worldBound: BoundingBox | null = null;
    private _aspect = 1;
    private _baseSize = 0.4;
    private _depthSize = 0.6;

    constructor() {
        super(ElementType.cameraObject);

        this._name = 'Camera Object';

        this._entity = new Entity('cameraObject');
    }

    add() {
        this.scene.contentRoot.addChild(this._entity);

        super.add();
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

    onPreRender() {
        const target = this.scene.targetSize;
        const aspect = target.height ? target.width / target.height : 1;
        if (Math.abs(aspect - this._aspect) > 1e-4) {
            this._aspect = aspect;
        }

        const halfW = (this._baseSize * this._aspect) * 0.5;
        const halfH = this._baseSize * 0.5;
        const depth = this._depthSize;

        // Local-space pyramid points (apex at origin, base at -Z).
        const apex = tmpVec.set(0, 0, 0);
        tmpA.set(-halfW, -halfH, -depth);
        tmpB.set(halfW, -halfH, -depth);
        tmpC.set(halfW, halfH, -depth);
        tmpD.set(-halfW, halfH, -depth);

        const worldMat = this._entity.getWorldTransform();
        const draw = (a: Vec3, b: Vec3) => {
            worldMat.transformPoint(a, tmpWorldA);
            worldMat.transformPoint(b, tmpWorldB);
            this.scene.app.drawLine(tmpWorldA, tmpWorldB, Color.WHITE, true, this.scene.debugLayer);
        };

        draw(apex, tmpA);
        draw(apex, tmpB);
        draw(apex, tmpC);
        draw(apex, tmpD);
        draw(tmpA, tmpB);
        draw(tmpB, tmpC);
        draw(tmpC, tmpD);
        draw(tmpD, tmpA);

        // Update world bound for selection/pivot.
        worldMat.transformPoint(apex, tmpMin);
        tmpMax.copy(tmpMin);

        const updateBounds = (p: Vec3) => {
            worldMat.transformPoint(p, tmpWorldA);
            tmpMin.min(tmpWorldA);
            tmpMax.max(tmpWorldA);
        };

        updateBounds(tmpA);
        updateBounds(tmpB);
        updateBounds(tmpC);
        updateBounds(tmpD);

        if (!this._worldBound) {
            this._worldBound = new BoundingBox();
        }
        this._worldBound.setMinMax(tmpMin, tmpMax);
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
        return this._worldBound;
    }

    getDisplayName(): string {
        return 'Camera Object';
    }

}

export { CameraObject };
