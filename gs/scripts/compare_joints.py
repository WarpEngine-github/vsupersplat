#!/usr/bin/env python3
import numpy as np
import sys
import os

# Change to script directory
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# Load joints.bin
print("Loading joints.bin...")
with open('gs/assets/converted/joints.bin', 'rb') as f:
    joints_data = np.frombuffer(f.read(), dtype=np.float32)
    joints = joints_data.reshape(-1, 3)
    print(f'joints.bin: shape={joints.shape}, total floats={len(joints_data)}')
    print(f'  First 10 joints:')
    for i in range(min(10, len(joints))):
        print(f'    Joint {i}: ({joints[i][0]:.6f}, {joints[i][1]:.6f}, {joints[i][2]:.6f})')

# Load std_male_rest_translations.bin
print("\nLoading std_male_rest_translations.bin...")
with open('gs/assets/converted/std_male_rest_translations.bin', 'rb') as f:
    std_male_data = np.frombuffer(f.read(), dtype=np.float32)
    std_male = std_male_data.reshape(-1, 3)
    print(f'std_male_rest_translations.bin: shape={std_male.shape}, total floats={len(std_male_data)}')
    print(f'  First 10 translations:')
    for i in range(min(10, len(std_male))):
        print(f'    Bone {i}: ({std_male[i][0]:.6f}, {std_male[i][1]:.6f}, {std_male[i][2]:.6f})')

# Compare first 20
print(f'\n{"="*80}')
print(f'Comparison (first 20):')
print(f'{"Index":<6} | {"joints.bin":<35} | {"std_male_rest_translations":<35} | {"Difference":<12}')
print(f'{"-"*6} | {"-"*35} | {"-"*35} | {"-"*12}')
for i in range(min(20, len(joints), len(std_male))):
    diff = joints[i] - std_male[i]
    diff_mag = np.linalg.norm(diff)
    print(f'{i:<6} | ({joints[i][0]:8.6f}, {joints[i][1]:8.6f}, {joints[i][2]:8.6f}) | ({std_male[i][0]:8.6f}, {std_male[i][1]:8.6f}, {std_male[i][2]:8.6f}) | {diff_mag:.6f}')

# Check if they're identical
print(f'\n{"="*80}')
if np.allclose(joints, std_male, atol=1e-6):
    print(f'✓ Data is identical (within tolerance)')
else:
    print(f'✗ Data differs')
    differences = np.linalg.norm(joints - std_male, axis=1)
    max_diff_idx = np.argmax(differences)
    max_diff = joints[max_diff_idx] - std_male[max_diff_idx]
    print(f'\n  Max difference at index {max_diff_idx}:')
    print(f'    joints.bin:                    ({joints[max_diff_idx][0]:.6f}, {joints[max_diff_idx][1]:.6f}, {joints[max_diff_idx][2]:.6f})')
    print(f'    std_male_rest_translations:    ({std_male[max_diff_idx][0]:.6f}, {std_male[max_diff_idx][1]:.6f}, {std_male[max_diff_idx][2]:.6f})')
    print(f'    Difference:                    ({max_diff[0]:.6f}, {max_diff[1]:.6f}, {max_diff[2]:.6f})')
    print(f'    Magnitude:                     {np.linalg.norm(max_diff):.6f}')
    
    # Show some statistics
    print(f'\n  Statistics:')
    print(f'    Mean difference: {np.mean(differences):.6f}')
    print(f'    Max difference:  {np.max(differences):.6f}')
    print(f'    Min difference:  {np.min(differences):.6f}')
    print(f'    Std deviation:   {np.std(differences):.6f}')
    
    # Show a few more examples with large differences
    print(f'\n  Top 5 largest differences:')
    top5_indices = np.argsort(differences)[-5:][::-1]
    for idx in top5_indices:
        diff = joints[idx] - std_male[idx]
        print(f'    Index {idx}: magnitude={differences[idx]:.6f}, diff=({diff[0]:.6f}, {diff[1]:.6f}, {diff[2]:.6f})')

