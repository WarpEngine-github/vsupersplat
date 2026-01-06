import { Quat, Vec3 } from 'playcanvas';

import { Camera } from './camera';

const fromWorldPoint = new Vec3();
const toWorldPoint = new Vec3();
const worldDiff = new Vec3();

// calculate the distance between two 2d points
const dist = (x0: number, y0: number, x1: number, y1: number) => Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);

class PointerController {
    update: (deltaTime: number) => void;
    destroy: () => void;

    constructor(camera: Camera, target: HTMLElement) {

        const orbit = (dx: number, dy: number) => {
            // FPS-style look around: rotate camera around its current position
            const currentRot = camera.rotation.clone();
            // Sensitivity is stored as a multiplier (0.01-5.0), convert to degrees per pixel
            // A value of 1.0 = 1 degree per pixel, 0.3 = 0.3 degrees per pixel
            const sensitivity = camera.scene.config.controls.rotationSensitivity;
            
            // Create rotation deltas in radians (sensitivity is already in degrees per pixel)
            const yawDelta = -dx * sensitivity * Math.PI / 180;
            const pitchDelta = -dy * sensitivity * Math.PI / 180;
            
            // Apply yaw rotation around world UP axis first
            const yawRot = new Quat().setFromAxisAngle(Vec3.UP, yawDelta);
            const afterYaw = new Quat();
            afterYaw.mul2(yawRot, currentRot);
            
            // Get the right vector from the rotated camera to apply pitch
            const right = new Vec3(1, 0, 0);
            afterYaw.transformVector(right, right);
            
            // Clamp pitch by checking current pitch angle
            const forward = new Vec3(0, 0, -1);
            afterYaw.transformVector(forward, forward);
            const currentPitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI;
            const newPitch = currentPitch + (pitchDelta * 180 / Math.PI);
            const clampedPitch = Math.max(-89, Math.min(89, newPitch));
            const pitchDeltaClamped = (clampedPitch - currentPitch) * Math.PI / 180;
            
            // Apply pitch rotation around camera's right vector
            const pitchRot = new Quat().setFromAxisAngle(right, pitchDeltaClamped);
            const finalRot = new Quat();
            finalRot.mul2(pitchRot, afterYaw);
            
            // Use dampingFactorFactor = 0 to set rotation immediately without tweening
            // This prevents accumulation errors when dragging
            camera.setRotation(finalRot, 0);
        };

        const pan = (x: number, y: number, dx: number, dy: number) => {
            // Move camera position in screen space
            const c = camera.entity.camera;
            const currentPos = camera.position;
            const currentRot = camera.rotation;
            
            // Get camera's right and up vectors
            const right = new Vec3(1, 0, 0);
            const up = new Vec3(0, 1, 0);
            currentRot.transformVector(right, right);
            currentRot.transformVector(up, up);
            
            // Calculate pan distance based on camera distance from origin
            const distance = currentPos.length() || 1;
            const panScale = distance * 0.001;
            
            // Pan in screen space
            const panRight = right.mulScalar(-dx * panScale);
            const panUp = up.mulScalar(dy * panScale);
            const newPos = currentPos.clone().add(panRight).add(panUp);
            
            camera.setPosition(newPos);
        };

        // mouse state
        let pressedButton = -1;  // no button pressed, otherwise 0, 1, or 2
        let x: number, y: number;

        // touch state
        let touches: { id: number, x: number, y: number}[] = [];
        let midx: number, midy: number;

        const pointerdown = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // If a button is already pressed, ignore this press
                if (pressedButton !== -1) {
                    return;
                }
                target.setPointerCapture(event.pointerId);
                pressedButton = event.button;
                x = event.offsetX;
                y = event.offsetY;
            } else if (event.pointerType === 'touch') {
                if (touches.length === 0) {
                    target.setPointerCapture(event.pointerId);
                }
                touches.push({
                    x: event.offsetX,
                    y: event.offsetY,
                    id: event.pointerId
                });

                if (touches.length === 2) {
                    midx = (touches[0].x + touches[1].x) * 0.5;
                    midy = (touches[0].y + touches[1].y) * 0.5;
                }
            }
        };

        const pointerup = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // Only release if this is the button that was initially pressed
                if (event.button === pressedButton) {
                    pressedButton = -1;
                    target.releasePointerCapture(event.pointerId);
                }
            } else {
                touches = touches.filter(touch => touch.id !== event.pointerId);
                if (touches.length === 0) {
                    target.releasePointerCapture(event.pointerId);
                }
            }
        };

        const pointermove = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // Only process if we're tracking a button
                if (pressedButton === -1) {
                    return;
                }

                // Verify the button we're tracking is still pressed
                // 1 = left button, 4 = middle button, 2 = right button
                const buttonMask = [1, 4, 2][pressedButton];
                if ((event.buttons & buttonMask) === 0) {
                    // Button is no longer pressed, clean up
                    pressedButton = -1;
                    return;
                }

                const dx = event.offsetX - x;
                const dy = event.offsetY - y;
                x = event.offsetX;
                y = event.offsetY;

                // right button can be used to orbit with ctrl key
                const mod = pressedButton === 2 ?
                    (event.shiftKey || event.ctrlKey ? 'orbit' : null) :
                    null;

                if (mod === 'orbit' || (mod === null && pressedButton === 0)) {
                    orbit(dx, dy);
                } else if (mod === 'pan' || (mod === null && pressedButton === 2)) {
                    pan(x, y, dx, dy);
                }
            } else {
                if (touches.length === 1) {
                    const touch = touches[0];
                    const dx = event.offsetX - touch.x;
                    const dy = event.offsetY - touch.y;
                    touch.x = event.offsetX;
                    touch.y = event.offsetY;
                    orbit(dx, dy);
                } else if (touches.length === 2) {
                    const touch = touches[touches.map(t => t.id).indexOf(event.pointerId)];
                    touch.x = event.offsetX;
                    touch.y = event.offsetY;

                    const mx = (touches[0].x + touches[1].x) * 0.5;
                    const my = (touches[0].y + touches[1].y) * 0.5;

                    pan(mx, my, (mx - midx), (my - midy));

                    midx = mx;
                    midy = my;
                }
            }
        };


        // FIXME: safari sends canvas as target of dblclick event but chrome sends the target element
        const canvas = camera.scene.app.graphicsDevice.canvas;

        const dblclick = (event: globalThis.MouseEvent) => {
            if (event.target === target || event.target === canvas) {
                camera.pickFocalPoint(event.offsetX, event.offsetY);
            }
        };

        // key state
        const keys: any = {
            ArrowUp: 0,
            ArrowDown: 0,
            ArrowLeft: 0,
            ArrowRight: 0,
            w: 0,  // W key
            W: 0,  // W key (uppercase)
            s: 0,  // S key
            S: 0,  // S key (uppercase)
            a: 0,  // A key
            A: 0,  // A key (uppercase)
            d: 0,  // D key
            D: 0   // D key (uppercase)
        };

        const keydown = (event: KeyboardEvent) => {
            if (keys.hasOwnProperty(event.key) && event.target === document.body) {
                keys[event.key] = event.shiftKey ? 10 : (event.ctrlKey || event.metaKey || event.altKey ? 0.1 : 1);
            }
        };

        const keyup = (event: KeyboardEvent) => {
            if (keys.hasOwnProperty(event.key)) {
                keys[event.key] = 0;
            }
        };

        this.update = (deltaTime: number) => {
            // Combine arrow keys and WASD keys
            const x = (keys.ArrowRight + keys.d + keys.D) - (keys.ArrowLeft + keys.a + keys.A);
            const z = (keys.ArrowDown + keys.s + keys.S) - (keys.ArrowUp + keys.w + keys.W);

            if (x || z) {
                const factor = deltaTime * camera.flySpeed;
                const currentPos = camera.position;
                const currentRot = camera.rotation;
                
                // Get camera's right and forward vectors
                const right = new Vec3(1, 0, 0);
                const forward = new Vec3(0, 0, -1);
                currentRot.transformVector(right, right);
                currentRot.transformVector(forward, forward);
                
                const moveRight = right.mulScalar(x * factor);
                const moveForward = forward.mulScalar(-z * factor);
                const newPos = currentPos.clone().add(moveRight).add(moveForward);
                
                camera.setPosition(newPos);
            }
        };

        let destroy: () => void = null;

        const wrap = (target: any, name: string, fn: any, options?: any) => {
            const callback = (event: any) => {
                camera.scene.events.fire('camera.controller', name);
                fn(event);
            };
            target.addEventListener(name, callback, options);
            destroy = () => {
                destroy?.();
                target.removeEventListener(name, callback);
            };
        };

        wrap(target, 'pointerdown', pointerdown);
        wrap(target, 'pointerup', pointerup);
        wrap(target, 'pointermove', pointermove);
        wrap(target, 'dblclick', dblclick);
        wrap(document, 'keydown', keydown);
        wrap(document, 'keyup', keyup);

        this.destroy = destroy;
    }
}

export { PointerController };
