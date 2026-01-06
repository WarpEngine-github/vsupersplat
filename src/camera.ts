import {
    math,
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_NEAREST,
    PIXELFORMAT_RGBA8,
    PIXELFORMAT_RGBA16F,
    PIXELFORMAT_DEPTH,
    PROJECTION_ORTHOGRAPHIC,
    PROJECTION_PERSPECTIVE,
    TONEMAP_NONE,
    TONEMAP_ACES,
    TONEMAP_ACES2,
    TONEMAP_FILMIC,
    TONEMAP_HEJL,
    TONEMAP_LINEAR,
    TONEMAP_NEUTRAL,
    BoundingBox,
    Entity,
    Mat4,
    Picker,
    Plane,
    Quat,
    Ray,
    RenderTarget,
    Texture,
    Vec3,
    Vec4,
    WebglGraphicsDevice
} from 'playcanvas';

import { PointerController } from './controllers';
import { Element, ElementType } from './element';
import { Serializer } from './serializer';
import { Splat } from './splat';
import { TweenValue } from './tween-value';

// calculate the forward vector given azimuth and elevation
const calcForwardVec = (result: Vec3, azim: number, elev: number) => {
    const ex = elev * math.DEG_TO_RAD;
    const ey = azim * math.DEG_TO_RAD;
    const s1 = Math.sin(-ex);
    const c1 = Math.cos(-ex);
    const s2 = Math.sin(-ey);
    const c2 = Math.cos(-ey);
    result.set(-c1 * s2, s1, c1 * c2);
};

// work globals
const forwardVec = new Vec3();
const cameraPosition = new Vec3();
const plane = new Plane();
const ray = new Ray();
const vec = new Vec3();
const vecb = new Vec3();
const va = new Vec3();
const m = new Mat4();
const v4 = new Vec4();

// modulo dealing with negative numbers
const mod = (n: number, m: number) => ((n % m) + m) % m;

class Camera extends Element {
    controller: PointerController;
    entity: Entity;
    positionTween = new TweenValue({ x: 0, y: 0, z: 1 });
    rotationTween = new TweenValue({ x: 0, y: 0, z: 0, w: 1 });

    minElev = -90;
    maxElev = 90;

    sceneRadius = 1;

    flySpeed = 5;

    picker: Picker;

    workRenderTarget: RenderTarget;

    // overridden target size
    targetSize: { width: number, height: number } = null;

    suppressFinalBlit = false;

    renderOverlays = true;

    updateCameraUniforms: () => void;

    constructor() {
        super(ElementType.camera);
        // create the camera entity
        this.entity = new Entity('Camera');
        this.entity.addComponent('camera');

        // NOTE: this call is needed for refraction effect to work correctly, but
        // it slows rendering and should only be made when required.
        // this.entity.camera.requestSceneColorMap(true);
    }

    // ortho
    set ortho(value: boolean) {
        if (value !== this.ortho) {
            this.entity.camera.projection = value ? PROJECTION_ORTHOGRAPHIC : PROJECTION_PERSPECTIVE;
            this.scene.events.fire('camera.ortho', value);
        }
    }

    get ortho() {
        return this.entity.camera.projection === PROJECTION_ORTHOGRAPHIC;
    }

    // fov
    set fov(value: number) {
        this.entity.camera.fov = value;
    }

    get fov() {
        return this.entity.camera.fov;
    }

    // tonemapping
    set tonemapping(value: string) {
        const mapping: Record<string, number> = {
            none: TONEMAP_NONE,
            linear: TONEMAP_LINEAR,
            neutral: TONEMAP_NEUTRAL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL
        };

        const tvalue = mapping[value];

        if (tvalue !== undefined && tvalue !== this.entity.camera.toneMapping) {
            this.entity.camera.toneMapping = tvalue;
            this.scene.events.fire('camera.tonemapping', value);
        }
    }

    get tonemapping() {
        switch (this.entity.camera.toneMapping) {
            case TONEMAP_NONE: return 'none';
            case TONEMAP_LINEAR: return 'linear';
            case TONEMAP_NEUTRAL: return 'neutral';
            case TONEMAP_ACES: return 'aces';
            case TONEMAP_ACES2: return 'aces2';
            case TONEMAP_FILMIC: return 'filmic';
            case TONEMAP_HEJL: return 'hejl';
        }
        return 'none';
    }

    // near clip
    set near(value: number) {
        this.entity.camera.nearClip = value;
    }

    get near() {
        return this.entity.camera.nearClip;
    }

