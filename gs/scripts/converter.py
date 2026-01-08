import os
import json
import struct
import argparse
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

def process_data(input_path, output_dir):
    print(f"Loading {input_path}...")
    
    with open(input_path, 'rb') as f:
        data = pickle.load(f)
    
    print("Keys found:", data.keys())
    
    def to_np(x):
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
        return np.array(x)
    
    # ============================================
    # Temporarily export pickle data for inspection
    # ============================================
    print("\nExporting pickle data summary...")
    pickle_summary = {}
    
    def summarize_array(arr, max_items=5):
        """Create a summary of an array"""
        arr_np = to_np(arr)
        summary = {
            "shape": list(arr_np.shape),
            "dtype": str(arr_np.dtype),
            "min": float(arr_np.min()) if arr_np.size > 0 else None,
            "max": float(arr_np.max()) if arr_np.size > 0 else None,
            "mean": float(arr_np.mean()) if arr_np.size > 0 else None,
        }
        # Add sample values for small arrays
        if arr_np.size <= max_items:
            if arr_np.ndim <= 2:
                summary["sample"] = arr_np.tolist()
        elif arr_np.ndim == 1:
            summary["sample_first"] = arr_np[:max_items].tolist()
            summary["sample_last"] = arr_np[-max_items:].tolist()
        elif arr_np.ndim == 2:
            summary["sample_first_row"] = arr_np[0, :max_items].tolist() if arr_np.shape[0] > 0 else None
        return summary
    
    for key, value in data.items():
        try:
            if isinstance(value, (torch.Tensor, np.ndarray)):
                summary = summarize_array(value)
                # Add bone count analysis for relevant arrays
                arr_np = to_np(value)
                if key == 'W' and len(arr_np.shape) == 2:
                    summary["num_bones"] = arr_np.shape[1]
                    summary["note"] = f"Weights matrix: {arr_np.shape[0]} splats × {arr_np.shape[1]} bones"
                elif key == 'joints' and len(arr_np.shape) == 2:
                    summary["num_joints"] = arr_np.shape[0]
                    summary["note"] = f"Joint positions: {arr_np.shape[0]} joints × {arr_np.shape[1]} coordinates"
                pickle_summary[key] = summary
            elif isinstance(value, dict):
                nested_summary = {
                    "type": "dict",
                    "keys": list(value.keys()),
                    "note": "Nested dictionary"
                }
                # Analyze poses dict specifically
                if key == 'poses':
                    if 'rotations' in value:
                        rot_np = to_np(value['rotations'])
                        nested_summary["rotations_shape"] = list(rot_np.shape)
                        nested_summary["num_frames"] = rot_np.shape[0] if len(rot_np.shape) > 0 else None
                        nested_summary["num_bones_in_animation"] = rot_np.shape[1] if len(rot_np.shape) > 1 else None
                    if 'translations' in value:
                        trans_np = to_np(value['translations'])
                        nested_summary["translations_shape"] = list(trans_np.shape)
                        nested_summary["num_bones_in_animation_trans"] = trans_np.shape[1] if len(trans_np.shape) > 1 else None
                    # Compare with weights bone count
                    if 'W' in data:
                        weights_np = to_np(data['W'])
                        nested_summary["num_bones_for_skinning"] = weights_np.shape[1] if len(weights_np.shape) > 1 else None
                        if nested_summary.get("num_bones_in_animation") and nested_summary.get("num_bones_for_skinning"):
                            diff = nested_summary["num_bones_in_animation"] - nested_summary["num_bones_for_skinning"]
                            nested_summary["bone_count_difference"] = diff
                            nested_summary["note"] = f"Animation has {nested_summary['num_bones_in_animation']} bones, but weights reference {nested_summary['num_bones_for_skinning']} bones (difference: {diff})"
                pickle_summary[key] = nested_summary
            else:
                pickle_summary[key] = {
                    "type": type(value).__name__,
                    "value": str(value)[:200] if len(str(value)) <= 200 else str(value)[:200] + "..."
                }
        except Exception as e:
            pickle_summary[key] = {
                "type": type(value).__name__,
                "error": str(e)
            }
    
    # Add overall bone count comparison
    if 'W' in data and 'poses' in data:
        weights_np = to_np(data['W'])
        num_bones_weights = weights_np.shape[1] if len(weights_np.shape) > 1 else None
        
        poses_data = data['poses']
        if hasattr(poses_data, 'item') and hasattr(poses_data, 'ndim') and poses_data.ndim == 0:
            poses_data = poses_data.item()
        
        if isinstance(poses_data, dict) and 'rotations' in poses_data:
            rot_np = to_np(poses_data['rotations'])
            num_bones_animation = rot_np.shape[1] if len(rot_np.shape) > 1 else None
            
            pickle_summary["_bone_count_analysis"] = {
                "weights_bones": num_bones_weights,
                "animation_bones": num_bones_animation,
                "joints_bones": pickle_summary.get('joints', {}).get('num_joints') if 'joints' in pickle_summary else None,
                "match": num_bones_weights == num_bones_animation if (num_bones_weights and num_bones_animation) else None,
                "note": "Comparison of bone counts across different data sources"
            }
    
    # Save summary to JSON
    os.makedirs(output_dir, exist_ok=True)
    summary_path = os.path.join(output_dir, "pickle_summary.json")
    with open(summary_path, 'w') as f:
        json.dump(pickle_summary, f, indent=2)
    print(f"  Saved pickle data summary to {summary_path}")

    means = to_np(data['mu'])
    covs = to_np(data['cov'])
    colors = to_np(data['color'])
    opacities = to_np(data['opacity'])
    weights = to_np(data['W']) # Skinning weights (N, Bones)
    
    # Load joints (bone rest positions) if available
    joints = None
    if 'joints' in data:
        joints = to_np(data['joints'])
        print(f"Joints: {joints.shape}")
    
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
            num_bones = rotations.shape[1]
            
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
    
    # 1. Prepare Splat Data
    print("Decomposing covariance matrices...")
    w, v = np.linalg.eigh(covs) 
    scales = np.sqrt(np.maximum(w, 1e-8))
    dets = np.linalg.det(v)
    v[dets < 0, :, 0] *= -1 
    rotations = Rotation.from_matrix(v).as_quat() 
    
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
        "numFrames": poses.shape[0] if poses is not None else 0,
        "bounds": {
            "min": means.min(axis=0).tolist(),
            "max": means.max(axis=0).tolist()
        }
    }
    
    with open(os.path.join(output_dir, "header.json"), 'w') as f:
        json.dump(header, f, indent=2)
        
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
        
        # Update header.json with joints info
        with open(os.path.join(output_dir, "header.json"), 'w') as f:
            json.dump(header, f, indent=2)
            
    print("Done! Output saved to", output_dir)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert GS assets to Web format")
    parser.add_argument("input_file", help="Path to .pkl file")
    parser.add_argument("output_dir", help="Directory to save output files")
    
    args = parser.parse_args()
    
    process_data(args.input_file, args.output_dir)
