import { Mat4, Quat, Vec3 } from 'playcanvas';

import { PlacePivotOp, EntityTransformOp, MultiOp } from '../editor/edit-ops';
import { Events } from '../events';
import { Pivot } from './pivot';
import { Splat } from '../splat/splat';
import { SceneObject } from '../core/scene-object';
import { Transform } from './transform';
import { TransformHandler } from './transform-handler';

const mat = new Mat4();
const quat = new Quat();
const transform = new Transform();

class EntityTransformHandler implements TransformHandler {
    events: Events;
    selection: SceneObject | null = null;
    top: EntityTransformOp;
    pop: PlacePivotOp;
    bindMat = new Mat4();

    constructor(events: Events) {
        this.events = events;

        events.on('pivot.started', (pivot: Pivot) => {
            if (this.selection && this.selection.entity) {
                this.start();
            }
        });

        events.on('pivot.moved', (pivot: Pivot) => {
            if (this.selection && this.selection.entity) {
                this.update(pivot.transform);
            }
        });

        events.on('pivot.ended', (pivot: Pivot) => {
            if (this.selection && this.selection.entity) {
                this.end();
            }
        });

        events.on('pivot.origin', (mode: 'center' | 'boundCenter') => {
            if (this.selection && this.selection.entity) {
                this.placePivot();
            }
        });

        events.on('camera.focalPointPicked', (details: { splat: Splat, position: Vec3 }) => {
            if (this.selection && this.selection.entity && ['move', 'rotate', 'scale'].includes(this.events.invoke('tool.active'))) {
                const pivot = events.invoke('pivot') as Pivot;
                const newt = new Transform(details.position, pivot.transform.rotation, pivot.transform.scale);
                const op = new PlacePivotOp({ pivot, oldt: pivot.transform.clone(), newt });
                events.fire('edit.add', op);
            }
        });
    }

    placePivot() {
        if (!this.selection || !this.selection.entity) {
            return;
        }
        const origin = this.events.invoke('pivot.origin');
        this.selection.getPivot(origin === 'center' ? 'center' : 'boundCenter', false, transform);
        this.events.invoke('pivot').place(transform);
    }

    activate() {
        this.selection = this.events.invoke('selection') as SceneObject;
        if (this.selection && this.selection.entity) {
            this.placePivot();
        }
    }

    deactivate() {
        this.selection = null;
    }

    start() {
        if (!this.selection || !this.selection.entity) {
            return;
        }
        const pivot = this.events.invoke('pivot') as Pivot;
        const { transform } = pivot;
        const { entity } = this.selection;

        this.bindMat.setTRS(transform.position, transform.rotation, transform.scale);
        this.bindMat.invert();
        this.bindMat.mul2(this.bindMat, entity.getLocalTransform());

        const p = entity.getLocalPosition();
        const r = entity.getLocalRotation();
        const s = entity.getLocalScale();

        this.top = new EntityTransformOp({
            splat: this.selection,
            oldt: new Transform(p, r, s),
            newt: new Transform(p, r, s)
        });

        this.pop = new PlacePivotOp({
            pivot,
            oldt: transform.clone(),
            newt: transform.clone()
        });
    }

    update(transform: Transform) {
        if (!this.selection || !this.selection.entity) {
            return;
        }
        mat.setTRS(transform.position, transform.rotation, transform.scale);
        mat.mul2(mat, this.bindMat);
        quat.setFromMat4(mat);

        const t = mat.getTranslation();
        const r = quat;
        const s = mat.getScale();

        this.selection.move(t, r, s);
        this.top.newt.set(t, r, s);
        this.pop.newt.copy(transform);
    }

    end() {
        if (!this.top || !this.pop) {
            return;
        }
        const { oldt, newt } = this.top;

        if (!oldt.equals(newt)) {
            this.events.fire('edit.add', new MultiOp([this.top, this.pop]));
        }

        this.top = null;
        this.pop = null;
    }
}

export { EntityTransformHandler };
