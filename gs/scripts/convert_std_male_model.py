import json
from pathlib import Path

import torch
import numpy as np

from converter import cv_to_gl, cv_to_gl_quat


def to_np(x):
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    return np.array(x)


def main():
    root = Path(__file__).resolve().parents[1]
    model_root = root / 'assets' / 'model'
    input_file = model_root / 'std_male_model' / 'pytorch' / 'std_male.model.pt'
    output_dir = model_root / 'std_male_model' / 'converted'

    if not input_file.exists():
        raise FileNotFoundError(f"Missing input file: {input_file}")

    output_dir.mkdir(parents=True, exist_ok=True)

    std_male_model_data = torch.load(str(input_file), map_location='cpu')
    header = {"stdMaleModel": {}}

    if isinstance(std_male_model_data, dict) and 'joints' in std_male_model_data:
        joints_data = std_male_model_data['joints']

        if 'rest_translations' in joints_data:
            rest_trans = to_np(joints_data['rest_translations'])
            rest_trans = cv_to_gl(rest_trans)
            with open(output_dir / "std_male_rest_translations.bin", "wb") as f:
                f.write(rest_trans.astype(np.float32).tobytes())
            header["stdMaleModel"]["restTranslations"] = {
                "file": "std_male_rest_translations.bin",
                "format": "float32",
                "shape": list(rest_trans.shape),
                "count": int(rest_trans.shape[0]),
                "stride": 12
            }

        if 'rest_rotations' in joints_data:
            rest_rots = to_np(joints_data['rest_rotations'])
            rest_rots = cv_to_gl_quat(rest_rots)
            with open(output_dir / "std_male_rest_rotations.bin", "wb") as f:
                f.write(rest_rots.astype(np.float32).tobytes())
            header["stdMaleModel"]["restRotations"] = {
                "file": "std_male_rest_rotations.bin",
                "format": "float32",
                "shape": list(rest_rots.shape),
                "count": int(rest_rots.shape[0]),
                "stride": 16
            }

        if 'parents' in joints_data:
            parents_std = to_np(joints_data['parents']).astype(np.int32)
            with open(output_dir / "std_male_parents.bin", "wb") as f:
                f.write(parents_std.tobytes())
            header["stdMaleModel"]["parents"] = {
                "file": "std_male_parents.bin",
                "format": "int32",
                "count": int(parents_std.shape[0]),
                "stride": 4
            }

        if 'comp_translations' in joints_data:
            comp_trans = to_np(joints_data['comp_translations'])
            comp_trans = cv_to_gl(comp_trans)
            with open(output_dir / "std_male_comp_translations.bin", "wb") as f:
                f.write(comp_trans.astype(np.float32).tobytes())
            header["stdMaleModel"]["compTranslations"] = {
                "file": "std_male_comp_translations.bin",
                "format": "float32",
                "shape": list(comp_trans.shape),
                "count": int(comp_trans.shape[0]),
                "stride": 12
            }

        if 'comp_rotations' in joints_data:
            comp_rots = to_np(joints_data['comp_rotations'])
            comp_rots = cv_to_gl_quat(comp_rots)
            with open(output_dir / "std_male_comp_rotations.bin", "wb") as f:
                f.write(comp_rots.astype(np.float32).tobytes())
            header["stdMaleModel"]["compRotations"] = {
                "file": "std_male_comp_rotations.bin",
                "format": "float32",
                "shape": list(comp_rots.shape),
                "count": int(comp_rots.shape[0]),
                "stride": 16
            }
    else:
        print("Warning: std_male.model.pt does not contain joints data")

    if isinstance(std_male_model_data, dict) and 'verts' in std_male_model_data:
        verts = to_np(std_male_model_data['verts'])
        verts = cv_to_gl(verts)
        with open(output_dir / "std_male_verts.bin", "wb") as f:
            f.write(verts.astype(np.float32).tobytes())
        header["stdMaleModel"]["verts"] = {
            "file": "std_male_verts.bin",
            "format": "float32",
            "shape": list(verts.shape),
            "count": int(verts.shape[0]),
            "stride": 12
        }

    with open(output_dir / "header.json", "w") as f:
        json.dump(header, f, indent=2)

    print(f"Done! Output saved to {output_dir}")


if __name__ == "__main__":
    main()
