/**
 * =============================================================================
 * Gaussian Splat Vertex Shader
 * =============================================================================
 * 
 * PURPOSE:
 * Transform 3D Gaussian splats into screen-space quads for rasterization.
 * 
 * ALGORITHM OVERVIEW:
 * 
 *   For each Gaussian splat:
 *   1. Fetch splat data from textures (position, rotation, scale, color)
 *   2. Transform 3D position to view space
 *   3. Project 3D covariance matrix to 2D screen space
 *   4. Calculate screen-space ellipse size from 2D covariance
 *   5. Position quad vertices to cover the ellipse
 *   6. Pass covariance parameters to fragment shader
 * 
 * KEY MATH:
 * 
 *   3D Gaussian:  G(x) = exp(-0.5 * (x-μ)ᵀ Σ⁻¹ (x-μ))
 *   
 *   Where Σ (covariance) = R * S * Sᵀ * Rᵀ
 *     - R: Rotation matrix (from quaternion)
 *     - S: Scale matrix (diagonal)
 *   
 *   2D Projection uses Jacobian of perspective projection:
 *     Σ₂ᴅ = J * W * Σ₃ᴅ * Wᵀ * Jᵀ
 *   
 *   The quad size is 3σ (covers ~99.7% of Gaussian energy)
 */

precision highp float;
precision highp int;

// =============================================================================
// Attributes
// =============================================================================

/** Per-instance: Index into data textures (0 to numSplats-1) */
attribute float splatIndex;

/** Per-vertex: Corner offset for the quad [-1,-1] to [1,1] */
attribute vec2 splatCorner;

// =============================================================================
// Uniforms - Camera & Viewport
// =============================================================================

/** Screen dimensions in pixels */
uniform vec2 viewport;

/** Focal length in pixels (fx, fy) computed from camera FOV */
uniform vec2 focal;

// =============================================================================
// Uniforms - Data Textures
// =============================================================================

/** Position texture: RGB = xyz world position */
uniform sampler2D texPosition;

/** Rotation texture: RGBA = quaternion (x,y,z,w) */
uniform sampler2D texRotation;

/** Scale texture: RGB = xyz scale factors */
uniform sampler2D texScale;

/** Color texture: RGB = color, A = opacity */
uniform sampler2D texColor;

/** Texture dimensions for UV calculation */
uniform vec2 textureSize;

// NOTE: Combined texture optimization (texPosScale, texRotColor) removed
// as it was not being used and added complexity without benefit.

// =============================================================================
// Varyings - Passed to Fragment Shader
// =============================================================================

/** RGBA color with alpha */
varying vec4 vColor;

/** Position within quad relative to center (for Gaussian evaluation) */
varying vec2 vPosition;

/** Conic parameters for 2D Gaussian: (a, b, c) where ax² + 2bxy + cy² */
varying vec3 vConic;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert splat index to texture UV coordinates.
 * Maps linear index to 2D texture position.
 * 
 * @param index - Splat index (0 to numSplats-1)
 * @return UV coordinates (0-1 range)
 */
vec2 getTexCoord(float index) {
    float x = (mod(index, textureSize.x) + 0.5) / textureSize.x;
    float y = (floor(index / textureSize.x) + 0.5) / textureSize.y;
    return vec2(x, y);
}

/**
 * Convert quaternion to 3x3 rotation matrix.
 * 
 * Quaternion format: (x, y, z, w) where w is the scalar part.
 * 
 * @param q - Normalized quaternion
 * @return 3x3 rotation matrix
 */
mat3 quatToMat3(vec4 q) {
    // Pre-compute doubled values for efficiency
    float x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    float xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    float yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    float wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    
    return mat3(
        1.0 - (yy + zz), xy + wz,         xz - wy,
        xy - wz,         1.0 - (xx + zz), yz + wx,
        xz + wy,         yz - wx,         1.0 - (xx + yy)
    );
}

// =============================================================================
// Main Vertex Shader
// =============================================================================

