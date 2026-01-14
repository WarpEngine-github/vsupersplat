import json
from pathlib import Path

import torch
import numpy as np


def to_np(x):
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    return np.array(x)


def main():
    root = Path(__file__).resolve().parents[1]
    model_root = root / 'assets' / 'model'
    input_file = model_root / '441_skeleton' / 'pytorch' / '441-skeleton.pt'
    output_dir = model_root / '441_skeleton' / 'converted'

    if not input_file.exists():
        raise FileNotFoundError(f"Missing input file: {input_file}")

    output_dir.mkdir(parents=True, exist_ok=True)

    skeleton_data = torch.load(str(input_file), map_location='cpu')
    bone_names = None
    parents = None

    if isinstance(skeleton_data, dict):
        bone_names = skeleton_data.get('joint_names', skeleton_data.get('bone_names', skeleton_data.get('names')))
        parents = skeleton_data.get('parents', skeleton_data.get('parent'))
    else:
        if hasattr(skeleton_data, 'joint_names'):
            bone_names = skeleton_data.joint_names
        if hasattr(skeleton_data, 'parents'):
            parents = skeleton_data.parents

    header = {}

    if bone_names is not None:
        bone_names = to_np(bone_names) if isinstance(bone_names, torch.Tensor) else list(bone_names)
        header["boneNames"] = bone_names if isinstance(bone_names, list) else bone_names.tolist()

    if parents is not None:
        parents = to_np(parents) if isinstance(parents, torch.Tensor) else np.array(parents)
        parents_int32 = parents.astype(np.int32)
        with open(output_dir / "parents.bin", "wb") as f:
            f.write(parents_int32.tobytes())
        header["parents"] = {
            "file": "parents.bin",
            "format": "int32",
            "count": int(parents_int32.shape[0]),
            "stride": 4
        }

    with open(output_dir / "header.json", "w") as f:
        json.dump(header, f, indent=2)

    print(f"Done! Output saved to {output_dir}")


if __name__ == "__main__":
    main()
