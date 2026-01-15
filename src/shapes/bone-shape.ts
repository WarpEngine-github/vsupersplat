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
    private _localBound: BoundingBox = new BoundingBox();
    private _worldBound: BoundingBox = new BoundingBox();
    private _tmpScale: Vec3 = new Vec3();
    private _tmpDelta: Vec3 = new Vec3();

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
        entity.setLocalPosition(config.position);

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
        entity.setLocalPosition(midpoint);
        this.updateCylinderProxyScale(entity, config.startPosition, config.endPosition, config.radius);

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
        if(this.scene.contentRoot) {
            this.scene.contentRoot.removeChild(this.pivot);
            this.scene.contentRoot.removeChild(this.jointPivot);
            this.scene.contentRoot.removeChild(this.cylinder);
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
            // Get world positions for shader parameters
            const parentWorldPos = new Vec3();
            this.pivot.getWorldTransform().getTranslation(parentWorldPos);
            
            if (this.jointPivot) {
                const jointWorldPos = new Vec3();
                this.jointPivot.getWorldTransform().getTranslation(jointWorldPos);
                
                this.cylinderMaterial.setParameter('startPosition', [parentWorldPos.x, parentWorldPos.y, parentWorldPos.z]);
                this.cylinderMaterial.setParameter('endPosition', [jointWorldPos.x, jointWorldPos.y, jointWorldPos.z]);
                this.cylinderMaterial.setParameter('cylinderColor', [this._cylinderColor.x, this._cylinderColor.y, this._cylinderColor.z]);
            }
        }
    }

    moved() {
        this.updateBound();
    }

    updateBound() {
        // Calculate local bounds encompassing pivot sphere, joint sphere, and cylinder
        // Use local positions since entities are children of armature._entity
        const pivotPos = this.pivot.getLocalPosition();
        const pivotRadius = this._radius;
        
        this._localBound.center.copy(pivotPos);
        this._localBound.halfExtents.set(pivotRadius, pivotRadius, pivotRadius);
        
        // Expand to include joint sphere if it exists
        if (this.jointPivot) {
            const jointPos = this.jointPivot.getLocalPosition();
            const jointRadius = this._jointRadius;
            
            const min = new Vec3();
            const max = new Vec3();
            min.sub2(this._localBound.center, this._localBound.halfExtents);
            max.add2(this._localBound.center, this._localBound.halfExtents);
            
            const jointMin = new Vec3(jointPos.x - jointRadius, jointPos.y - jointRadius, jointPos.z - jointRadius);
            const jointMax = new Vec3(jointPos.x + jointRadius, jointPos.y + jointRadius, jointPos.z + jointRadius);
            
            min.x = Math.min(min.x, jointMin.x);
            min.y = Math.min(min.y, jointMin.y);
            min.z = Math.min(min.z, jointMin.z);
            max.x = Math.max(max.x, jointMax.x);
            max.y = Math.max(max.y, jointMax.y);
            max.z = Math.max(max.z, jointMax.z);
            
            // Also include cylinder endpoints
            if (this.cylinder) {
                const startPos = this.pivot.getLocalPosition();
                const endPos = jointPos;
                const cylinderRadius = this._radius * 0.8;
                
                const startMin = new Vec3(startPos.x - cylinderRadius, startPos.y - cylinderRadius, startPos.z - cylinderRadius);
                const startMax = new Vec3(startPos.x + cylinderRadius, startPos.y + cylinderRadius, startPos.z + cylinderRadius);
                const endMin = new Vec3(endPos.x - cylinderRadius, endPos.y - cylinderRadius, endPos.z - cylinderRadius);
                const endMax = new Vec3(endPos.x + cylinderRadius, endPos.y + cylinderRadius, endPos.z + cylinderRadius);
                
                min.x = Math.min(min.x, startMin.x, endMin.x);
                min.y = Math.min(min.y, startMin.y, endMin.y);
                min.z = Math.min(min.z, startMin.z, endMin.z);
                max.x = Math.max(max.x, startMax.x, endMax.x);
                max.y = Math.max(max.y, startMax.y, endMax.y);
                max.z = Math.max(max.z, startMax.z, endMax.z);
            }
            
            min.add(max);
            min.mulScalar(0.5);
            max.sub(min);
            
            this._localBound.center.copy(min);
            this._localBound.halfExtents.set(Math.abs(max.x), Math.abs(max.y), Math.abs(max.z));
        }
        
        this.scene.boundDirty = true;
    }

    get worldBound(): BoundingBox | null {
        if (!this.pivot) {
            return null;
        }
        
        // Always recalculate world bounds since parent transform may have changed
        // Transform local bounds to world space using pivot's world transform
        this._worldBound.setFromTransformedAabb(this._localBound, this.pivot.getWorldTransform());
        
        return this._worldBound;
    }

    setPivotPosition(position: Vec3) {
        this.pivot.setLocalPosition(position);
        
        if (this.cylinder && this.cylinderMaterial && this.jointPivot) {
            const jointPos = this.jointPivot.getLocalPosition();
            const midpoint = new Vec3();
            midpoint.add2(position, jointPos);
            midpoint.mulScalar(0.5);
            this.cylinder.setLocalPosition(midpoint);
            this.updateCylinderProxyScale(this.cylinder, position, jointPos, this._radius * 0.8);
            
            // Update shader parameters with world positions
            const parentWorldPos = new Vec3();
            this.pivot.getWorldTransform().getTranslation(parentWorldPos);
            const jointWorldPos = new Vec3();
            this.jointPivot.getWorldTransform().getTranslation(jointWorldPos);
            
            this.cylinderMaterial.setParameter('startPosition', [parentWorldPos.x, parentWorldPos.y, parentWorldPos.z]);
            this.cylinderMaterial.setParameter('endPosition', [jointWorldPos.x, jointWorldPos.y, jointWorldPos.z]);
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
                
                const parentPos = this.pivot.getLocalPosition();
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
                this.jointPivot.setLocalPosition(position);
                
                if (this.cylinder && this.cylinderMaterial) {
                    const parentPos = this.pivot.getLocalPosition();
                    const midpoint = new Vec3();
                    midpoint.add2(parentPos, position);
                    midpoint.mulScalar(0.5);
                    this.cylinder.setLocalPosition(midpoint);
                    this.updateCylinderProxyScale(this.cylinder, parentPos, position, this._radius * 0.8);
                    
                    // Update shader parameters with world positions
                    const parentWorldPos = new Vec3();
                    this.pivot.getWorldTransform().getTranslation(parentWorldPos);
                    const jointWorldPos = new Vec3();
                    this.jointPivot.getWorldTransform().getTranslation(jointWorldPos);
                    
                    this.cylinderMaterial.setParameter('startPosition', [parentWorldPos.x, parentWorldPos.y, parentWorldPos.z]);
                    this.cylinderMaterial.setParameter('endPosition', [jointWorldPos.x, jointWorldPos.y, jointWorldPos.z]);
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

    private updateCylinderProxyScale(entity: Entity, startPos: Vec3, endPos: Vec3, radius: number) {
        this._tmpDelta.sub2(endPos, startPos);
        this._tmpScale.set(
            Math.max(Math.abs(this._tmpDelta.x) + radius * 2, 0.0001),
            Math.max(Math.abs(this._tmpDelta.y) + radius * 2, 0.0001),
            Math.max(Math.abs(this._tmpDelta.z) + radius * 2, 0.0001)
        );
        entity.setLocalScale(this._tmpScale);
    }

    getJointPosition(): Vec3 | null {
        return this.jointPivot ? this.jointPivot.getLocalPosition() : null;
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