void main() {
    // =========================================================================
    // Step 1: Fetch Splat Data from Textures
    // =========================================================================
    vec2 uv = getTexCoord(splatIndex);
    
    vec3 position = texture2D(texPosition, uv).rgb;
    vec4 rotation = texture2D(texRotation, uv);
    vec3 scale = texture2D(texScale, uv).rgb;
    vec4 colorData = texture2D(texColor, uv);
    
    // =========================================================================
    // Step 2: Early Culling - Skip Nearly Invisible Splats
    // =========================================================================
    if (colorData.a < 0.004) { // < 1/255, essentially invisible
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // Behind camera
        return;
    }
    
    // =========================================================================
    // Step 3: Transform to View Space
    // =========================================================================
    vec4 p_view = modelViewMatrix * vec4(position, 1.0);
    float z = p_view.z; // Negative = in front of camera
    
    // Cull if behind or too close to camera
    if (z > -0.1) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    
    // =========================================================================
    // Step 4: Frustum Culling (Approximate)
    // =========================================================================
    float x = p_view.x;
    float y = p_view.y;
    float screenX = x / (-z) * focal.x;
    float screenY = y / (-z) * focal.y;
    float margin = 200.0; // pixels
    
    if (abs(screenX) > viewport.x * 0.5 + margin || 
        abs(screenY) > viewport.y * 0.5 + margin) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    
    // =========================================================================
    // Step 5: Compute 3D Covariance Matrix
    // =========================================================================
    // Covariance Σ = R * S * Sᵀ * Rᵀ = M * Mᵀ where M = R * S
    mat3 R = quatToMat3(rotation);
    mat3 S = mat3(scale.x, 0.0, 0.0, 
                  0.0, scale.y, 0.0, 
                  0.0, 0.0, scale.z);
    mat3 M_local = R * S;
    mat3 Sigma_local = M_local * transpose(M_local);
    
    // =========================================================================
    // Step 6: Project Covariance to View Space
    // =========================================================================
    // Transform covariance: Σ_view = W * Σ_local * Wᵀ
    mat3 W = mat3(modelViewMatrix); // Rotation part only
    mat3 T = W * Sigma_local * transpose(W);
    
    // =========================================================================
    // Step 7: Project to 2D Screen Space Covariance
    // =========================================================================
    // Using simplified Jacobian for perspective projection:
    //   J = | fx/z  0    -fx*x/z² |
    //       | 0     fy/z -fy*y/z² |
    // 
    // For efficiency, we approximate by ignoring off-diagonal terms
    // (valid when splat is small relative to depth)
    
    float z_inv = 1.0 / z;
    float fx_z = focal.x * z_inv;
    float fy_z = focal.y * z_inv;
    
    // 2D covariance elements (only using diagonal approximation)
    // Add small bias (0.3) for anti-aliasing / minimum splat size
    float cov2d_11 = T[0][0] * fx_z * fx_z + 0.3;  // σ_x²
    float cov2d_12 = T[0][1] * fx_z * fy_z;         // σ_xy
    float cov2d_22 = T[1][1] * fy_z * fy_z + 0.3;  // σ_y²
    
    // =========================================================================
    // Step 8: Validate Covariance (Skip Degenerate Cases)
    // =========================================================================
    float det = cov2d_11 * cov2d_22 - cov2d_12 * cov2d_12;
    
    if (det < 0.0001) { // Nearly singular matrix
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    
    // =========================================================================
    // Step 9: Calculate Screen-Space Quad Size
    // =========================================================================
    // Quad radius = 3σ (covers 99.7% of Gaussian)
    // σ = sqrt(eigenvalue) ≈ sqrt(diagonal element for axis-aligned)
    float radius_x = min(ceil(3.0 * sqrt(cov2d_11)), 512.0);
    float radius_y = min(ceil(3.0 * sqrt(cov2d_22)), 512.0);
    
    // Skip tiny splats (sub-pixel)
    if (radius_x < 0.5 && radius_y < 0.5) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    
    // =========================================================================
    // Step 10: Position Quad Vertex
    // =========================================================================
    vec2 center_screen = vec2(screenX, screenY);
    vec2 offset = splatCorner * vec2(radius_x, radius_y);
    vPosition = offset; // Pass to fragment shader
    
    vec2 pos_screen = center_screen + offset;
    
    // Convert screen position to NDC (-1 to 1)
    gl_Position = vec4(pos_screen / viewport * 2.0, 0.0, 1.0);
    
    // Set proper depth for depth testing
    vec4 ndc_center = projectionMatrix * p_view;
    gl_Position.z = ndc_center.z / ndc_center.w;
    gl_Position.w = 1.0;
    
    // =========================================================================
    // Step 11: Compute Conic Parameters for Fragment Shader
    // =========================================================================
    // The inverse covariance (conic) is used to evaluate Gaussian in fragment shader
    // For 2x2 matrix: inverse = [[c, -b], [-b, a]] / det
    float det_inv = 1.0 / det;
    vConic = vec3(cov2d_22 * det_inv,   // a (for x² term)
                  -cov2d_12 * det_inv,  // b (for xy term, negated)
                  cov2d_11 * det_inv);  // c (for y² term)
    
    // =========================================================================
    // Step 12: Pass Color to Fragment Shader
    // =========================================================================
    vColor = colorData;
}
