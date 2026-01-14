type Pyodide = {
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string, opts?: { encoding: 'binary' }) => Uint8Array;
        readdir: (path: string) => string[];
    };
    loadPackage: (packages: string[]) => Promise<void>;
    runPythonAsync: (code: string) => Promise<any>;
    globals: {
        set: (name: string, value: any) => void;
    };
};

type PklConversionResult = {
    files: Map<string, Uint8Array>;
    header: any;
};

let pyodidePromise: Promise<Pyodide> | null = null;

const loadPyodideRuntime = async (): Promise<Pyodide> => {
    if (pyodidePromise) {
        return pyodidePromise;
    }

    pyodidePromise = new Promise(async (resolve, reject) => {
        try {
            const w = window as any;
            if (!w.loadPyodide) {
                await new Promise<void>((scriptResolve, scriptReject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
                    script.async = true;
                    script.onload = () => scriptResolve();
                    script.onerror = () => scriptReject(new Error('Failed to load Pyodide script'));
                    document.head.appendChild(script);
                });
            }

            const pyodide: Pyodide = await (window as any).loadPyodide({
                indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
            });
            await pyodide.loadPackage(['numpy']);
            await pyodide.loadPackage(['scipy']);
            resolve(pyodide);
        } catch (error) {
            reject(error);
        }
    });

    return pyodidePromise;
};

