import { Element, ElementType } from './element';
import { Events } from '../events';
import { Scene } from './scene';
import { Splat } from '../splat/splat';
import { SceneObject } from './scene-object';

const registerSelectionEvents = (events: Events, scene: Scene) => {
    let selection: SceneObject = null;

    const setSelection = (obj: SceneObject | null) => {
        if (obj !== selection && (!obj || obj.visible)) {
            const prev = selection;
            selection = obj;
            events.fire('selection.changed', selection, prev);
        }
    };

    events.on('selection', (obj: SceneObject) => {
        setSelection(obj);
    });

    events.function('selection', () => {
        return selection;
    });

    events.on('selection.next', () => {
        const sceneObjects = scene.getElementsByType(ElementType.splat).concat(
            scene.getElementsByType(ElementType.armature)
        ) as SceneObject[];
        if (sceneObjects.length > 1) {
            const idx = sceneObjects.indexOf(selection);
            setSelection(sceneObjects[(idx + 1) % sceneObjects.length]);
        }
    });

    events.on('scene.elementAdded', (element: Element) => {
        if (element.type === ElementType.splat || element.type === ElementType.armature) {
            setSelection(element as SceneObject);
        }
    });

    events.on('scene.elementRemoved', (element: Element) => {
        if (element === selection) {
            const sceneObjects = scene.getElementsByType(ElementType.splat).concat(
                scene.getElementsByType(ElementType.armature)
            ) as SceneObject[];
            setSelection(sceneObjects.length === 1 ? null : sceneObjects.find(v => v !== element) || null);
        }
    });

    events.on('splat.visibility', (splat: Splat) => {
        if (splat === selection && !splat.visible) {
            setSelection(null);
        }
    });

    events.on('armature.visibility', (armature: SceneObject) => {
        if (armature === selection && !armature.visible) {
            setSelection(null);
        }
    });

    events.on('camera.focalPointPicked', (details: { splat: Splat }) => {
        setSelection(details.splat);
    });
};

export { registerSelectionEvents };
