import {
    CULLFACE_FRONT,
    BlendState,
    BoundingBox,
    DepthState,
    Entity,
    ShaderMaterial,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from '../core/element';
import { Serializer } from '../serializer';
import { sphereVertexShader, sphereFragmentShader } from '../shaders/bone-shape-shader';
import { cylinderVertexShader, cylinderFragmentShader } from '../shaders/bone-shape-shader';

const v = new Vec3();
const bound = new BoundingBox();

interface SphereConfig {
    name: string;
    position: Vec3;
    radius: number;
    color: Vec3;
    depthOffset?: number;
}

interface CylinderConfig {
    name: string;
    startPosition: Vec3;
    endPosition: Vec3;
    radius: number;
    color: Vec3;
    depthOffset?: number;
}

class BoneShape extends Element {
    _radius = 0.025;
    _jointRadius = 0.01;
    _parentColor = new Vec3(0.0, 0.5, 1.0);
    _jointColor = new Vec3(0.2, 0.7, 1.0);
    _cylinderColor = new Vec3(1.0, 1.0, 1.0);
    pivot: Entity;
    jointPivot: Entity | null = null;
    cylinder: Entity | null = null;
    material: ShaderMaterial;
    jointMaterial: ShaderMaterial | null = null;
    cylinderMaterial: ShaderMaterial | null = null;

    constructor() {
        super(ElementType.debug);
    }

    private createSphere(config: SphereConfig): { entity: Entity; material: ShaderMaterial } {
        const entity = new Entity(config.name);
        entity.addComponent('render', {
            type: 'box'
        });
        const r = config.radius * 2;
        entity.setLocalScale(r, r, r);
        entity.setPosition(config.position);

        const material = new ShaderMaterial({
            uniqueName: `boneShape_${config.name}`,
            vertexGLSL: sphereVertexShader,
            fragmentGLSL: sphereFragmentShader
        });
        material.cull = CULLFACE_FRONT;
        material.blendState = BlendState.NOBLEND;
        material.depthState = DepthState.DEFAULT;
        
        material.setParameter('sphereColor', [config.color.x, config.color.y, config.color.z]);
        material.setParameter('depthOffset', config.depthOffset !== undefined ? config.depthOffset : 0.0);
        material.update();

        entity.render.meshInstances[0].material = material;
        entity.render.layers = [this.scene.gizmoLayer.id];
        this.scene.contentRoot.addChild(entity);

        return { entity, material };
    }

    private createCylinder(config: CylinderConfig): { entity: Entity; material: ShaderMaterial } {
        const entity = new Entity(config.name);
        entity.addComponent('render', {
            type: 'box'
        });
        
        const midpoint = new Vec3();
        midpoint.add2(config.startPosition, config.endPosition);
        midpoint.mulScalar(0.5);
        entity.setPosition(midpoint);

        const material = new ShaderMaterial({
            uniqueName: `cylinderShape_${config.name}`,
            vertexGLSL: cylinderVertexShader,
            fragmentGLSL: cylinderFragmentShader
        });
        material.cull = CULLFACE_FRONT;
        material.blendState = BlendState.NOBLEND;
        material.depthState = DepthState.DEFAULT;
        
        material.setParameter('startPosition', [config.startPosition.x, config.startPosition.y, config.startPosition.z]);
        material.setParameter('endPosition', [config.endPosition.x, config.endPosition.y, config.endPosition.z]);
        material.setParameter('radius', config.radius);
        material.setParameter('cylinderColor', [config.color.x, config.color.y, config.color.z]);
        material.setParameter('depthOffset', config.depthOffset !== undefined ? config.depthOffset : 0.0);
        material.update();

        entity.render.meshInstances[0].material = material;
        entity.render.layers = [this.scene.gizmoLayer.id];
        this.scene.contentRoot.addChild(entity);

        return { entity, material };
    }

    add() {
        const parentConfig: SphereConfig = {
            name: 'bonePivot',
            position: new Vec3(0, 0, 0),
            radius: this._radius,
            color: this._parentColor,
            depthOffset: -0.005
        };
        const parentSphere = this.createSphere(parentConfig);
        this.pivot = parentSphere.entity;
        this.material = parentSphere.material;
        this.updateBound();
    }

    remove() {
        if (this.pivot.parent) {
            this.pivot.parent.removeChild(this.pivot);
        }
        if (this.jointPivot && this.jointPivot.parent) {
            this.jointPivot.parent.removeChild(this.jointPivot);
        }
        if (this.cylinder && this.cylinder.parent) {
            this.cylinder.parent.removeChild(this.cylinder);
        }
        this.scene.boundDirty = true;
    }

    destroy() {
    }

    serialize(serializer: Serializer): void {
        serializer.packa(this.pivot.getWorldTransform().data);
        serializer.pack(this.radius);
    }

    onPreRender() {
        if (!this.pivot.enabled) {
            return;
        }

        const device = this.scene.graphicsDevice;
        device.scope.resolve('targetSize').setValue([device.width, device.height]);

        this.pivot.getWorldTransform().getTranslation(v);
        this.material.setParameter('sphere', [v.x, v.y, v.z, this._radius]);
        this.material.setParameter('sphereColor', [this._parentColor.x, this._parentColor.y, this._parentColor.z]);
        
        if (this.jointPivot) {
            this.jointPivot.getWorldTransform().getTranslation(v);
            this.jointMaterial!.setParameter('sphere', [v.x, v.y, v.z, this._jointRadius]);
            this.jointMaterial!.setParameter('sphereColor', [this._jointColor.x, this._jointColor.y, this._jointColor.z]);
        }
        
        if (this.cylinder && this.cylinderMaterial) {
            const parentPos = this.pivot.getPosition();
            const jointPos = this.jointPivot ? this.jointPivot.getPosition() : null;
            
            if (jointPos) {
                this.cylinderMaterial.setParameter('startPosition', [parentPos.x, parentPos.y, parentPos.z]);
                this.cylinderMaterial.setParameter('endPosition', [jointPos.x, jointPos.y, jointPos.z]);
                this.cylinderMaterial.setParameter('cylinderColor', [this._cylinderColor.x, this._cylinderColor.y, this._cylinderColor.z]);
            }
        }
    }

    moved() {
        this.updateBound();
    }

    updateBound() {
        bound.center.copy(this.pivot.getPosition());
        bound.halfExtents.set(this.radius, this.radius, this.radius);
        this.scene.boundDirty = true;
    }

    get worldBound(): BoundingBox | null {
        return bound;
    }

    setPivotPosition(position: Vec3) {
        this.pivot.setPosition(position);
        
        if (this.cylinder && this.cylinderMaterial && this.jointPivot) {
            const jointPos = this.jointPivot.getPosition();
            const midpoint = new Vec3();
            midpoint.add2(position, jointPos);
            midpoint.mulScalar(0.5);
            this.cylinder.setPosition(midpoint);
            
            this.cylinderMaterial.setParameter('startPosition', [position.x, position.y, position.z]);
            this.cylinderMaterial.setParameter('endPosition', [jointPos.x, jointPos.y, jointPos.z]);
        }
        
        this.updateBound();
    }

    setJointPosition(position: Vec3 | null) {
        if (position !== null) {
            if (this.jointPivot === null && this.scene) {
                const jointConfig: SphereConfig = {
                    name: 'jointPivot',
                    position: position,
                    radius: this._jointRadius,
                    color: this._jointColor,
                    depthOffset: -0.01
                };
                const jointSphere = this.createSphere(jointConfig);
                this.jointPivot = jointSphere.entity;
                this.jointMaterial = jointSphere.material;
                
                const parentPos = this.pivot.getPosition();
                const cylinderConfig: CylinderConfig = {
                    name: 'boneCylinder',
                    startPosition: parentPos,
                    endPosition: position,
                    radius: this._radius * 0.8,
                    color: this._cylinderColor,
                    depthOffset: 0.002
                };
                const cylinderResult = this.createCylinder(cylinderConfig);
                this.cylinder = cylinderResult.entity;
                this.cylinderMaterial = cylinderResult.material;
            } else if (this.jointPivot) {
                this.jointPivot.setPosition(position);
                
                if (this.cylinder && this.cylinderMaterial) {
                    const parentPos = this.pivot.getPosition();
                    const midpoint = new Vec3();
                    midpoint.add2(parentPos, position);
                    midpoint.mulScalar(0.5);
                    this.cylinder.setPosition(midpoint);
                    
                    this.cylinderMaterial.setParameter('startPosition', [parentPos.x, parentPos.y, parentPos.z]);
                    this.cylinderMaterial.setParameter('endPosition', [position.x, position.y, position.z]);
                }
            }
        } else {
            if (this.jointPivot && this.jointPivot.parent) {
                this.jointPivot.parent.removeChild(this.jointPivot);
                this.jointPivot = null;
                this.jointMaterial = null;
            }
            if (this.cylinder && this.cylinder.parent) {
                this.cylinder.parent.removeChild(this.cylinder);
                this.cylinder = null;
                this.cylinderMaterial = null;
            }
        }
        
        this.updateBound();
    }

    getJointPosition(): Vec3 | null {
        return this.jointPivot ? this.jointPivot.getPosition() : null;
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

    set jointRadius(radius: number) {
        if(radius != this._jointRadius) {
            this._jointRadius = radius;
            if (this.jointPivot) {
                const r = this._jointRadius * 2;
                this.jointPivot.setLocalScale(r, r, r);
                this.updateBound();
            }
        }
    }
    get jointRadius() {
        return this._jointRadius;
    }

    set parentColor(color: Vec3) {
        this._parentColor.copy(color);
        if (this.material) {
            this.material.setParameter('sphereColor', [color.x, color.y, color.z]);
        }
    }
    get parentColor(): Vec3 {
        return this._parentColor;
    }

    set jointColor(color: Vec3) {
        this._jointColor.copy(color);
        if (this.jointMaterial) {
            this.jointMaterial.setParameter('sphereColor', [color.x, color.y, color.z]);
        }
    }
    get jointColor(): Vec3 {
        return this._jointColor;
    }

    set cylinderColor(color: Vec3) {
        this._cylinderColor.copy(color);
        if (this.cylinderMaterial) {
            this.cylinderMaterial.setParameter('cylinderColor', [color.x, color.y, color.z]);
        }
    }
    get cylinderColor(): Vec3 {
        return this._cylinderColor;
    }
}

export { BoneShape };
