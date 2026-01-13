import { BoundingBox, Quat, Vec3 } from 'playcanvas';

import { Scene } from './scene';
import { Serializer } from '../serializer';

enum ElementType {
    camera = 'camera',
    model = 'model',
    splat = 'splat',
    armature = 'armature',
    shadow = 'shadow',
    debug = 'debug',
    other = 'other'
}

const ElementTypeList = [
    ElementType.camera,
    ElementType.model,
    ElementType.splat,
    ElementType.armature,
    ElementType.shadow,
    ElementType.debug,
    ElementType.other
];

let nextUid = 1;

class Element {
    type: ElementType;
    scene: Scene = null;
    uid: number;
    _name: string = '';
    private _childElements: Set<Element> = new Set();
    private _originalAddChild: ((child: any) => void) | null = null;
    private _originalRemoveChild: ((child: any) => void) | null = null;

    constructor(type: ElementType) {
        this.type = type;
        this.uid = nextUid++;
    }

    /**
     * Get the child container object (e.g., Entity in PlayCanvas)
     * Override in subclasses that support child tracking via a container object
     * Return null if this element doesn't support child tracking
     */
    protected getChildContainer(): any {
        return null;
    }

    /**
     * Add a child element to this element's children list
     */
    protected addChildElement(child: Element) {
        this._childElements.add(child);
    }

    /**
     * Remove a child element from this element's children list
     */
    protected removeChildElement(child: Element) {
        this._childElements.delete(child);
    }

    /**
     * Get all child elements
     */
    get childElements(): ReadonlySet<Element> {
        return this._childElements;
    }

    /**
     * Calls moved() on all child elements
     * Override in subclasses if special behavior is needed
     */
    protected callMovedOnChildren() {
        for (const child of this._childElements) {
            child.moved();
        }
    }

    /**
     * Called when a child object is added (e.g., an Entity in PlayCanvas)
     * Finds the associated Element and tracks it as a child
     * Override in subclasses to provide platform-specific child object type
     */
    protected onChildObjectAdded(childObject: any) {
        if (!this.scene) {
            return;
        }

        // Find the Element associated with this child object
        // Default implementation looks for elements with an 'entity' property matching the child object
        for (const element of this.scene.elements) {
            if ((element as any).entity === childObject) {
                this.addChildElement(element);
                break;
            }
        }
    }

    /**
     * Called when a child object is removed (e.g., an Entity in PlayCanvas)
     * Finds the associated Element and untracks it
     * Override in subclasses to provide platform-specific child object type
     */
    protected onChildObjectRemoved(childObject: any) {
        if (!this.scene) {
            return;
        }

        // Find and remove the Element associated with this child object
        // Default implementation looks for elements with an 'entity' property matching the child object
        for (const element of this.scene.elements) {
            if ((element as any).entity === childObject) {
                this.removeChildElement(element);
                break;
            }
        }
    }

    /**
     * Set up automatic child tracking
     * Hooks into the child container's addChild/removeChild methods
     * Called from add() method
     */
    protected setupChildTracking() {
        const container = this.getChildContainer();
        if (!container || !this.scene || !container.addChild || !container.removeChild) {
            return;
        }

        // Store original methods
        this._originalAddChild = container.addChild.bind(container);
        this._originalRemoveChild = container.removeChild.bind(container);

        // Wrap addChild to automatically track child elements
        container.addChild = (child: any) => {
            this._originalAddChild!(child);
            this.onChildObjectAdded(child);
        };

        // Wrap removeChild to automatically untrack child elements
        container.removeChild = (child: any) => {
            this._originalRemoveChild!(child);
            this.onChildObjectRemoved(child);
        };
    }

    /**
     * Tear down automatic child tracking
     * Restores original child container methods
     * Called from remove() method
     */
    protected teardownChildTracking() {
        const container = this.getChildContainer();
        if (container && this._originalAddChild && this._originalRemoveChild) {
            container.addChild = this._originalAddChild;
            container.removeChild = this._originalRemoveChild;
            this._originalAddChild = null;
            this._originalRemoveChild = null;
        }
    }

    destroy() {
        if (this.scene) {
            this.scene.remove(this);
        }
    }

    add() {
        // Set up automatic child tracking when element is added to scene
        this.setupChildTracking();
    }

    remove() {
        // Tear down automatic child tracking when element is removed from scene
        this.teardownChildTracking();
    }

    serialize(serializer: Serializer) {}

    onUpdate(deltaTime: number) {}

    onPostUpdate() {}

    onPreRender() {}

    onPostRender() {}

    onAdded(element: Element) {}

    onRemoved(element: Element) {}

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {}

    /**
     * Called when this element is moved
     * Override in subclasses to update bounds or perform other actions
     */
    moved() {}

    get worldBound(): BoundingBox | null {
        return null;
    }
}

export { ElementType, ElementTypeList, Element };
