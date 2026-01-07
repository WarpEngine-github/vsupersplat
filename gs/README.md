# 3D Gaussian Splatting Web Engine

A real-time 3D Gaussian Splatting renderer built with React, Three.js, and WebGL.

## 🎯 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173 in browser
```

## 📚 Architecture Overview

This project renders **3D Gaussian Splatting (3DGS)** models in the browser. If you're new to 3DGS, here's what you need to know:

### What is 3D Gaussian Splatting?

Traditional 3D rendering uses **triangles** to represent surfaces. 3DGS uses thousands of **Gaussian ellipsoids** (splats) instead. Each splat is a fuzzy 3D blob with:

- **Position (μ)**: Center point in 3D space
- **Covariance (Σ)**: Shape/orientation (stored as rotation + scale)
- **Color**: RGB values
- **Opacity**: Transparency

When rendered, these blobs blend together to create photorealistic images.

```
Traditional Mesh:          Gaussian Splats:
    ╱╲                        · · ·
   ╱  ╲                      ·     ·
  ╱────╲                    ·  ○○○  ·
  │    │                   ·  ○○○○○  ·
  │    │                    ·  ○○○  ·
  └────┘                      ·   ·
```

## 🗂 Project Structure

```
web-engine/
├── src/
│   ├── App.tsx              # Main React component
│   ├── types/
│   │   └── index.ts         # Shared TypeScript interfaces
│   ├── engine/              # Core rendering engine
│   │   ├── SplatLoader.ts   # Loads binary asset files
│   │   ├── SplatMesh.ts     # GPU-ready mesh with data textures
│   │   └── AnimationSystem.ts # Skeletal animation controller
│   ├── shaders/             # WebGL GLSL shaders
│   │   ├── splat.vert       # Vertex shader (3D → 2D projection)
│   │   └── splat.frag       # Fragment shader (Gaussian evaluation)
│   └── components/          # React UI components
│       ├── Viewer.tsx       # Three.js canvas wrapper
│       ├── Timeline.tsx     # Animation playback controls
│       ├── Sidebar.tsx      # Asset list panel
│       └── PerformanceMonitor.tsx # FPS/memory stats
└── public/
    └── assets/              # Example asset files
```

## 🔄 Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OFFLINE CONVERSION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Original .pkl file                  Binary Files (Web-ready)              │
│   (from 3DGS training)                                                      │
│          │                                                                  │
│          ▼                                                                  │
│   ┌──────────────┐                    ┌─────────────────┐                   │
│   │ converter.py │ ──────────────────▶│ header.json     │ Metadata          │
│   │ (Python)     │                    │ splats.bin      │ Position/rot/scale│
│   └──────────────┘                    │ weights.bin     │ Skinning weights  │
│                                       │ animation.bin   │ Bone matrices     │
│                                       └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RUNTIME LOADING                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐             │
│   │ SplatLoader │ ──────▶│ SplatMesh   │ ──────▶│ GPU Render  │             │
│   │             │        │             │        │             │             │
│   │ • Fetch     │        │ • Data      │        │ • Vertex    │             │
│   │   files     │        │   Textures  │        │   Shader    │             │
│   │ • Parse     │        │ • Instanced │        │ • Fragment  │             │
│   │   binary    │        │   Geometry  │        │   Shader    │             │
│   └─────────────┘        └─────────────┘        └─────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🧮 Rendering Pipeline Deep Dive

### 1. Data Loading (`SplatLoader.ts`)

The loader reads binary files and creates typed arrays:

```typescript
// splats.bin layout (48 bytes per splat):
// Position (3 × f32 = 12 bytes) │ Scale (3 × f32 = 12 bytes)
// Rotation (4 × f32 = 16 bytes) │ Color (4 × u8 = 4 bytes) │ Opacity (f32 = 4 bytes)
```

### 2. GPU Data Preparation (`SplatMesh.ts`)

Data is packed into **Data Textures** because GPUs can't handle 60K+ vertex attributes:

```
Why textures?
─────────────
Attributes: Limited to ~16 per vertex
Textures:   Can store millions of values

Texture Layout (252×252 for 63,441 splats):
┌────────────────────────────┐
│ [0]  [1]  [2]  ... [251]   │
│ [252][253][254]...         │
│ ...                        │
└────────────────────────────┘
```

### 3. Vertex Shader (`splat.vert`)

For each splat, the shader:

1. **Fetches data** from textures using instance index
2. **Transforms** 3D position to view space
3. **Projects covariance** to 2D screen space
4. **Computes quad size** (3σ covers 99.7% of Gaussian)

Key math:
```
3D Covariance: Σ = R · S · Sᵀ · Rᵀ
               (rotation × scale)

2D Projection: Σ_2D = J · W · Σ · Wᵀ · Jᵀ
               (Jacobian × view transform)
```

### 4. Fragment Shader (`splat.frag`)

For each pixel in the quad:

1. **Evaluate Gaussian**: `G(x,y) = exp(-0.5 × (ax² + 2bxy + cy²))`
2. **Compute alpha**: Gaussian falloff × splat opacity
3. **Output color**: Premultiplied alpha for blending

### 5. Animation System (`AnimationSystem.ts`)

Skeletal animation deforms splats using bone transforms:

```
Final Position = Σ (bone_weight_i × BoneMatrix_i × RestPosition)

Each splat has 4 bone influences (indices + weights)
Bone matrices stored in texture (441 bones × 4 pixels × 4 floats)
```

## 📁 Binary File Formats

### header.json
```json
{
  "numSplats": 63441,
  "numBones": 441,
  "numFrames": 975,
  "bounds": {
    "min": [-0.5, 0.0, -0.3],
    "max": [0.6, 1.8, 0.3]
  }
}
```

### splats.bin (48 bytes × numSplats)
| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0 | 12 | 3×f32 | Position (x,y,z) |
| 12 | 12 | 3×f32 | Scale (sx,sy,sz) |
| 24 | 16 | 4×f32 | Rotation quaternion (x,y,z,w) |
| 40 | 4 | 4×u8 | Color RGBA |
| 44 | 4 | f32 | Opacity |

### weights.bin (24 bytes × numSplats)
| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0 | 8 | 4×u16 | Bone indices |
| 8 | 16 | 4×f32 | Bone weights |

### animation.bin (16 floats × numBones × numFrames)
4×4 transformation matrices in column-major order.

## 🎓 Learning Resources

- [3D Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [Three.js Documentation](https://threejs.org/docs/)
- [WebGL Fundamentals](https://webglfundamentals.org/)

## 🛠 Development Tips

### Adding Console Logs
```typescript
// Use console.warn for important logs (won't be stripped in production)
console.warn(`Loaded ${numSplats} splats`);
```

### Performance Profiling
1. Open Chrome DevTools → Performance tab
2. Record while interacting with the viewer
3. Look for long frames (> 16ms) in the flame graph

### Common Issues

**Black screen / No splats visible:**
- Check console for loading errors
- Verify asset files exist in `/public/assets/`
- Check camera position (might be inside the model)

**Low FPS:**
- Reduce splat count (filter low-opacity in converter)
- Disable sorting (`mesh.setSortEnabled(false)`)
- Use lower device pixel ratio

## 📝 Contributing

1. Read the code comments (they explain the math!)
2. Keep functions small and focused
3. Add comments for non-obvious code
4. Test on both high-end and low-end devices

---

Made with ❤️ for learning 3D graphics
