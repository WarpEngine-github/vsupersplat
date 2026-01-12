import {
    BLENDEQUATION_ADD,
    BLENDMODE_ONE,
    BLENDMODE_ONE_MINUS_SRC_ALPHA,
    BLENDMODE_SRC_ALPHA,
    CULLFACE_FRONT,
    BlendState,
    BoundingBox,
    DepthState,
    Entity,
    Mat4,
    ShaderMaterial,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from '../core/element';
import { Serializer } from '../serializer';
import { sphereVertexShader, sphereFragmentShader } from '../shaders/bone-shape-shader';

const v = new Vec3();
const bound = new BoundingBox();

class BoneShape extends Element {
    _radius = 0.05;
    _jointLocation: Vec3 | null = null;  // Changed: nullable, initialized to null
    pivot: Entity;
    jointPivot: Entity | null = null;  // Joint sphere (bone end) - nullable
    material: ShaderMaterial;

    constructor() {
        super(ElementType.debug);

        this.pivot = new Entity('bonePivot');
        this.pivot.addComponent('render', {
            type: 'box'
        });
        const r = this._radius * 2;
        this.pivot.setLocalScale(r, r, r);
    }

    add() {
        const material = new ShaderMaterial({
            uniqueName: 'boneShape',
            vertexGLSL: sphereVertexShader,
            fragmentGLSL: sphereFragmentShader
        });
        material.cull = CULLFACE_FRONT;
        material.blendState = BlendState.NOBLEND;
        material.depthState = DepthState.NODEPTH;
        material.update();

        this.pivot.render.meshInstances[0].material = material;
        this.pivot.render.layers = [this.scene.gizmoLayer.id];

        this.material = material;

        this.scene.contentRoot.addChild(this.pivot);

        this.updateBound();
    }

    remove() {
        if (this.pivot.parent) {
            this.pivot.parent.removeChild(this.pivot);
        }
        this.scene.boundDirty = true;
    }

    destroy() {
        // Nothing to destroy
    }

    serialize(serializer: Serializer): void {
        serializer.packa(this.pivot.getWorldTransform().data);
        serializer.pack(this.radius);
    }

    onPreRender() {
        if (!this.pivot.enabled) {
            return;
        }

        // Set depth state to render on top
        const device = this.scene.graphicsDevice;
        device.setDepthState(DepthState.NODEPTH);

        this.pivot.getWorldTransform().getTranslation(v);
        this.material.setParameter('sphere', [v.x, v.y, v.z, this.radius]);

        // Set targetSize via device scope (like sphere-shape does)
        device.scope.resolve('targetSize').setValue([device.width, device.height]);
        
        // Camera uniforms (near_origin, near_x, near_y, far_origin, far_x, far_y) 
        // are set automatically by camera.updateCameraUniforms() via device.scope
        // matrix_viewProjection is set automatically by PlayCanvas
    }

    moved() {
        this.updateBound();
    }

    updateBound() {
        bound.center.copy(this.pivot.getPosition());
        bound.halfExtents.set(this.radius, this.radius, this.radius);
        if (this.scene) {
            this.scene.boundDirty = true;
        }
    }

    get worldBound(): BoundingBox | null {
        return bound;
    }

    /**
     * Set bone position (joint location)
     */
    setPosition(position: Vec3) {
        this.pivot.setLocalPosition(position);
        this.updateBound();
    }

    set radius(radius: number) {
        if(radius != this._radius) {
            this._radius = radius;
            const r = this._radius * 2;
            this.pivot.setLocalScale(r, r, r);
            this.updateBound();
        }
    }
    get radius() {
        return this._radius;
    }

    set jointLocation(jointLocation: Vec3 | null) {  // Changed: accepts null
        this._jointLocation = jointLocation;
        this.updateBound();
    }
    
    get jointLocation(): Vec3 | null {  // Changed: returns nullable
        return this._jointLocation;
    }
}

export { BoneShape };
