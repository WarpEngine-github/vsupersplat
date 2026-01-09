import { EntityTransformHandler } from './entity-transform-handler';
import { Events } from '../events';
import { registerPivotEvents } from './pivot';
import { Splat } from '../splat/splat';
import { SplatsTransformHandler } from './splats-transform-handler';
import { SceneObject } from '../core/scene-object';

interface TransformHandler {
    activate: () => void;
    deactivate: () => void;
}

const registerTransformHandlerEvents = (events: Events) => {
    const transformHandlers: TransformHandler[] = [];

    const push = (handler: TransformHandler) => {
        if (transformHandlers.length > 0) {
            const transformHandler = transformHandlers[transformHandlers.length - 1];
            transformHandler.deactivate();
        }
        transformHandlers.push(handler);
        handler.activate();
    };

    const pop = () => {
        if (transformHandlers.length > 0) {
            const transformHandler = transformHandlers.pop();
            transformHandler.deactivate();
        }
        if (transformHandlers.length > 0) {
            const transformHandler = transformHandlers[transformHandlers.length - 1];
            transformHandler.activate();
        }
    };

    // bind transform target when selection changes
    const entityTransformHandler = new EntityTransformHandler(events);
    const splatsTransformHandler = new SplatsTransformHandler(events);

    const update = (selection: SceneObject) => {
        pop();
        if (selection) {
            // For splats, check if they have selected gaussians
            if (selection instanceof Splat && selection.numSelected > 0) {
                push(splatsTransformHandler);
            } else {
                // For armatures or splats without selected gaussians, use entity transform
                push(entityTransformHandler);
            }
        }
    };

    events.on('selection.changed', update);
    events.on('splat.stateChanged', update);

    events.on('transformHandler.push', (handler: TransformHandler) => {
        push(handler);
    });

    events.on('transformHandler.pop', () => {
        pop();
    });

    registerPivotEvents(events);
};

export { registerTransformHandlerEvents, TransformHandler };
