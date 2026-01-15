import { AppBase, Asset, GSplatData, GSplatResource, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { AssetSource } from './loaders/asset-source';
import { loadBinaryGsplat, BinaryGsplatResult } from './loaders/binary-gsplat';
import { loadGsplat } from './loaders/gsplat';
import { loadLcc } from './loaders/lcc';
import { loadSplat } from './loaders/splat';
import { Splat } from '../splat/splat';

const defaultOrientation = new Vec3(0, 0, 180);
const lccOrientation = new Vec3(90, 0, 180);
const binaryGsplatOrientation = new Vec3(0, 0, 0);

// handles loading gltf container assets
class AssetLoader {
    app: AppBase;
    events: Events;
    defaultAnisotropy: number;
    loadAllData = true;

    constructor(app: AppBase, events: Events, defaultAnisotropy?: number) {
        this.app = app;
        this.events = events;
        this.defaultAnisotropy = defaultAnisotropy || 1;
    }

    async load(assetSource: AssetSource) {
        const wrap = (gsplatData: GSplatData) => {
            const asset = new Asset(assetSource.filename || assetSource.url, 'gsplat', {
                url: assetSource.contents ? `local-asset-${Date.now()}` : assetSource.url ?? assetSource.filename,
                filename: assetSource.filename
            });
            this.app.assets.add(asset);
            asset.resource = new GSplatResource(this.app.graphicsDevice, gsplatData);
            return asset;
        };

        if (!assetSource.animationFrame) {
            this.events.fire('startSpinner');
        }

        try {
            const filename = (assetSource.filename || assetSource.url).toLowerCase();

            let asset;
            let orientation = defaultOrientation;

            if (filename.endsWith('.splat')) {
                asset = wrap(await loadSplat(assetSource));
            } else if (filename.endsWith('.lcc')) {
                asset = wrap(await loadLcc(assetSource));
                orientation = lccOrientation;
            } else if (filename === 'header.json' || filename.endsWith('header.json')) {
                // Binary format: header.json + splats.bin
                const binaryResult: BinaryGsplatResult = await loadBinaryGsplat(assetSource);
                asset = wrap(binaryResult.gsplatData);
                // Store armature and animation data on asset for later use
                if (binaryResult.armatureData) {
                    (asset as any).__armatureData = binaryResult.armatureData;
                }
                if (binaryResult.splatWeights) {
                    (asset as any).__splatWeights = binaryResult.splatWeights;
                } else {
                    delete (asset as any).__splatWeights;
                }
                if (binaryResult.animationData) {
                    (asset as any).__animationData = binaryResult.animationData;
                }
                (asset as any).__animationHeader = binaryResult.header;
                orientation = binaryGsplatOrientation;
            } else {
                asset = await loadGsplat(this.app.assets, assetSource);
            }

            return new Splat(asset, orientation);
        } finally {
            if (!assetSource.animationFrame) {
                this.events.fire('stopSpinner');
            }
        }
    }
}

export { AssetLoader };
