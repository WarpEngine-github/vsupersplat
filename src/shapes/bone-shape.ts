import {
    BLENDEQUATION_ADD,
    BLENDMODE_ONE_MINUS_SRC_ALPHA,
    BLENDMODE_SRC_ALPHA,
    BlendState,
    BoundingBox,
    DepthState,
    Entity,
    GraphicsDevice,
    IndexBuffer,
    Mesh,
    MeshInstance,
    PRIMITIVE_TRIANGLES,
    SEMANTIC_NORMAL,
    SEMANTIC_POSITION,
    ShaderMaterial,
    TYPE_FLOAT32,
    VertexBuffer,
    VertexFormat,
    Vec3,
    Quat
} from 'playcanvas';

import { Element, ElementType } from '../core/element';
import { Serializer } from '../serializer';

const v = new Vec3();
const bound = new BoundingBox();

/**
 * Creates a Blender-style bone mesh: two spheres at ends + octahedron in middle
 * @param device Graphics device
 * @param length Length of the bone
 * @param radius Radius of the spheres and octahedron
 * @param segments Number of segments for spheres (more = smoother)
 * @returns Mesh instance
 */
function createBlenderBoneMesh(device: GraphicsDevice, length: number, radius: number, segments: number = 16): Mesh {
    const mesh = new Mesh(device);
    
    // Create vertex and index arrays
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    
    // Helper to add a vertex
    const addVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
        vertices.push(x, y, z);
        normals.push(nx, ny, nz);
    };
    
    // Create a single sphere at the origin
    const sphereSegments = segments;
    const sphereRings = Math.max(4, Math.floor(segments / 2));
    
    // Create sphere vertices
    for (let ring = 0; ring <= sphereRings; ring++) {
        const theta = (ring / sphereRings) * Math.PI; // 0 to PI
        const y = radius * Math.cos(theta);
        const ringRadius = radius * Math.sin(theta);
        
        for (let i = 0; i <= sphereSegments; i++) {
            const phi = (i / sphereSegments) * Math.PI * 2;
            const x = ringRadius * Math.cos(phi);
            const z = ringRadius * Math.sin(phi);
            
            // Normal points outward from sphere center
            const normalY = Math.cos(theta);
            const normalRadius = Math.sin(theta);
            const nx = normalRadius * Math.cos(phi);
            const ny = normalY;
            const nz = normalRadius * Math.sin(phi);
            
            addVertex(x, y, z, nx, ny, nz);
        }
    }
    
    // Create sphere indices
    for (let ring = 0; ring < sphereRings; ring++) {
        for (let i = 0; i < sphereSegments; i++) {
            const current = ring * (sphereSegments + 1) + i;
            const next = ring * (sphereSegments + 1) + (i + 1);
            const below = (ring + 1) * (sphereSegments + 1) + i;
            const belowNext = (ring + 1) * (sphereSegments + 1) + (i + 1);
            
            indices.push(current, below, next);
            indices.push(next, below, belowNext);
        }
    }
    
    vertexOffset = (sphereRings + 1) * (sphereSegments + 1);
    
    // Convert to interleaved format
    const totalVertices = vertices.length / 3;
    const vertexData = new Float32Array(totalVertices * 6);
    for (let i = 0; i < totalVertices; i++) {
        const offset = i * 6;
        vertexData[offset + 0] = vertices[i * 3 + 0];
        vertexData[offset + 1] = vertices[i * 3 + 1];
        vertexData[offset + 2] = vertices[i * 3 + 2];
        vertexData[offset + 3] = normals[i * 3 + 0];
        vertexData[offset + 4] = normals[i * 3 + 1];
        vertexData[offset + 5] = normals[i * 3 + 2];
    }
    
    // Create vertex format
    const vertexFormat = new VertexFormat(device, [
        { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
        { semantic: SEMANTIC_NORMAL, components: 3, type: TYPE_FLOAT32 }
    ]);
    
    // Create vertex buffer with interleaved data
    const vertexBuffer = new VertexBuffer(
        device,
        vertexFormat,
        totalVertices,
        {
            usage: 1, // BUFFER_STATIC
            data: vertexData.buffer
        }
    );
    
    mesh.vertexBuffer = vertexBuffer;
    mesh.primitive[0] = {
        type: PRIMITIVE_TRIANGLES,
        base: 0,
        baseVertex: 0,
        count: indices.length,
        indexed: true
    };
    
    // Create index buffer
    // IndexBuffer(device, format, numIndices, usage, data)
    const indexData = new Uint16Array(indices);
    const indexBuffer = new IndexBuffer(device, 1, indices.length, 1, indexData.buffer);
    mesh.indexBuffer[0] = indexBuffer;
    
    // Calculate bounding box manually
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < totalVertices; i++) {
        const offset = i * 6;
        const x = vertexData[offset + 0];
        const y = vertexData[offset + 1];
        const z = vertexData[offset + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }
    const aabb = new BoundingBox();
    aabb.center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    aabb.halfExtents.set((maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5);
    mesh.aabb = aabb;
    
    return mesh;
}

class BoneShape extends Element {
    pivot: Entity;
    meshInstance: MeshInstance;
    material: ShaderMaterial;
    _length: number = -1; // Initialize to -1 to force mesh recreation on first setBoneTransform call
    _radius: number = 0.01;
    private mesh: Mesh | null = null;
    
    constructor() {
        super(ElementType.debug);
        
        this.pivot = new Entity('bonePivot');
    }
    
    add() {
        const device = this.scene.graphicsDevice;
        
        // Create Blender-style bone mesh at fixed base length (1.0)
        // All bones use the same mesh, scaled uniformly to maintain proportions
        if (!this.mesh) {
            this.mesh = createBlenderBoneMesh(device, 1.0, this._radius, 16);
        }
        
        // Create simple material
        this.material = new ShaderMaterial({
            uniqueName: 'boneShape',
            attributes: {
                vertex_position: SEMANTIC_POSITION,
                vertex_normal: SEMANTIC_NORMAL
            },
            vertexGLSL: `
                attribute vec3 vertex_position;
                attribute vec3 vertex_normal;
                
                uniform mat4 matrix_model;
                uniform mat4 matrix_viewProjection;
                
                varying vec3 vNormal;
                
                void main(void) {
                    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
                    vNormal = normalize((matrix_model * vec4(vertex_normal, 0.0)).xyz);
                }
            `,
            fragmentGLSL: `
                precision highp float;
                
                varying vec3 vNormal;
                
                void main(void) {
                    // Bright blue color with simple lighting
                    float light = max(0.6, dot(vNormal, normalize(vec3(0.5, 1.0, 0.5))));
                    // Very bright blue: RGB(0.0, 0.5, 1.0) - vibrant cyan-blue
                    gl_FragColor = vec4(0.0, 0.5 * light, 1.0 * light, 1.0);
                }
            `
        });
        
        // No blending - solid color, render on top
        this.material.blendState = BlendState.NOBLEND;
        this.material.depthState = DepthState.NODEPTH; // Render on top of everything
        this.material.update();
        
        this.meshInstance = new MeshInstance(this.mesh, this.material, this.pivot);
        this.meshInstance.cull = false;
        
        this.pivot.addComponent('render', {
            meshInstances: [this.meshInstance]
        });
        
        // Use gizmo layer to render on top
        this.pivot.render.layers = [this.scene.gizmoLayer.id];
        
        // Ensure pivot is enabled
        this.pivot.enabled = true;
        
        this.scene.contentRoot.addChild(this.pivot);
        
        this.updateBound();
    }
    
    onPreRender() {
        if (!this.pivot.enabled || !this.scene) {
            return;
        }
        
        // Set depth state to render on top
        const device = this.scene.graphicsDevice;
        device.setDepthState(DepthState.NODEPTH);
    }
    
    remove() {
        if (this.pivot.parent) {
            this.pivot.parent.removeChild(this.pivot);
        }
        this.scene.boundDirty = true;
    }
    
    destroy() {
        if (this.material) {
            this.material.destroy();
        }
        if (this.mesh) {
            this.mesh.destroy();
        }
    }
    
    serialize(serializer: Serializer): void {
        serializer.packa(this.pivot.getWorldTransform().data);
        serializer.pack(this._length);
        serializer.pack(this._radius);
    }
    
    moved() {
        this.updateBound();
    }
    
    updateBound() {
        this.pivot.getWorldTransform().getTranslation(v);
        const maxExtent = Math.max(this._length * 0.5 + this._radius, this._radius);
        bound.center.copy(v);
        bound.halfExtents.set(maxExtent, maxExtent, maxExtent);
        this.scene.boundDirty = true;
    }
    
    get worldBound(): BoundingBox | null {
        return bound;
    }
    
    /**
     * Set bone transform - simplified to just show a sphere at the joint world position
     */
    setTransform(position: Vec3, rotation: Quat, scale: Vec3) {
        if (!this.pivot) {
            return;
        }
        
        // Enable the bone
        this.pivot.enabled = true;
        
        // Simply place the pivot at the joint world position
        this.pivot.setPosition(position);
        
        // No rotation needed for now
        this.pivot.setRotation(new Quat());
        
        // Constant scale for the sphere
        const SPHERE_SCALE = 0.05;
        this.pivot.setLocalScale(SPHERE_SCALE, SPHERE_SCALE, SPHERE_SCALE);
        
        this.updateBound();
    }
    
    set length(value: number) {
        this._length = value;
        this.updateBound();
    }
    
    get length() {
        return this._length;
    }
    
    set radius(value: number) {
        if (Math.abs(this._radius - value) < 0.0001) {
            return; // No change
        }
        
        this._radius = value;
        
        // Recreate mesh with new radius if it exists
        if (this.mesh && this.scene) {
            this.mesh.destroy();
            const device = this.scene.graphicsDevice;
            this.mesh = createBlenderBoneMesh(device, 1.0, this._radius, 16);
            // Update mesh instance if it exists
            if (this.meshInstance) {
                this.meshInstance.mesh = this.mesh;
            }
        }
        
        this.updateBound();
    }
    
    get radius() {
        return this._radius;
    }
}

export { BoneShape };

