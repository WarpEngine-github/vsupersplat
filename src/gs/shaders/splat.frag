/**
 * =============================================================================
 * Gaussian Splat Fragment Shader
 * =============================================================================
 * 
 * PURPOSE:
 * Evaluate 2D Gaussian function for each pixel and output blended color.
 * 
 * ALGORITHM:
 * 
 *   For each pixel in the quad:
 *   1. Calculate distance from quad center (vPosition)
 *   2. Evaluate 2D Gaussian using conic parameters
 *   3. Compute alpha from Gaussian value and splat opacity
 *   4. Output premultiplied alpha color for blending
 * 
 * 2D GAUSSIAN EVALUATION:
 * 
 *   G(x,y) = exp(-0.5 * [x,y] * Σ⁻¹ * [x,y]ᵀ)
 *          = exp(-0.5 * (a*x² + 2*b*x*y + c*y²))
 *   
 *   Where Σ⁻¹ (inverse covariance / conic) is:
 *     | a  b |
 *     | b  c |
 *   
 *   Passed from vertex shader as vConic = (a, b, c)
 *   
 * ALPHA BLENDING:
 * 
 *   Splats are rendered back-to-front with alpha blending:
 *   
 *   C_out = α * C_splat + (1-α) * C_background
 *   
 *   Using premultiplied alpha:
 *   gl_FragColor = vec4(rgb * alpha, alpha)
 */

precision highp float;

// =============================================================================
// Varyings from Vertex Shader
// =============================================================================

/** RGBA color from texture (A = opacity) */
varying vec4 vColor;

/** Position within quad relative to center (in pixels) */
varying vec2 vPosition;

/** Conic (inverse covariance) parameters: (a, b, c) */
varying vec3 vConic;

// =============================================================================
// Main Fragment Shader
// =============================================================================

void main() {
    // =========================================================================
    // Step 1: Early Distance Culling
    // =========================================================================
    // If pixel is beyond 3σ radius, discard immediately.
    // This matches the quad size calculation in vertex shader.
    float distSq = vPosition.x * vPosition.x + vPosition.y * vPosition.y;
    
    if (distSq > 9.0) { // Beyond 3σ (9 = 3²)
        discard;
    }
    
    // =========================================================================
    // Step 2: Evaluate 2D Gaussian
    // =========================================================================
    // Gaussian exponent: power = -0.5 * (ax² + 2bxy + cy²)
    // Using conic parameters from vertex shader
    float power = -0.5 * (
        vConic.x * vPosition.x * vPosition.x +  // a * x²
        vConic.z * vPosition.y * vPosition.y    // c * y²
    ) - vConic.y * vPosition.x * vPosition.y;   // b * xy (note: vConic.y is -b)
    
    // =========================================================================
    // Step 3: Early Exit for Negligible Contributions
    // =========================================================================
    // exp(-4.5) ≈ 0.011, below visible threshold
    if (power < -4.5) {
        discard;
    }
    
    // =========================================================================
    // Step 4: Calculate Alpha
    // =========================================================================
    // Alpha = Gaussian falloff × splat opacity
    float alpha = exp(power) * vColor.a;
    
    // Skip nearly transparent fragments (< 1/255)
    if (alpha < 0.004) {
        discard;
    }
    
    // =========================================================================
    // Step 5: Output Premultiplied Alpha Color
    // =========================================================================
    // Premultiplied alpha format works better with standard blending:
    // gl_FragColor.rgb = color * alpha
    // gl_FragColor.a = alpha
    // 
    // Blend equation: src.rgb + dst.rgb * (1 - src.a)
    gl_FragColor = vec4(vColor.rgb * alpha, alpha);
}
