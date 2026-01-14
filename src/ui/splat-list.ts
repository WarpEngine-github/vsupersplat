import { Container, Label, Element as PcuiElement, TextInput } from '@playcanvas/pcui';

import { ElementType } from '../core/element';
import { SceneObject } from '../core/scene-object';
import { Events } from '../events';
import { Scene } from '../core/scene';
import { Splat } from '../splat/splat';
import deleteSvg from './svg/delete.svg';
import cameraPanelSvg from './svg/camera-panel.svg';
import hiddenSvg from './svg/hidden.svg';
import shownSvg from './svg/shown.svg';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class SplatItem extends Container {
    getName: () => string;
    setName: (value: string) => void;
    getSelected: () => boolean;
    setSelected: (value: boolean) => void;
    getVisible: () => boolean;
    setVisible: (value: boolean) => void;
    setCameraActionVisible: (value: boolean) => void;
    destroy: () => void;

    constructor(name: string, edit: TextInput, args = {}) {
        args = {
            ...args,
            class: ['splat-item', 'visible']
        };

        super(args);

        const text = new Label({
            class: 'splat-item-text',
            text: name
        });

        const visible = new PcuiElement({
            dom: createSvg(shownSvg),
            class: 'splat-item-visible'
        });

        const invisible = new PcuiElement({
            dom: createSvg(hiddenSvg),
            class: 'splat-item-visible',
            hidden: true
        });

        const remove = new PcuiElement({
            dom: createSvg(deleteSvg),
            class: 'splat-item-delete'
        });

        const cameraAction = new PcuiElement({
            dom: createSvg(cameraPanelSvg),
            class: 'splat-item-camera',
            hidden: true
        });

        this.append(text);
        this.append(cameraAction);
        this.append(visible);
        this.append(invisible);
        this.append(remove);

        this.getName = () => {
            return text.value;
        };

        this.setName = (value: string) => {
            text.value = value;
        };

        this.getSelected = () => {
            return this.class.contains('selected');
        };

        this.setSelected = (value: boolean) => {
            if (value !== this.selected) {
                if (value) {
                    this.class.add('selected');
                    this.emit('select', this);
                } else {
                    this.class.remove('selected');
                    this.emit('unselect', this);
                }
            }
        };

        this.getVisible = () => {
            return this.class.contains('visible');
        };

        this.setVisible = (value: boolean) => {
            if (value !== this.visible) {
                visible.hidden = !value;
                invisible.hidden = value;
                if (value) {
                    this.class.add('visible');
                    this.emit('visible', this);
                } else {
                    this.class.remove('visible');
                    this.emit('invisible', this);
                }
            }
        };

        const toggleVisible = (event: MouseEvent) => {
            event.stopPropagation();
            this.visible = !this.visible;
        };

        const handleRemove = (event: MouseEvent) => {
            event.stopPropagation();
            this.emit('removeClicked', this);
        };

        let cameraActive = false;
        const handleCameraAction = (event: MouseEvent) => {
            event.stopPropagation();
            cameraActive = !cameraActive;
            cameraAction.class.toggle('active', cameraActive);
            this.emit('cameraAction', this);
        };

        // rename on double click
        text.dom.addEventListener('dblclick', (event: MouseEvent) => {
            event.stopPropagation();

            const onblur = () => {
                this.remove(edit);
                this.emit('rename', edit.value);
                edit.input.removeEventListener('blur', onblur);
                text.hidden = false;
            };

            text.hidden = true;

            this.appendAfter(edit, text);
            edit.value = text.value;
            edit.input.addEventListener('blur', onblur);
            edit.focus();
        });

        // handle clicks
        visible.dom.addEventListener('click', toggleVisible);
        invisible.dom.addEventListener('click', toggleVisible);
        remove.dom.addEventListener('click', handleRemove);
        cameraAction.dom.addEventListener('click', handleCameraAction);

        this.destroy = () => {
            visible.dom.removeEventListener('click', toggleVisible);
            invisible.dom.removeEventListener('click', toggleVisible);
            remove.dom.removeEventListener('click', handleRemove);
            cameraAction.dom.removeEventListener('click', handleCameraAction);
        };

        this.setCameraActionVisible = (value: boolean) => {
            cameraAction.hidden = !value;
        };
    }

    set name(value: string) {
        this.setName(value);
    }

    get name() {
        return this.getName();
    }

    set selected(value) {
        this.setSelected(value);
    }

    get selected() {
        return this.getSelected();
    }

    set visible(value) {
        this.setVisible(value);
    }

    get visible() {
        return this.getVisible();
    }

    /**
     * Set the depth level for indentation
     */
    setDepth(depth: number) {
        // Remove all existing depth classes
        for (let i = 0; i <= 10; i++) {
            this.class.remove(`splat-item-depth-${i}`);
        }
        // Add the new depth class
        this.class.add(`splat-item-depth-${depth}`);
    }
}

