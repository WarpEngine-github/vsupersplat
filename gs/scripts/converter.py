import os
import json
import struct
import pickle
import torch
import numpy as np
from pathlib import Path
from scipy.spatial.transform import Rotation

def decompose_covariance(cov_matrix):
    try:
        w, v = np.linalg.eigh(cov_matrix)
        scales = np.sqrt(np.maximum(w, 1e-8))
        rot_mat = v
        r = Rotation.from_matrix(rot_mat)
        quat = r.as_quat() # x, y, z, w
        return scales, quat
    except Exception as e:
        print(f"Error decomposing covariance: {e}")
        return np.array([0.01, 0.01, 0.01]), np.array([0, 0, 0, 1])

def cv_to_gl(coords):
    """
    Convert coordinates from OpenCV to OpenGL convention.
    OpenCV: X right, Y down, Z forward (into screen)
    OpenGL: X right, Y up, Z backward (out of screen)
    Conversion: (x, y, z) -> (x, -y, -z)
    """
    coords = coords.copy()
    if coords.ndim == 1:
        # Single 3D point
        coords[1] = -coords[1]  # Negate Y
        coords[2] = -coords[2]  # Negate Z
    elif coords.ndim == 2:
        # Array of 3D points (N, 3)
        coords[:, 1] = -coords[:, 1]  # Negate Y
        coords[:, 2] = -coords[:, 2]  # Negate Z
    elif coords.ndim == 3:
        # Array of 3D points (N, M, 3) - e.g., animation translations
        coords[:, :, 1] = -coords[:, :, 1]  # Negate Y
        coords[:, :, 2] = -coords[:, :, 2]  # Negate Z
    return coords

def cv_to_gl_quat(quats):
    """
    Convert quaternion rotations from OpenCV to OpenGL convention.
    When flipping Y and Z axes, quaternion components need adjustment.
    Conversion: (x, y, z, w) -> (x, -y, -z, w)
    """
    quats = quats.copy()
    if quats.ndim == 1:
        # Single quaternion (x, y, z, w)
        if len(quats) == 4:
            quats[1] = -quats[1]  # Negate Y
            quats[2] = -quats[2]  # Negate Z
    elif quats.ndim == 2:
        # Array of quaternions (N, 4)
        quats[:, 1] = -quats[:, 1]  # Negate Y
        quats[:, 2] = -quats[:, 2]  # Negate Z
    elif quats.ndim == 3:
        # Array of quaternions (N, M, 4) - e.g., animation rotations
        quats[:, :, 1] = -quats[:, :, 1]  # Negate Y
        quats[:, :, 2] = -quats[:, :, 2]  # Negate Z
    return quats