const getConverterCode = () => `
import os
import json
import pickle
import numpy as np
import numpy.core
import numpy.core.multiarray
import numpy.core.umath
import sys
import types
from scipy.spatial.transform import Rotation

if 'numpy.core' not in sys.modules:
    core_mod = types.ModuleType('numpy.core')
    core_mod.__dict__.update(numpy.core.__dict__)
    sys.modules['numpy.core'] = core_mod
sys.modules.setdefault('numpy.core.multiarray', numpy.core.multiarray)
sys.modules.setdefault('numpy.core.umath', numpy.core.umath)
if hasattr(numpy.core, '_multiarray_umath'):
    sys.modules.setdefault('numpy.core._multiarray_umath', numpy.core._multiarray_umath)

def to_np(x):
    if isinstance(x, np.ndarray):
        return x
    if hasattr(x, 'detach'):
        x = x.detach().cpu().numpy()
    elif hasattr(x, 'numpy'):
        try:
            x = x.numpy()
        except Exception:
            pass
    return np.array(x)

def cv_to_gl(coords):
    coords = coords.copy()
    if coords.ndim == 1:
        coords[1] = -coords[1]
        coords[2] = -coords[2]
    elif coords.ndim == 2:
        coords[:, 1] = -coords[:, 1]
        coords[:, 2] = -coords[:, 2]
    elif coords.ndim == 3:
        coords[:, :, 1] = -coords[:, :, 1]
        coords[:, :, 2] = -coords[:, :, 2]
    return coords

def cv_to_gl_quat(quats):
    quats = quats.copy()
    if quats.ndim == 1:
        if len(quats) == 4:
            quats[1] = -quats[1]
            quats[2] = -quats[2]
    elif quats.ndim == 2:
        quats[:, 1] = -quats[:, 1]
        quats[:, 2] = -quats[:, 2]
    elif quats.ndim == 3:
        quats[:, :, 1] = -quats[:, :, 1]
        quats[:, :, 2] = -quats[:, :, 2]
    return quats

bone_mapping_indices = None
if bone_names_441 is not None and skeleton_1185_names is not None:
    name_to_index_1185 = {name: idx for idx, name in enumerate(skeleton_1185_names)}
    bone_indices = []
    missing = []
    for bone_name in bone_names_441:
        if bone_name in name_to_index_1185:
            bone_indices.append(name_to_index_1185[bone_name])
        else:
            missing.append(bone_name)
    if len(missing) == 0 and len(bone_indices) == len(bone_names_441):
        bone_mapping_indices = np.array(bone_indices, dtype=np.int32)

class RemapUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == 'numpy.core':
            return getattr(np.core, name)
        if module == 'numpy.core.multiarray':
            return getattr(np.core.multiarray, name)
        if module == 'numpy.core.umath':
            return getattr(np.core.umath, name)
        if module == 'numpy.core._multiarray_umath' and hasattr(np.core, '_multiarray_umath'):
            return getattr(np.core._multiarray_umath, name)
        return super().find_class(module, name)

with open(input_path, 'rb') as f:
    data = RemapUnpickler(f).load()

means = to_np(data['mu'])
covs = to_np(data['cov'])
colors = to_np(data['color'])
opacities = to_np(data['opacity'])
weights = to_np(data['W'])

joints = None
if 'joints' in data:
    joints = to_np(data['joints'])

poses = None
animation_num_bones = None
if 'poses' in data:
    raw_poses = data['poses']
    if hasattr(raw_poses, 'item') and getattr(raw_poses, 'ndim', None) == 0:
        raw_poses = raw_poses.item()
    if isinstance(raw_poses, dict):
        rotations = to_np(raw_poses['rotations'])
        translations = to_np(raw_poses['translations'])
        num_frames = rotations.shape[0]
        num_bones_1185 = rotations.shape[1]
        if bone_mapping_indices is not None and len(bone_mapping_indices) == len(bone_names_441):
            rotations = rotations[:, bone_mapping_indices, :]
            translations = translations[:, bone_mapping_indices, :]
            animation_num_bones = len(bone_names_441)
        else:
            animation_num_bones = num_bones_1185
        translations = cv_to_gl(translations)
        rotations = cv_to_gl_quat(rotations)
        quats_flat = rotations.reshape(-1, 4)
        trans_flat = translations.reshape(-1, 3)
        r_mats = Rotation.from_quat(quats_flat).as_matrix()
        matrices = np.eye(4, dtype=np.float32).reshape(1, 4, 4).repeat(quats_flat.shape[0], axis=0)
        matrices[:, :3, :3] = r_mats
        matrices[:, :3, 3] = trans_flat
        matrices_T = matrices.transpose(0, 2, 1)
        poses = matrices_T.reshape(num_frames, int(matrices_T.shape[0] / num_frames), 16)
    else:
        poses = to_np(raw_poses)
elif 'body_pose' in data:
    poses = to_np(data['body_pose'])

OPACITY_THRESHOLD = 0.1
opacity_mask = opacities >= OPACITY_THRESHOLD

means = means[opacity_mask]
covs = covs[opacity_mask]
colors = colors[opacity_mask]
opacities = opacities[opacity_mask]
weights = weights[opacity_mask]

if joints is not None:
    joints = joints

means = cv_to_gl(means)
if joints is not None:
    joints = cv_to_gl(joints)

w, v = np.linalg.eigh(covs)
scales = np.sqrt(np.maximum(w, 1e-8))
dets = np.linalg.det(v)
v[dets < 0, :, 0] *= -1
rotations = Rotation.from_matrix(v).as_quat()
rotations = cv_to_gl_quat(rotations)

if colors.max() <= 1.0:
    colors = (colors * 255).astype(np.uint8)
else:
    colors = colors.astype(np.uint8)

if colors.shape[1] == 3:
    alpha_channel = np.full((means.shape[0], 1), 255, dtype=np.uint8)
    colors = np.hstack([colors, alpha_channel])

top_indices = np.argsort(weights, axis=1)[:, -4:]
top_weights = np.take_along_axis(weights, top_indices, axis=1)
weight_sums = top_weights.sum(axis=1, keepdims=True)
top_weights = top_weights / (weight_sums + 1e-8)

os.makedirs(output_dir, exist_ok=True)

header = {
    "numSplats": int(means.shape[0]),
    "numBones": int(weights.shape[1]),
    "bounds": {
        "min": means.min(axis=0).tolist(),
        "max": means.max(axis=0).tolist()
    }
}

if poses is not None:
    animation_bone_count = animation_num_bones if animation_num_bones is not None else int(poses.shape[1])
    header["animation"] = {
        "file": "animation.bin",
        "format": "float32",
        "numFrames": int(poses.shape[0]),
        "numBones": int(animation_bone_count),
        "shape": [int(x) for x in poses.shape],
        "stride": 64
    }

if joints is not None:
    header["joints"] = {
        "count": int(joints.shape[0]),
        "file": "joints.bin",
        "format": "float32",
        "stride": 12
    }

with open(os.path.join(output_dir, "header.json"), 'w') as f:
    json.dump(header, f, indent=2)

with open(os.path.join(output_dir, "splats.bin"), 'wb') as f:
    for i in range(means.shape[0]):
        f.write(means[i].astype(np.float32).tobytes())
        f.write(scales[i].astype(np.float32).tobytes())
        f.write(rotations[i].astype(np.float32).tobytes())
        f.write(colors[i].astype(np.uint8).tobytes())
        f.write(np.array([opacities[i]], dtype=np.float32).tobytes())

with open(os.path.join(output_dir, "weights.bin"), 'wb') as f:
    for i in range(means.shape[0]):
        f.write(top_indices[i].astype(np.uint16).tobytes())
        f.write(top_weights[i].astype(np.float32).tobytes())

if poses is not None:
    with open(os.path.join(output_dir, "animation.bin"), 'wb') as f:
        f.write(poses.astype(np.float32).tobytes())

if joints is not None:
    with open(os.path.join(output_dir, "joints.bin"), 'wb') as f:
        f.write(joints.astype(np.float32).tobytes())
`;

export const convertPklToBinary = async (
    file: File,
    boneNames441: string[] | null,
    skeleton1185Names: string[] | null
): Promise<PklConversionResult> => {
    const pyodide = await loadPyodideRuntime();
    const buffer = await file.arrayBuffer();
    const inputPath = '/tmp/input.pkl';
    const outputDir = '/tmp/out';

    pyodide.FS.writeFile(inputPath, new Uint8Array(buffer));
    pyodide.globals.set('input_path', inputPath);
    pyodide.globals.set('output_dir', outputDir);
    pyodide.globals.set('bone_names_441', boneNames441);
    pyodide.globals.set('skeleton_1185_names', skeleton1185Names);

    await pyodide.runPythonAsync(getConverterCode());

    const entries = pyodide.FS.readdir(outputDir).filter((name) => !name.startsWith('.'));
    const files = new Map<string, Uint8Array>();
    let header: any = null;

    for (const entry of entries) {
        const path = `${outputDir}/${entry}`;
        const data = pyodide.FS.readFile(path, { encoding: 'binary' });
        files.set(entry, data);
        if (entry === 'header.json') {
            header = JSON.parse(new TextDecoder().decode(data));
        }
    }

    return { files, header };
};