class SplatList extends Container {
    constructor(events: Events, args = {}) {
        args = {
            ...args,
            class: 'splat-list'
        };

        super(args);

        const items = new Map<SceneObject, SplatItem>();

        // edit input used during renames
        const edit = new TextInput({
            id: 'splat-edit'
        });

        /**
         * Find the parent of an element by checking if it's in any other element's childElements
         */
        const findParent = (element: SceneObject): SceneObject | null => {
            for (const [otherElement, _] of items) {
                if (otherElement.childElements.has(element)) {
                    return otherElement;
                }
            }
            return null;
        };

        /**
         * Build hierarchical structure and return flat list with depth information
         */
        const buildHierarchy = (): Array<{ element: SceneObject; depth: number }> => {
            const result: Array<{ element: SceneObject; depth: number }> = [];
            const visited = new Set<SceneObject>();

            // Find root elements (elements that are not children of any other element)
            const rootElements: SceneObject[] = [];
            for (const [element, _] of items) {
                const parent = findParent(element);
                if (!parent) {
                    rootElements.push(element);
                }
            }

            // Recursively traverse hierarchy starting from roots
            const traverse = (element: SceneObject, depth: number) => {
                if (visited.has(element)) {
                    return; // Prevent cycles
                }
                visited.add(element);
                result.push({ element, depth });

                // Add children in order
                for (const child of element.childElements) {
                    if (child instanceof SceneObject && items.has(child)) {
                        traverse(child, depth + 1);
                    }
                }
            };

            // Traverse from all root elements
            for (const root of rootElements) {
                traverse(root, 0);
            }

            return result;
        };

        /**
         * Rebuild the hierarchy by reordering items and applying indentation
         */
        const rebuildHierarchy = () => {
            const hierarchy = buildHierarchy();
            
            // Remove all items from DOM (but keep them in the items Map)
            for (const [_, item] of items) {
                this.remove(item);
            }

            // Re-add items in hierarchical order with proper depth
            for (const { element, depth } of hierarchy) {
                const item = items.get(element);
                if (item) {
                    item.setDepth(depth);
                    this.append(item);
                }
            }
        };

        events.on('scene.elementAdded', (element: SceneObject) => {
            // Handle scene objects (splats, armatures, camera objects)
            if (element instanceof SceneObject &&
                (element.type === ElementType.splat ||
                 element.type === ElementType.armature ||
                 element.type === ElementType.cameraObject)) {
                const item = new SplatItem(element.name, edit);
                item.setCameraActionVisible(element.type === ElementType.cameraObject);
                items.set(element, item);

                item.on('visible', () => {
                    element.visible = true;
                    element.onSelected();
                });
                
                item.on('invisible', () => {
                    element.visible = false;
                });
                
                item.on('rename', (value: string) => {
                    element.rename(value);
                });

                // Rebuild hierarchy to include new element
                rebuildHierarchy();
            }
        });

        events.on('scene.elementRemoved', (element: SceneObject) => {
            if (element instanceof SceneObject &&
                (element.type === ElementType.splat ||
                 element.type === ElementType.armature ||
                 element.type === ElementType.cameraObject)) {
                const item = items.get(element);
                if (item) {
                    this.remove(item);
                    items.delete(element);
                    // Rebuild hierarchy after removal
                    rebuildHierarchy();
                }
            }
        });

        events.on('selection.changed', (selection: SceneObject) => {
            items.forEach((value, key) => {
                value.selected = key === selection;
            });
        });

        // Handle name changes for all scene objects (generic handler)
        const handleNameChange = (obj: SceneObject) => {
            const item = items.get(obj);
            if (item) {
                item.name = obj.name;
            }
        };

        events.on('splat.name', handleNameChange);
        events.on('armature.name', handleNameChange);
        events.on('cameraObject.name', handleNameChange);

        // Handle visibility changes for all scene objects (generic handler)
        const handleVisibilityChange = (obj: SceneObject) => {
            const item = items.get(obj);
            if (item) {
                item.visible = obj.visible;
            }
        };

        events.on('splat.visibility', handleVisibilityChange);
        events.on('armature.visibility', handleVisibilityChange);
        events.on('cameraObject.visibility', handleVisibilityChange);

        // Rebuild hierarchy when parent-child relationships change
        events.on('scene.hierarchyChanged', () => {
            rebuildHierarchy();
        });

        this.on('click', (item: SplatItem) => {
            for (const [key, value] of items) {
                if (item === value) {
                    // Fire selection event for both splats and armatures
                    const current = events.invoke('selection') as SceneObject | null;
                    if (current === key) {
                        events.fire('selection', null);
                    } else {
                        events.fire('selection', key);
                        key.onSelected();
                    }
                    break;
                }
            }
        });

        this.on('removeClicked', async (item: SplatItem) => {
            let element: SceneObject | null = null;
            for (const [key, value] of items) {
                if (item === value) {
                    element = key;
                    break;
                }
            }

            if (!element) {
                return;
            }

            const result = await events.invoke('showPopup', {
                type: 'yesno',
                header: `Remove ${element.getDisplayName()}`,
                message: `Are you sure you want to remove '${element.name}' from the scene? This operation can not be undone.`
            });

            if (result?.action === 'yes') {
                element.destroy();
            }
        });
    }

    protected _onAppendChild(element: PcuiElement): void {
        super._onAppendChild(element);

        if (element instanceof SplatItem) {
            element.on('click', () => {
                this.emit('click', element);
            });

            element.on('removeClicked', () => {
                this.emit('removeClicked', element);
            });
        }
    }

    protected _onRemoveChild(element: PcuiElement): void {
        if (element instanceof SplatItem) {
            element.unbind('click');
            element.unbind('removeClicked');
        }

        super._onRemoveChild(element);
    }
}

export { SplatList, SplatItem };
