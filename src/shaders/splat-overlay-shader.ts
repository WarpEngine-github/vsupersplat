const vertexShader = /* glsl */ `
    attribute uint vertex_id;

    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;

    uniform sampler2D splatState;
    uniform highp usampler2D splatPosition;
    uniform highp usampler2D splatTransform;        // per-splat index into transform palette
    uniform sampler2D transformPalette;             // palette of transform matrices

    #ifdef USE_BONE_BLENDING
    uniform sampler2D boneIndices;                  // RGBA32F: 4 bone indices per splat
    uniform sampler2D boneWeights;                  // RGBA32F: 4 bone weights per splat
    #endif

    uniform uvec2 texParams;

    uniform float splatSize;
    uniform vec4 selectedClr;
    uniform vec4 unselectedClr;

    varying vec4 varying_color;

    // calculate the current splat index and uv
    ivec2 calcSplatUV(uint index, uint width) {
        return ivec2(int(index % width), int(index / width));
    }

    mat4 readTransformFromPalette(uint paletteIndex) {
        if (paletteIndex == 0u) {
            return mat4(1.0);
        }
        
        int u = int(paletteIndex % 512u) * 3;
        int v = int(paletteIndex / 512u);
        
        mat4 t;
        t[0] = texelFetch(transformPalette, ivec2(u, v), 0);
        t[1] = texelFetch(transformPalette, ivec2(u + 1, v), 0);
        t[2] = texelFetch(transformPalette, ivec2(u + 2, v), 0);
        t[3] = vec4(0.0, 0.0, 0.0, 1.0);
        
        return transpose(t);
    }

    void main(void) {
        ivec2 splatUV = calcSplatUV(vertex_id, texParams.x);
        uint splatState = uint(texelFetch(splatState, splatUV, 0).r * 255.0);

        if ((splatState & 6u) != 0u) {
            // deleted or locked (4 or 2)
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            gl_PointSize = 0.0;
        } else {
            mat4 model = matrix_model;
        
            #ifdef USE_BONE_BLENDING
            // 4-way bone blending
            vec4 boneIndicesVec = texelFetch(boneIndices, splatUV, 0);
            vec4 boneWeightsVec = texelFetch(boneWeights, splatUV, 0);
            
            // Check if bone blending is active (non-zero weights)
            float totalWeight = dot(boneWeightsVec, vec4(1.0));
            if (totalWeight > 0.001) {
                mat4 blendedTransform = mat4(0.0);
                
                for (int i = 0; i < 4; i++) {
                    float weight = boneWeightsVec[i];
                    if (weight > 0.001) {
                        // Convert float palette index back to uint
                        uint paletteIndex = uint(boneIndicesVec[i] + 0.5);
                        mat4 boneTransform = readTransformFromPalette(paletteIndex);
                        blendedTransform += boneTransform * weight;
                    }
                }
                
                // Normalize the blended transform
                if (totalWeight > 0.001) {
                    blendedTransform /= totalWeight;
                }
                
                model = matrix_model * blendedTransform;
            } else {
                // Fallback to single transform
                uint transformIndex = texelFetch(splatTransform, splatUV, 0).r;
                if (transformIndex > 0u) {
                    mat4 t = readTransformFromPalette(transformIndex);
                    model = matrix_model * t;
                }
            }
            #else
            // Single transform (original behavior)
            uint transformIndex = texelFetch(splatTransform, splatUV, 0).r;
            if (transformIndex > 0u) {
                mat4 t = readTransformFromPalette(transformIndex);
                model = matrix_model * t;
            }
            #endif

            varying_color = (splatState == 1u) ? selectedClr : unselectedClr;

            vec3 center = uintBitsToFloat(texelFetch(splatPosition, splatUV, 0).xyz);

            gl_Position = matrix_viewProjection * model * vec4(center, 1.0);
            gl_PointSize = splatSize;
        }
    }
`;

const fragmentShader = /* glsl */ `
    varying vec4 varying_color;

    void main(void) {
        gl_FragColor = varying_color;
    }
`;

export { vertexShader, fragmentShader };