    // far clip
    set far(value: number) {
        this.entity.camera.farClip = value;
    }

    get far() {
        return this.entity.camera.farClip;
    }

    // position
    get position() {
        const t = this.positionTween.value;
        return new Vec3(t.x, t.y, t.z);
    }

    // rotation
    get rotation() {
        const t = this.rotationTween.value;
        return new Quat(t.x, t.y, t.z, t.w);
    }

    setPosition(position: Vec3, dampingFactorFactor: number = 1) {
        this.positionTween.goto(position, dampingFactorFactor * this.scene.config.controls.dampingFactor);
    }

    setRotation(rotation: Quat, dampingFactorFactor: number = 1) {
        this.rotationTween.goto({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, dampingFactorFactor * this.scene.config.controls.dampingFactor);
        // return to perspective mode on rotation
        this.ortho = false;
    }

    setPose(position: Vec3, rotation: Quat, dampingFactorFactor: number = 1) {
        this.setPosition(position, dampingFactorFactor);
        this.setRotation(rotation, dampingFactorFactor);
    }

    // transform the world space coordinate to normalized screen coordinate
    worldToScreen(world: Vec3, screen: Vec3) {
        const { camera } = this.entity.camera;
        m.mul2(camera.projectionMatrix, camera.viewMatrix);

        v4.set(world.x, world.y, world.z, 1);
        m.transformVec4(v4, v4);

        screen.x = v4.x / v4.w * 0.5 + 0.5;
        screen.y = 1.0 - (v4.y / v4.w * 0.5 + 0.5);
        screen.z = v4.z / v4.w;
    }

    add() {
        this.scene.cameraRoot.addChild(this.entity);
        this.entity.camera.layers = this.entity.camera.layers.concat([
            this.scene.shadowLayer.id,
            this.scene.debugLayer.id,
            this.scene.gizmoLayer.id
        ]);

        if (this.scene.config.camera.debugRender) {
            this.entity.camera.setShaderPass(`debug_${this.scene.config.camera.debugRender}`);
        }

        const target = document.getElementById('canvas-container');

        this.controller = new PointerController(this, target);

        // apply scene config
        const config = this.scene.config;
        const controls = config.controls;

        // configure background
        this.entity.camera.clearColor.set(0, 0, 0, 0);

        this.minElev = (controls.minPolarAngle * 180) / Math.PI - 90;
        this.maxElev = (controls.maxPolarAngle * 180) / Math.PI - 90;

        // tonemapping
        this.scene.camera.entity.camera.toneMapping = {
            linear: TONEMAP_LINEAR,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            neutral: TONEMAP_NEUTRAL
        }[config.camera.toneMapping];

        // exposure
        this.scene.app.scene.exposure = config.camera.exposure;

        this.fov = config.camera.fov;

        // initial camera position and orientation
        const initialRot = new Quat().setFromEulerAngles(controls.initialElev, controls.initialAzim, 0);
        // Position camera at origin
        const initialPos = new Vec3(0, 0, 0);
        this.setPose(initialPos, initialRot, 0);

        // picker
        const { width, height } = this.scene.targetSize;
        this.picker = new Picker(this.scene.app, width, height);

        // override buffer allocation to use our render target
        this.picker.allocateRenderTarget = () => { };
        this.picker.releaseRenderTarget = () => { };

        this.scene.events.on('scene.boundChanged', this.onBoundChanged, this);

        // prepare camera-specific uniforms
        this.updateCameraUniforms = () => {
            const device = this.scene.graphicsDevice;
            const entity = this.entity;
            const camera = entity.camera;

            const set = (name: string, vec: Vec3) => {
                device.scope.resolve(name).setValue([vec.x, vec.y, vec.z]);
            };

            // get frustum corners in world space
            const points = camera.camera.getFrustumCorners(-100);
            const worldTransform = entity.getWorldTransform();
            for (let i = 0; i < points.length; i++) {
                worldTransform.transformPoint(points[i], points[i]);
            }

            // near
            if (camera.projection === PROJECTION_PERSPECTIVE) {
                // perspective
                set('near_origin', worldTransform.getTranslation());
                set('near_x', Vec3.ZERO);
                set('near_y', Vec3.ZERO);
            } else {
                // orthographic
                set('near_origin', points[3]);
                set('near_x', va.sub2(points[0], points[3]));
                set('near_y', va.sub2(points[2], points[3]));
            }

            // far
            set('far_origin', points[7]);
            set('far_x', va.sub2(points[4], points[7]));
            set('far_y', va.sub2(points[6], points[7]));
        };

        // temp control of camera start
        const url = new URL(location.href);
        const position = url.searchParams.get('position');
        if (position) {
            const parts = position.toString().split(',');
            if (parts.length === 3) {
                const pos = new Vec3(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
                const rot = this.rotation;
                this.setPose(pos, rot, 0);
            }
        }
        const rotation = url.searchParams.get('rotation');
        if (rotation) {
            const parts = rotation.toString().split(',');
            if (parts.length === 4) {
                const rot = new Quat(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
                const pos = this.position;
                this.setPose(pos, rot, 0);
            }
        }
    }

    remove() {
        this.controller.destroy();
        this.controller = null;

        this.entity.camera.layers = this.entity.camera.layers.filter(layer => layer !== this.scene.shadowLayer.id);
        this.scene.cameraRoot.removeChild(this.entity);

        // destroy doesn't exist on picker?
        // this.picker.destroy();
        this.picker = null;

        this.scene.events.off('scene.boundChanged', this.onBoundChanged, this);
    }

    // handle the scene's bound changing
    onBoundChanged(bound: BoundingBox) {
        this.sceneRadius = Math.max(1e-03, bound.halfExtents.length());
    }

    serialize(serializer: Serializer) {
        serializer.packa(this.entity.getWorldTransform().data);
        serializer.pack(
            this.fov,
            this.tonemapping,
            this.entity.camera.renderTarget?.width,
            this.entity.camera.renderTarget?.height
        );
    }

    // handle the viewer canvas resizing
    rebuildRenderTargets() {
        const device = this.scene.graphicsDevice;
        const { width, height } = this.targetSize ?? this.scene.targetSize;
        const format = this.scene.events.invoke('camera.highPrecision') ? PIXELFORMAT_RGBA16F : PIXELFORMAT_RGBA8;

        const rt = this.entity.camera.renderTarget;
        if (rt && rt.width === width && rt.height === height && rt.colorBuffer.format === format) {
            return;
        }

        // out with the old
        if (rt) {
            rt.destroyTextureBuffers();
            rt.destroy();

            this.workRenderTarget.destroy();
            this.workRenderTarget = null;
        }

        const createTexture = (name: string, width: number, height: number, format: number) => {
            return new Texture(device, {
                name,
                width,
                height,
                format,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        };

        // in with the new
        const colorBuffer = createTexture('cameraColor', width, height, format);
        const depthBuffer = createTexture('cameraDepth', width, height, PIXELFORMAT_DEPTH);
        const renderTarget = new RenderTarget({
            colorBuffer,
            depthBuffer,
            flipY: false,
            autoResolve: false
        });
        this.entity.camera.renderTarget = renderTarget;
        this.entity.camera.horizontalFov = width > height;

        const workColorBuffer = createTexture('workColor', width, height, PIXELFORMAT_RGBA8);

        // create pick mode render target (reuse color buffer)
        this.workRenderTarget = new RenderTarget({
            colorBuffer: workColorBuffer,
            depth: false,
            autoResolve: false
        });

        // set picker render target
        // @ts-ignore
        this.picker.renderTarget = this.workRenderTarget;

        this.scene.events.fire('camera.resize', { width, height });
    }

    onUpdate(deltaTime: number) {
        // controller update
        this.controller.update(deltaTime);

        // update underlying values
        this.positionTween.update(deltaTime);
        this.rotationTween.update(deltaTime);

        const pos = this.positionTween.value;
        const rot = this.rotationTween.value;

        cameraPosition.set(pos.x, pos.y, pos.z);
        this.entity.setLocalPosition(cameraPosition);
        
        const rotQuat = new Quat(rot.x, rot.y, rot.z, rot.w);
        this.entity.setLocalRotation(rotQuat);

        this.fitClippingPlanes(this.entity.getLocalPosition(), this.entity.forward);

        const { camera } = this.entity;
        // Calculate ortho height from scene bounds
        const boundRadius = this.scene.bound.halfExtents.length();
        camera.orthoHeight = boundRadius * 2 * (this.fov / 90) * (camera.horizontalFov ? this.scene.targetSize.height / this.scene.targetSize.width : 1);
        camera.camera._updateViewProjMat();
    }

    fitClippingPlanes(cameraPosition: Vec3, forwardVec: Vec3) {
        const bound = this.scene.bound;
        const boundRadius = bound.halfExtents.length();

        vec.sub2(bound.center, cameraPosition);
        const dist = vec.dot(forwardVec);

        if (dist > 0) {
            this.far = dist + boundRadius;
            // if camera is placed inside the sphere bound calculate near based far
            this.near = Math.max(1e-6, dist < boundRadius ? this.far / (1024 * 16) : dist - boundRadius);
        } else {
            // if the scene is behind the camera
            this.far = boundRadius * 2;
            this.near = this.far / (1024 * 16);
        }
    }

    onPreRender() {
        this.rebuildRenderTargets();
        this.updateCameraUniforms();
    }

    onPostRender() {
        const device = this.scene.graphicsDevice as WebglGraphicsDevice;
        const renderTarget = this.entity.camera.renderTarget;

        // resolve msaa buffer
        if (renderTarget.samples > 1) {
            renderTarget.resolve(true, false);
        }

        // copy render target
        if (!this.suppressFinalBlit) {
            device.copyRenderTarget(renderTarget, null, true, false);
        }
    }

    focus(options?: { focalPoint: Vec3, radius: number, speed: number }) {
        const getSplatFocalPoint = () => {
            for (const element of this.scene.elements) {
                if (element.type === ElementType.splat) {
                    const focalPoint = (element as Splat).focalPoint?.();
                    if (focalPoint) {
                        return focalPoint;
                    }
                }
            }
        };

        const focalPoint = options ? options.focalPoint : (getSplatFocalPoint() ?? this.scene.bound.center);
        const focalRadius = options ? options.radius : this.scene.bound.halfExtents.length();

        // Calculate position offset from focal point
        const currentPos = this.position;
        const offset = currentPos.clone().sub(focalPoint);
        const distance = offset.length();
        const newDistance = focalRadius * 1.5; // Position camera at 1.5x radius away
        
        if (distance > 0) {
            offset.normalize().mulScalar(newDistance);
        } else {
            offset.set(0, 0, newDistance);
        }
        
        const newPos = focalPoint.clone().add(offset);
        const newRot = this.rotation; // Keep current rotation
        this.setPose(newPos, newRot, options?.speed ?? 0);
    }

    get fovFactor() {
        // we set the fov of the longer axis. here we get the fov of the other (smaller) axis so framing
        // doesn't cut off the scene.
        const { width, height } = this.scene.targetSize;
        const aspect = (width && height) ? this.entity.camera.horizontalFov ? height / width : width / height : 1;
        const fov = 2 * Math.atan(Math.tan(this.fov * math.DEG_TO_RAD * 0.5) * aspect);
        return Math.sin(fov * 0.5);
    }

    getRay(screenX: number, screenY: number, ray: Ray) {
        const { entity, ortho, scene } = this;
        const cameraPos = this.entity.getPosition();

        // create the pick ray in world space
        if (ortho) {
            entity.camera.screenToWorld(screenX, screenY, -1.0, vec);
            entity.camera.screenToWorld(screenX, screenY, 1.0, vecb);
            vecb.sub(vec).normalize();
            ray.set(vec, vecb);
        } else {
            entity.camera.screenToWorld(screenX, screenY, 1.0, vec);
            vec.sub(cameraPos).normalize();
            ray.set(cameraPos, vec);
        }
    }

    // intersect the scene at the given screen coordinate
    intersect(screenX: number, screenY: number) {
        const { scene } = this;

        const target = scene.canvas;
        const sx = screenX / target.clientWidth * scene.targetSize.width;
        const sy = screenY / target.clientHeight * scene.targetSize.height;

        this.getRay(screenX, screenY, ray);

        const splats = scene.getElementsByType(ElementType.splat);

        let closestD = 0;
        const closestP = new Vec3();
        let closestSplat = null;

        for (let i = 0; i < splats.length; ++i) {
            const splat = splats[i] as Splat;

            this.pickPrep(splat, 'set');
            const pickId = this.pick(sx, sy);

            if (pickId !== -1) {
                splat.calcSplatWorldPosition(pickId, vec);

                // create a plane at the world position facing perpendicular to the camera
                plane.setFromPointNormal(vec, this.entity.forward);

                // find intersection
                if (plane.intersectsRay(ray, vec)) {
                    const distance = vecb.sub2(vec, ray.origin).length();
                    if (!closestSplat || distance < closestD) {
                        closestD = distance;
                        closestP.copy(vec);
                        closestSplat = splat;
                    }
                }
            }
        }

        if (!closestSplat) {
            return null;
        }

        return {
            splat: closestSplat,
            position: closestP,
            distance: closestD
        };
    }

    // intersect the scene at the screen location and move camera to look at this location
    pickFocalPoint(screenX: number, screenY: number) {
        const result = this.intersect(screenX, screenY);
        if (result) {
            const { scene } = this;

            // Calculate rotation to look at the picked point
            const currentPos = this.position;
            const up = new Vec3(0, 1, 0);
            
            const rotMat = new Mat4();
            rotMat.setLookAt(currentPos, result.position, up);
            const newRot = new Quat();
            newRot.setFromMat4(rotMat);
            
            this.setPose(currentPos, newRot, 0);
            scene.events.fire('camera.focalPointPicked', {
                camera: this,
                splat: result.splat,
                position: result.position
            });
        }
    }

    // pick mode

    // render picker contents
    pickPrep(splat: Splat, op: 'add'|'remove'|'set') {
        const { width, height } = this.scene.targetSize;
        const worldLayer = this.scene.app.scene.layers.getLayerByName('World');

        const device = this.scene.graphicsDevice;
        const events = this.scene.events;
        const alpha = events.invoke('camera.mode') === 'rings' ? 0.0 : 0.2;

        // hide non-selected elements
        const splats = this.scene.getElementsByType(ElementType.splat);
        splats.forEach((s: Splat) => {
            s.entity.enabled = s === splat;
        });

        device.scope.resolve('pickerAlpha').setValue(alpha);
        device.scope.resolve('pickMode').setValue(['add', 'remove', 'set'].indexOf(op));
        this.picker.resize(width, height);
        this.picker.prepare(this.entity.camera, this.scene.app.scene, [worldLayer]);

        // re-enable all splats
        splats.forEach((splat: Splat) => {
            splat.entity.enabled = true;
        });
    }

    pick(x: number, y: number) {
        return this.pickRect(x, y, 1, 1)[0];
    }

    pickRect(x: number, y: number, width: number, height: number) {
        const device = this.scene.graphicsDevice as WebglGraphicsDevice;
        const pixels = new Uint8Array(width * height * 4);

        // read pixels
        // @ts-ignore
        device.setRenderTarget(this.picker.renderTarget);
        device.updateBegin();
        // @ts-ignore
        device.readPixels(x, this.picker.renderTarget.height - y - height, width, height, pixels);
        device.updateEnd();

        const result: number[] = [];
        for (let i = 0; i < width * height; i++) {
            result.push(
                pixels[i * 4] |
                (pixels[i * 4 + 1] << 8) |
                (pixels[i * 4 + 2] << 16) |
                (pixels[i * 4 + 3] << 24)
            );
        }

        return result;
    }

    docSerialize() {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];
        const pack4 = (q: Quat) => [q.x, q.y, q.z, q.w];
        const pos = this.position;
        const rot = this.rotation;

        return {
            position: pack3(pos),
            rotation: pack4(rot),
            fov: this.fov,
            tonemapping: this.tonemapping
        };
    }

    docDeserialize(settings: any) {
        if (settings.position && settings.rotation) {
            const pos = new Vec3(settings.position[0], settings.position[1], settings.position[2]);
            const rot = new Quat(settings.rotation[0], settings.rotation[1], settings.rotation[2], settings.rotation[3]);
            this.setPose(pos, rot, 0);
        } else if (settings.focalPoint && settings.azim !== undefined && settings.elev !== undefined) {
            // Backward compatibility: convert old focal point system to position/rotation
            const azim = settings.azim * math.DEG_TO_RAD;
            const elev = settings.elev * math.DEG_TO_RAD;
            const x = Math.sin(azim) * Math.cos(elev);
            const y = -Math.sin(elev);
            const z = Math.cos(azim) * Math.cos(elev);
            const distance = settings.distance ?? 1;
            const pos = new Vec3(
                settings.focalPoint[0] + x * distance,
                settings.focalPoint[1] + y * distance,
                settings.focalPoint[2] + z * distance
            );
            const rot = new Quat().setFromEulerAngles(settings.elev, settings.azim, 0);
            this.setPose(pos, rot, 0);
        }
        this.fov = settings.fov;
        this.tonemapping = settings.tonemapping;
    }

    // offscreen render mode

    startOffscreenMode(width: number, height: number) {
        this.targetSize = { width, height };
        this.suppressFinalBlit = true;
    }

    endOffscreenMode() {
        this.targetSize = null;
        this.suppressFinalBlit = false;
    }
}

export { Camera };