def process_data(input_path, output_dir):
    print(f"Loading {input_path}...")
    
    with open(input_path, 'rb') as f:
        data = pickle.load(f)
    
    print("Keys found:", data.keys())
    
    def to_np(x):
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
        return np.array(x)
    
        input_dir = os.path.dirname(input_path)
    
    # Auto-detect std_male.model.pt if available
    std_male_model_path = None
    std_male_candidate = os.path.join(input_dir, 'std_male.model.pt')
    if os.path.exists(std_male_candidate):
        std_male_model_path = std_male_candidate
    else:
        # Try model/std_male_model/pytorch/std_male.model.pt relative to input
        try:
            current = Path(input_dir).resolve()
            model_root = None
            for parent in current.parents:
                if parent.name == 'model':
                    model_root = parent
                    break
            if model_root:
                candidate = model_root / 'std_male_model' / 'pytorch' / 'std_male.model.pt'
                if candidate.exists():
                    std_male_model_path = str(candidate)
        except Exception:
            pass
    
    # Load std_male.model.pt if available
    std_male_model_data = None
    if std_male_model_path:
        print(f"\nLoading std_male.model.pt from {std_male_model_path}...")
        try:
            std_male_model_data = torch.load(std_male_model_path, map_location='cpu')
            print(f"  Loaded std_male.model.pt: type={type(std_male_model_data)}")
            if isinstance(std_male_model_data, dict):
                print(f"  Keys: {list(std_male_model_data.keys())}")
            elif hasattr(std_male_model_data, 'shape'):
                print(f"  Shape: {std_male_model_data.shape}")
        except Exception as e:
            print(f"  Warning: Failed to load std_male.model.pt: {e}")
            import traceback
            traceback.print_exc()

    means = to_np(data['mu'])
    covs = to_np(data['cov'])
    colors = to_np(data['color'])
    opacities = to_np(data['opacity'])
    weights = to_np(data['W']) # Skinning weights (N, Bones)
    
    # Load joints (bone rest positions) if available - export raw, no modifications
    joints = None
    if 'joints' in data:
        joints = to_np(data['joints'])
        print(f"Joints: {joints.shape} (raw, no modifications)")
    
    print(f"Original data shapes:")
    print(f"  Means: {means.shape}")
    print(f"  Covs: {covs.shape}")
    print(f"  Colors: {colors.shape}")
    print(f"  Opacities: {opacities.shape}")
    print(f"  Weights: {weights.shape}")
    if joints is not None:
        print(f"  Joints: {joints.shape}")
    
    # ============================================
    # Filter out low opacity splats (< 0.1)
    # ============================================
    OPACITY_THRESHOLD = 0.1
    opacity_mask = opacities >= OPACITY_THRESHOLD
    num_filtered = np.sum(~opacity_mask)
    print(f"\nFiltering splats with opacity < {OPACITY_THRESHOLD}...")
    print(f"  Removing {num_filtered} splats ({100*num_filtered/len(opacities):.1f}%)")
    
    means = means[opacity_mask]
    covs = covs[opacity_mask]
    colors = colors[opacity_mask]
    opacities = opacities[opacity_mask]
    weights = weights[opacity_mask]
    
    print(f"\nAfter filtering:")
    print(f"  Remaining splats: {len(means)} ({100*len(means)/(len(means)+num_filtered):.1f}%)")

    # Handle Poses
    poses = None
    animation_num_bones = None
    if 'poses' in data:
        raw_poses = data['poses']
        # Check if 0-d array wrapping a dict
        if hasattr(raw_poses, 'item') and raw_poses.ndim == 0:
             raw_poses = raw_poses.item()
        
        if isinstance(raw_poses, dict):
            print("Poses is a dictionary.")
            rotations = raw_poses['rotations'] # (F, B, 4)
            translations = raw_poses['translations'] # (F, B, 3)
            
            rotations = to_np(rotations)
            translations = to_np(translations)
            
            print(f"Animation Rotations: {rotations.shape}")
            print(f"Animation Translations: {translations.shape}")
            
            num_frames = rotations.shape[0]
            num_bones_1185 = rotations.shape[1]
            
            num_bones = num_bones_1185
            animation_num_bones = num_bones_1185
            
            # Convert translations and rotations from OpenCV to OpenGL coordinates
            translations = cv_to_gl(translations)
            rotations = cv_to_gl_quat(rotations)
            
            # Reshape to list of quats/trans
            quats_flat = rotations.reshape(-1, 4) # (N, 4)
            trans_flat = translations.reshape(-1, 3) # (N, 3)
            
            # Convert to Matrix
            r_mats = Rotation.from_quat(quats_flat).as_matrix() # (N, 3, 3)
            
            matrices = np.eye(4, dtype=np.float32).reshape(1, 4, 4).repeat(quats_flat.shape[0], axis=0)
            matrices[:, :3, :3] = r_mats
            matrices[:, :3, 3] = trans_flat
            
            # Convert to Column-Major for Three.js? 
            # Three.js matrix.fromArray expects column-major. 
            # matrices is (N, 4, 4) row-major. 
            # We want to save it so that when read sequentially, it forms column-major.
            # So we transpose each 4x4.
            matrices_T = matrices.transpose(0, 2, 1)
            
            poses = matrices_T.reshape(num_frames, num_bones, 16)
        else:
             poses = to_np(raw_poses)
             
    elif 'body_pose' in data:
        poses = to_np(data['body_pose'])

    num_splats = means.shape[0]
    print(f"Processing {num_splats} splats...")
    
    # Convert from OpenCV to OpenGL coordinates
    print("Converting coordinates from OpenCV to OpenGL...")
    # Convert splat positions
    means = cv_to_gl(means)
    
    # Convert joint positions if available
    if joints is not None:
        joints = cv_to_gl(joints)
    
    # 1. Prepare Splat Data
    print("Decomposing covariance matrices...")
    w, v = np.linalg.eigh(covs) 
    scales = np.sqrt(np.maximum(w, 1e-8))
    dets = np.linalg.det(v)
    v[dets < 0, :, 0] *= -1 
    rotations = Rotation.from_matrix(v).as_quat() 
    # Convert splat rotations from OpenCV to OpenGL coordinates
    rotations = cv_to_gl_quat(rotations) 
    
    if colors.max() <= 1.0:
        colors = (colors * 255).astype(np.uint8)
    else:
        colors = colors.astype(np.uint8)
    
    # Ensure colors is RGBA (add alpha channel if RGB)
    if colors.shape[1] == 3:
        alpha_channel = np.full((num_splats, 1), 255, dtype=np.uint8)
        colors = np.hstack([colors, alpha_channel])
        
    # 2. Prepare Skinning Weights
    print("Processing skinning weights...")
    top_indices = np.argsort(weights, axis=1)[:, -4:] 
    top_weights = np.take_along_axis(weights, top_indices, axis=1)
    weight_sums = top_weights.sum(axis=1, keepdims=True)
    top_weights = top_weights / (weight_sums + 1e-8)
    
    # 3. Output Directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Write Header
    header = {
        "numSplats": int(num_splats),
        "numBones": weights.shape[1], # Use weight bones count for shader
        "bounds": {
            "min": means.min(axis=0).tolist(),
            "max": means.max(axis=0).tolist()
        }
    }
        
    print("Writing splats.bin (interleaved format)...")
    # Interleaved format: for each splat, write all its data sequentially
    # Format per splat: Pos(3f) + Scale(3f) + Rot(4f) + Color(4b) + Opacity(1f) = 48 bytes
    with open(os.path.join(output_dir, "splats.bin"), 'wb') as f:
        for i in range(num_splats):
            # Position (3 floats = 12 bytes)
            f.write(means[i].astype(np.float32).tobytes())
            # Scale (3 floats = 12 bytes)
            f.write(scales[i].astype(np.float32).tobytes())
            # Rotation (4 floats = 16 bytes)
            f.write(rotations[i].astype(np.float32).tobytes())
            # Color RGBA (4 bytes)
            f.write(colors[i].astype(np.uint8).tobytes())
            # Opacity (1 float = 4 bytes)
            f.write(np.array([opacities[i]], dtype=np.float32).tobytes())
            
            if i % 10000 == 0:
                print(f"  Progress: {i}/{num_splats}")
        
    print("Writing weights.bin (interleaved format)...")
    # Interleaved format: for each splat, write indices then weights
    # Format per splat: Indices(4 x uint16 = 8 bytes) + Weights(4 x float32 = 16 bytes) = 24 bytes
    with open(os.path.join(output_dir, "weights.bin"), 'wb') as f:
        for i in range(num_splats):
            # Indices (4 x uint16 = 8 bytes)
            f.write(top_indices[i].astype(np.uint16).tobytes())
            # Weights (4 x float32 = 16 bytes)
            f.write(top_weights[i].astype(np.float32).tobytes())

    if poses is not None:
        print("Writing animation.bin...")
        with open(os.path.join(output_dir, "animation.bin"), 'wb') as f:
            f.write(poses.astype(np.float32).tobytes())
        
        # Add animation info to header
        animation_bone_count = animation_num_bones if animation_num_bones is not None else (int(poses.shape[1]) if len(poses.shape) > 1 else None)
        header["animation"] = {
            "file": "animation.bin",
            "format": "float32",
            "numFrames": int(poses.shape[0]),
            "numBones": animation_bone_count,
            "shape": list(poses.shape),
            "stride": 64  # 16 floats × 4 bytes per bone per frame
        }
    
    # Write joints.bin if available
    if joints is not None:
        print("Writing joints.bin...")
        # Format: 441 joints × 3 floats (x, y, z) = 12 bytes per joint
        with open(os.path.join(output_dir, "joints.bin"), 'wb') as f:
            f.write(joints.astype(np.float32).tobytes())
        print(f"  Exported {len(joints)} joint positions")
        
        # Also add joints to header for easy access
        header["joints"] = {
            "count": len(joints),
            "file": "joints.bin",
            "format": "float32",
            "stride": 12  # 3 floats × 4 bytes
        }
    
    # Write header with all info (skeleton, joints, etc.)
    print("Writing pkl_header.json...")
    with open(os.path.join(output_dir, "pkl_header.json"), 'w') as f:
        json.dump(header, f, indent=2)
            
    print("Done! Output saved to", output_dir)

