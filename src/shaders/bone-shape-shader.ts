const sphereVertexShader = /* glsl */ `
    attribute vec3 vertex_position;
    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    void main() {
        gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
    }
`;

const sphereFragmentShader = /* glsl */ `
    bool intersectSphere(out float t0, out float t1, vec3 pos, vec3 dir, vec4 sphere) {
        vec3 L = sphere.xyz - pos;
        float tca = dot(L, dir);
        float d2 = sphere.w * sphere.w - (dot(L, L) - tca * tca);
        if (d2 <= 0.0) return false;
        float thc = sqrt(d2);
        t0 = tca - thc;
        t1 = tca + thc;
        if (t1 <= 0.0) return false;
        return true;
    }
    uniform mat4 matrix_viewProjection;
    uniform vec4 sphere;
    uniform vec3 near_origin;
    uniform vec3 near_x;
    uniform vec3 near_y;
    uniform vec3 far_origin;
    uniform vec3 far_x;
    uniform vec3 far_y;
    uniform vec2 targetSize;
    void main() {
        vec2 clip = gl_FragCoord.xy / targetSize;
        vec3 worldNear = near_origin + near_x * clip.x + near_y * clip.y;
        vec3 worldFar = far_origin + far_x * clip.x + far_y * clip.y;
        vec3 rayDir = normalize(worldFar - worldNear);
        float t0, t1;
        if (!intersectSphere(t0, t1, worldNear, rayDir, sphere)) {
            discard;
        }
        
        // Use front intersection point (closest to camera)
        float t = t0 > 0.0 ? t0 : t1;
        vec3 hitPos = worldNear + rayDir * t;
        
        // Calculate normal (from sphere center to hit point)
        vec3 normal = normalize(hitPos - sphere.xyz);
        
        // Fake lighting like Blender object mode: fixed light direction
        // Light from top-right-front (standard Blender shading)
        vec3 lightDir = normalize(vec3(0.4, 0.8, 0.4));
        float NdotL = dot(normal, lightDir);
        
        // Map from [-1, 1] to [0.3, 1.0] for smooth shading
        // This gives a nice 3D appearance without actual lighting
        float shade = NdotL * 0.5 + 0.5; // [0, 1]
        shade = mix(0.3, 1.0, shade); // [0.3, 1.0]
        
        // Base blue color with fake shading
        vec3 baseColor = vec3(0.0, 0.5, 1.0);
        gl_FragColor = vec4(baseColor * shade, 1.0);
    }
`;

export { sphereVertexShader, sphereFragmentShader };
