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
import { cylinderVertexShader, cylinderFragmentShader } from '../shaders/bone-shape-shader';

const v = new Vec3();
const bound = new BoundingBox();

interface SphereConfig {
    name: string;
    position: Vec3;
    radius: number;
    color: Vec3;  // RGB color
    depthOffset?: number;  // Depth offset for render priority (negative = closer/front)
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
    _radius = 0.05;
    _jointRadius = 0.05;  // Separate radius for joint sphere
    _parentColor = new Vec3(0.0, 0.5, 1.0);  // Default blue
    _jointColor = new Vec3(0.2, 0.7, 1.0);  // Lighter blue for joint
    _cylinderColor = new Vec3(1.0, 1.0, 1.0);  // Default white
    pivot: Entity;
    jointPivot: Entity | null = null;
    cylinder: Entity | null = null;
    material: ShaderMaterial;
    jointMaterial: ShaderMaterial | null = null;
    cylinderMaterial: ShaderMaterial | null = null;
    constructor() {
        super(ElementType.debug);
        // Entities will be created in createSphere()
    }

    /**
     * Create a sphere entity with material and add it to the scene
     * @param config Configuration for the sphere
     * @returns Object containing the entity and material
     */
    private createSphere(config: SphereConfig): { entity: Entity; material: ShaderMaterial } {
        // Create entity
        const entity = new Entity(config.name);
        entity.addComponent('render', {
            type: 'box'
        });
        const r = config.radius * 2;
        entity.setLocalScale(r, r, r);
        entity.setLocalPosition(config.position);

        // Create material with color parameter
        const material = new ShaderMaterial({
            uniqueName: `boneShape_${config.name}`,
            vertexGLSL: sphereVertexShader,
            fragmentGLSL: sphereFragmentShader
        });
        material.cull = CULLFACE_FRONT;
        material.blendState = BlendState.NOBLEND;
        // Use depth testing with offset instead of NODEPTH so joints can render above parents
        material.depthState = DepthState.DEFAULT;
        
        // Set color and depth offset uniforms
        material.setParameter('sphereColor', [config.color.x, config.color.y, config.color.z]);
        material.setParameter('depthOffset', config.depthOffset !== undefined ? config.depthOffset : 0.0);
        material.update();

        entity.render.meshInstances[0].material = material;
        entity.render.layers = [this.scene.gizmoLayer.id];

        this.scene.contentRoot.addChild(entity);

        return { entity, material };
    }

private createCylinder(config: CylinderConfig): { entity: Entity; material: ShaderMaterial } {
    // Create entity (positioned at start position as requested)
    const entity = new Entity(config.name);
    entity.addComponent('render', {
        type: 'box'
    });
    
    // Position at start position (parent location) - world space position equals start position
    entity.setLocalPosition(config.startPosition);
    
    // Use a fixed, large scale that always covers the entire cylinder regardless of viewing angle
    // This prevents clipping and deformation issues
    const axis = new Vec3();
    axis.sub2(config.endPosition, config.startPosition);
    const length = axis.length();
    // Use a scale large enough to cover the cylinder from any angle
    // The diagonal distance from start to end plus radius on all sides
    const maxDim = Math.max(length + config.radius * 2, config.radius * 4) * 2;
    entity.setLocalScale(maxDim, maxDim, maxDim);

    // Create material
    const material = new ShaderMaterial({
        uniqueName: `cylinderShape_${config.name}`,
        vertexGLSL: cylinderVertexShader,
        fragmentGLSL: cylinderFragmentShader
    });
    material.cull = CULLFACE_FRONT;
    material.blendState = BlendState.NOBLEND;
    material.depthState = DepthState.DEFAULT;
    
    // Set uniforms
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
        // Create parent sphere (bone origin) - render first (depth offset 0)
        const parentConfig: SphereConfig = {
            name: 'bonePivot',
            position: new Vec3(0, 0, 0),  // Will be set via setPivotPosition
            radius: this._radius,
            color: this._parentColor,
            depthOffset: 0.0  // No offset for parent
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

        // Set targetSize via device scope (like sphere-shape does)
        const device = this.scene.graphicsDevice;
        device.scope.resolve('targetSize').setValue([device.width, device.height]);

        // Render parent sphere
        this.pivot.getWorldTransform().getTranslation(v);
        this.material.setParameter('sphere', [v.x, v.y, v.z, this._radius]);
        
        // Render joint sphere if it exists
        if (this.jointPivot) {
            this.jointPivot.getWorldTransform().getTranslation(v);
            this.jointMaterial!.setParameter('sphere', [v.x, v.y, v.z, this._jointRadius]);
        }
        
        // Update cylinder uniforms if it exists
        if (this.cylinder && this.cylinderMaterial) {
            const parentPos = this.pivot.getPosition();
            const jointPos = this.jointPivot ? this.jointPivot.getPosition() : null;
            
            if (jointPos) {
                // Update cylinder start/end positions (world space)
                this.cylinderMaterial.setParameter('startPosition', [parentPos.x, parentPos.y, parentPos.z]);
                this.cylinderMaterial.setParameter('endPosition', [jointPos.x, jointPos.y, jointPos.z]);
            }
        }
    }

    moved() {
        this.updateBound();
    }

    updateBound() {
        // Update bound to include both spheres
        if (this.jointPivot) {
            const parentPos = this.pivot.getPosition();
            const jointPos = this.jointPivot.getPosition();
            
            bound.center.set(
                (parentPos.x + jointPos.x) / 2,
                (parentPos.y + jointPos.y) / 2,
                (parentPos.z + jointPos.z) / 2
            );
            
            // Calculate half extents to encompass both spheres (use max radius)
            const maxRadius = Math.max(this._radius, this._jointRadius);
            const dx = Math.abs(jointPos.x - parentPos.x) / 2 + maxRadius;
            const dy = Math.abs(jointPos.y - parentPos.y) / 2 + maxRadius;
            const dz = Math.abs(jointPos.z - parentPos.z) / 2 + maxRadius;
            bound.halfExtents.set(dx, dy, dz);
        } else {
            // Only parent sphere
            bound.center.copy(this.pivot.getPosition());
            bound.halfExtents.set(this._radius, this._radius, this._radius);
        }
        
        if (this.scene) {
            this.scene.boundDirty = true;
        }
    }

    get worldBound(): BoundingBox | null {
        return bound;
    }

    setPivotPosition(position: Vec3) {
        this.pivot.setLocalPosition(position);
        
        // Update cylinder if it exists (start position changed)
        if (this.cylinder && this.cylinderMaterial && this.jointPivot) {
            const jointPos = this.jointPivot.getPosition();
            // Position cylinder at start position (parent location) - world space equals start position
            this.cylinder.setLocalPosition(position);
            
            // Update scale to ensure it covers the cylinder
            const axis = new Vec3();
            axis.sub2(jointPos, position);
            const length = axis.length();
            const maxDim = Math.max(length + this._radius * 2, this._radius * 4) * 2;
            this.cylinder.setLocalScale(maxDim, maxDim, maxDim);
            
            // Update cylinder uniforms
            this.cylinderMaterial.setParameter('startPosition', [position.x, position.y, position.z]);
            this.cylinderMaterial.setParameter('endPosition', [jointPos.x, jointPos.y, jointPos.z]);
        }
        
        this.updateBound();
    }

    setJointPosition(position: Vec3 | null) {
        if (position !== null) {
            // Create joint sphere if it doesn't exist
            if (this.jointPivot === null && this.scene) {
                const jointConfig: SphereConfig = {
                    name: 'jointPivot',
                    position: position,
                    radius: this._jointRadius,
                    color: this._jointColor,
                    depthOffset: -0.01  // Negative offset makes joints render above parents
                };
                const jointSphere = this.createSphere(jointConfig);
                this.jointPivot = jointSphere.entity;
                this.jointMaterial = jointSphere.material;
                
                // Create cylinder connecting parent to joint
                const parentPos = this.pivot.getPosition();
                const cylinderConfig: CylinderConfig = {
                    name: 'boneCylinder',
                    startPosition: parentPos,
                    endPosition: position,
                    radius: this._radius * 0.8,  // Slightly smaller than parent sphere
                    color: this._cylinderColor,
                    depthOffset: 0.001  // Render behind spheres
                };
                const cylinderResult = this.createCylinder(cylinderConfig);
                this.cylinder = cylinderResult.entity;
                this.cylinderMaterial = cylinderResult.material;
            } else if (this.jointPivot) {
                // Update joint position
                this.jointPivot.setLocalPosition(position);
                
                // Update cylinder if it exists
                if (this.cylinder && this.cylinderMaterial) {
                    const parentPos = this.pivot.getPosition();
                    // Position cylinder at start position (parent location) - world space equals start position
                    this.cylinder.setLocalPosition(parentPos);
                    
                    // Update scale to ensure it covers the cylinder
                    const axis = new Vec3();
                    axis.sub2(position, parentPos);
                    const length = axis.length();
                    const maxDim = Math.max(length + this._radius * 2, this._radius * 4) * 2;
                    this.cylinder.setLocalScale(maxDim, maxDim, maxDim);
                    
                    // Update cylinder uniforms
                    this.cylinderMaterial.setParameter('startPosition', [parentPos.x, parentPos.y, parentPos.z]);
                    this.cylinderMaterial.setParameter('endPosition', [position.x, position.y, position.z]);
                }
            }
        } else {
            // Remove joint sphere and cylinder if setting to null
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