def convert_441_skeleton(input_path, output_dir):
    if not os.path.exists(input_path):
        print(f"Missing 441-skeleton.pt: {input_path}")
        return

    os.makedirs(output_dir, exist_ok=True)

    skeleton_data = torch.load(str(input_path), map_location='cpu')
    bone_names = None
    parents = None

    def to_np_local(x):
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
        return np.array(x)

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
        bone_names = to_np_local(bone_names) if isinstance(bone_names, torch.Tensor) else list(bone_names)
        header["boneNames"] = bone_names if isinstance(bone_names, list) else bone_names.tolist()

    if parents is not None:
        parents = to_np_local(parents) if isinstance(parents, torch.Tensor) else np.array(parents)
        parents_int32 = parents.astype(np.int32)
        with open(os.path.join(output_dir, "parents.bin"), "wb") as f:
            f.write(parents_int32.tobytes())
        header["parents"] = {
            "file": "parents.bin",
            "format": "int32",
            "count": int(parents_int32.shape[0]),
            "stride": 4
        }

    with open(os.path.join(output_dir, "skeleton_header.json"), "w") as f:
        json.dump(header, f, indent=2)

    print(f"Done! Output saved to {output_dir}")

def convert_std_male_model(input_path, output_dir):
    if not os.path.exists(input_path):
        print(f"Missing std_male.model.pt: {input_path}")
        return

    os.makedirs(output_dir, exist_ok=True)

    std_male_model_data = torch.load(str(input_path), map_location='cpu')
    header = {"stdMaleModel": {}}

    def to_np_local(x):
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
        return np.array(x)

    if isinstance(std_male_model_data, dict) and 'joints' in std_male_model_data:
        joints_data = std_male_model_data['joints']

        if 'rest_translations' in joints_data:
            rest_trans = to_np_local(joints_data['rest_translations'])
            rest_trans = cv_to_gl(rest_trans)
            with open(os.path.join(output_dir, "std_male_rest_translations.bin"), "wb") as f:
                f.write(rest_trans.astype(np.float32).tobytes())
            header["stdMaleModel"]["restTranslations"] = {
                "file": "std_male_rest_translations.bin",
                "format": "float32",
                "shape": list(rest_trans.shape),
                "count": int(rest_trans.shape[0]),
                "stride": 12
            }

        if 'rest_rotations' in joints_data:
            rest_rots = to_np_local(joints_data['rest_rotations'])
            rest_rots = cv_to_gl_quat(rest_rots)
            with open(os.path.join(output_dir, "std_male_rest_rotations.bin"), "wb") as f:
                f.write(rest_rots.astype(np.float32).tobytes())
            header["stdMaleModel"]["restRotations"] = {
                "file": "std_male_rest_rotations.bin",
                "format": "float32",
                "shape": list(rest_rots.shape),
                "count": int(rest_rots.shape[0]),
                "stride": 16
            }

        if 'parents' in joints_data:
            parents_std = to_np_local(joints_data['parents']).astype(np.int32)
            with open(os.path.join(output_dir, "std_male_parents.bin"), "wb") as f:
                f.write(parents_std.tobytes())
            header["stdMaleModel"]["parents"] = {
                "file": "std_male_parents.bin",
                "format": "int32",
                "count": int(parents_std.shape[0]),
                "stride": 4
            }

        if 'comp_translations' in joints_data:
            comp_trans = to_np_local(joints_data['comp_translations'])
            comp_trans = cv_to_gl(comp_trans)
            with open(os.path.join(output_dir, "std_male_comp_translations.bin"), "wb") as f:
                f.write(comp_trans.astype(np.float32).tobytes())
            header["stdMaleModel"]["compTranslations"] = {
                "file": "std_male_comp_translations.bin",
                "format": "float32",
                "shape": list(comp_trans.shape),
                "count": int(comp_trans.shape[0]),
                "stride": 12
            }

        if 'comp_rotations' in joints_data:
            comp_rots = to_np_local(joints_data['comp_rotations'])
            comp_rots = cv_to_gl_quat(comp_rots)
            with open(os.path.join(output_dir, "std_male_comp_rotations.bin"), "wb") as f:
                f.write(comp_rots.astype(np.float32).tobytes())
            header["stdMaleModel"]["compRotations"] = {
                "file": "std_male_comp_rotations.bin",
                "format": "float32",
                "shape": list(comp_rots.shape),
                "count": int(comp_rots.shape[0]),
                "stride": 16
            }

    if isinstance(std_male_model_data, dict) and 'verts' in std_male_model_data:
        verts = to_np_local(std_male_model_data['verts'])
        verts = cv_to_gl(verts)
        with open(os.path.join(output_dir, "std_male_verts.bin"), "wb") as f:
            f.write(verts.astype(np.float32).tobytes())
        header["stdMaleModel"]["verts"] = {
            "file": "std_male_verts.bin",
            "format": "float32",
            "shape": list(verts.shape),
            "count": int(verts.shape[0]),
            "stride": 12
        }

    with open(os.path.join(output_dir, "std_male_header.json"), "w") as f:
        json.dump(header, f, indent=2)

    print(f"Done! Output saved to {output_dir}")

