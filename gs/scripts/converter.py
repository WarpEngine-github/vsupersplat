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

    means = to_np(data['mu'])
    covs = to_np(data['cov'])
    colors = to_np(data['color'])
    opacities = to_np(data['opacity'])
    weights = to_np(data['W']) # Skinning weights (N, Bones)
    
    print(f"Original data shapes:")
    print(f"  Means: {means.shape}")
    print(f"  Covs: {covs.shape}")
    print(f"  Colors: {colors.shape}")
    print(f"  Opacities: {opacities.shape}")
    print(f"  Weights: {weights.shape}")
    
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
            
    print("Done! Output saved to", output_dir)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert GS assets to Web format")
    parser.add_argument("input_file", help="Path to .pkl file")
    parser.add_argument("output_dir", help="Directory to save output files")
    
    args = parser.parse_args()
    
    process_data(args.input_file, args.output_dir)
