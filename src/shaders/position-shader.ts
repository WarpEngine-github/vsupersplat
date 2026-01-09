const vertexShader = /* glsl */ `
    attribute vec2 vertex_position;
    void main(void) {
        gl_Position = vec4(vertex_position, 0.0, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform highp usampler2D transformA;            // splat center x, y, z
    uniform highp usampler2D splatTransform;        // transform palette index
    uniform sampler2D transformPalette;             // palette of transforms

    #ifdef USE_BONE_BLENDING
    uniform sampler2D boneIndices;                  // RGBA32F: 4 bone indices per splat
    uniform sampler2D boneWeights;                  // RGBA32F: 4 bone weights per splat
    #endif

    uniform ivec2 splat_params;                     // splat texture width, num splats

    mat3x4 readTransformFromPalette(uint paletteIndex) {
        if (paletteIndex == 0u) {
            return mat3x4(
                vec4(1.0, 0.0, 0.0, 0.0),
                vec4(0.0, 1.0, 0.0, 0.0),
                vec4(0.0, 0.0, 1.0, 0.0)
            );
        }
        
        int u = int(paletteIndex % 512u) * 3;
        int v = int(paletteIndex / 512u);
        
        mat3x4 t;
        t[0] = texelFetch(transformPalette, ivec2(u, v), 0);
        t[1] = texelFetch(transformPalette, ivec2(u + 1, v), 0);
        t[2] = texelFetch(transformPalette, ivec2(u + 2, v), 0);
        
        return t;
    }

    void main(void) {
        // calculate output id
        ivec2 splatUV = ivec2(gl_FragCoord);

        // skip if splat index is out of bounds
        if (splatUV.x + splatUV.y * splat_params.x >= splat_params.y) {
            discard;
        }

        // read splat center
        vec3 center = uintBitsToFloat(texelFetch(transformA, splatUV, 0).xyz);

        #ifdef USE_BONE_BLENDING
        // 4-way bone blending
        vec4 boneIndicesVec = texelFetch(boneIndices, splatUV, 0);
        vec4 boneWeightsVec = texelFetch(boneWeights, splatUV, 0);
        
        // Check if bone blending is active (non-zero weights)
        float totalWeight = dot(boneWeightsVec, vec4(1.0));
        if (totalWeight > 0.001) {
            mat3x4 blendedTransform = mat3x4(
                vec4(0.0),
                vec4(0.0),
                vec4(0.0)
            );
            
            for (int i = 0; i < 4; i++) {
                float weight = boneWeightsVec[i];
                if (weight > 0.001) {
                    // Convert float palette index back to uint
                    uint paletteIndex = uint(boneIndicesVec[i] + 0.5);
                    mat3x4 boneTransform = readTransformFromPalette(paletteIndex);
                    blendedTransform[0] += boneTransform[0] * weight;
                    blendedTransform[1] += boneTransform[1] * weight;
                    blendedTransform[2] += boneTransform[2] * weight;
                }
            }
            
            // Normalize the blended transform
            if (totalWeight > 0.001) {
                blendedTransform[0] /= totalWeight;
                blendedTransform[1] /= totalWeight;
                blendedTransform[2] /= totalWeight;
            }
            
            center = vec4(center, 1.0) * blendedTransform;
        } else {
            // Fallback to single transform
            uint transformIndex = texelFetch(splatTransform, splatUV, 0).r;
            if (transformIndex > 0u) {
                mat3x4 t = readTransformFromPalette(transformIndex);
                center = vec4(center, 1.0) * t;
            }
        }
        #else
        // Single transform (original behavior)
        uint transformIndex = texelFetch(splatTransform, splatUV, 0).r;
        if (transformIndex > 0u) {
            mat3x4 t = readTransformFromPalette(transformIndex);
            center = vec4(center, 1.0) * t;
        }
        #endif

        gl_FragColor = vec4(center, 0.0);
    }
`;

export { vertexShader, fragmentShader };