def main():
    root = Path(__file__).resolve().parents[1]
    model_root = root / 'assets' / 'model'

    gs_example_input = model_root / 'gs_example' / 'pytorch' / 'gs_example.pkl'
    gs_example_output = model_root / 'gs_example' / 'converted'
    skeleton_input = model_root / '441_skeleton' / 'pytorch' / '441-skeleton.pt'
    skeleton_output = model_root / '441_skeleton' / 'converted'
    std_male_input = model_root / 'std_male_model' / 'pytorch' / 'std_male.model.pt'
    std_male_output = model_root / 'std_male_model' / 'converted'

    def clear_converted_folder(path: Path):
        if not path.exists():
            return
        for entry in path.iterdir():
            if entry.is_file():
                entry.unlink()
            elif entry.is_dir():
                for child in entry.rglob('*'):
                    if child.is_file():
                        child.unlink()
                for child in sorted(entry.rglob('*'), reverse=True):
                    if child.is_dir():
                        child.rmdir()
                entry.rmdir()

    clear_converted_folder(gs_example_output)
    clear_converted_folder(skeleton_output)
    clear_converted_folder(std_male_output)

    if gs_example_input.exists():
        process_data(str(gs_example_input), str(gs_example_output))
    else:
        print(f"Missing gs_example.pkl: {gs_example_input}")

    convert_441_skeleton(str(skeleton_input), str(skeleton_output))
    convert_std_male_model(str(std_male_input), str(std_male_output))

if __name__ == "__main__":
    main()
