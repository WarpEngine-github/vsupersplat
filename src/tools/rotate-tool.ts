import { RotateGizmo } from 'playcanvas';

import { TransformTool } from './transform-tool';
import { Events } from '../events';
import { Scene } from '../core/scene';

class RotateTool extends TransformTool {
    constructor(events: Events, scene: Scene) {
        const gizmo = new RotateGizmo(scene.camera.entity.camera, scene.gizmoLayer);
        gizmo.rotationMode = 'orbit';

        super(gizmo, events, scene);
    }
}

export { RotateTool };
