import { Element, ElementType } from './element';
import { Events } from '../events';
import { SceneObjectRenameOp } from '../editor/edit-ops';
import { Entity, Quat, Vec3 } from 'playcanvas';
import { Transform } from '../transform/transform';
import { BoundingBox } from 'playcanvas';

class SceneObject extends Element {
    _visible: boolean = true;
    protected _entity: Entity;

    constructor(type: ElementType) {
        super(type);
    }

    get entity(): Entity {
        return this._entity;
    }

    /**
     * Return the entity as the child container for automatic tracking
     */
    protected getChildContainer(): any {
        return this._entity;
    }

    /**
     * Remove this scene object from the scene
     * Removes the entity from its parent before calling base remove()
     */
    remove() {
        // Remove entity from its parent if it exists
        if (this._entity && this._entity.parent) {
            this._entity.parent.removeChild(this._entity);
        }
        // Call base remove() to tear down child tracking
        super.remove();
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        throw new Error('SceneObject.move must be implemented by subclass');
    }


    getPivot(mode: 'center' | 'boundCenter', selection: boolean, result: Transform) {
        throw new Error('SceneObject.getPivot must be implemented by subclass');
    }

    get worldBound(): BoundingBox | null {
        return null;
    }

    /**
     * Get visibility state
     */
    get visible(): boolean {
        return this._visible;
    }

    /**
     * Set visibility state
     * Fires a visibility event specific to the element type
     */
    set visible(value: boolean) {
        if (value !== this._visible) {
            this._visible = value;
            this.onVisibilityChanged();
        }
    }

    /**
     * Called when visibility changes
     * Override in subclasses to fire type-specific events
     */
    protected onVisibilityChanged() {
        if (this.scene) {
            const eventName = `${this.type}.visibility` as keyof Events;
            this.scene.events.fire(eventName, this);
        }
    }

    /**
     * Get name (uses base class _name)
     */
    get name(): string {
        return this._name;
    }

    /**
     * Set name (uses base class _name)
     * Fires a name event specific to the element type
     */
    set name(value: string) {
        if (value !== this._name) {
            this._name = value;
            this.onNameChanged();
        }
    }

    /**
     * Called when name changes
     * Override in subclasses to fire type-specific events
     */
    protected onNameChanged() {
        if (this.scene) {
            const eventName = `${this.type}.name` as keyof Events;
            this.scene.events.fire(eventName, this);
        }
    }

    /**
     * Rename this scene object
     * Uses SceneObjectRenameOp for undo/redo support
     * Override in subclasses if special behavior is needed
     */
    rename(newName: string) {
        if (this.scene) {
            this.scene.events.fire('edit.add', new SceneObjectRenameOp(this, newName));
        } else {
            // Fallback if not in scene yet
            this.name = newName;
        }
    }

    /**
     * Called when this object is selected
     * Fires selection event if no current selection exists
     * Override in subclasses if special selection behavior is needed
     */
    onSelected() {
        if (this.scene && !this.scene.events.invoke('selection')) {
            this.scene.events.fire('selection', this as any);
        }
    }

    /**
     * Get display name for UI (e.g., "Splat", "Armature")
     * Override in subclasses to return type-specific display name
     */
    getDisplayName(): string {
        // Default: capitalize first letter of type
        return this.type.charAt(0).toUpperCase() + this.type.slice(1);
    }

    /**
     * Called when this object is moved
     * Fires a moved event specific to the element type
     * Override in subclasses if special behavior is needed
     */
    protected onMoved() {
        if (this.scene) {
            const eventName = `${this.type}.moved` as keyof Events;
            this.scene.events.fire(eventName, this);
        }
    }
}

export { SceneObject };

