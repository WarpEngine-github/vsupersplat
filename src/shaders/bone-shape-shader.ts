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
    
    float calcDepth(in vec3 pos, in mat4 viewProjection) {
        vec4 v = viewProjection * vec4(pos, 1.0);
        return (v.z / v.w) * 0.5 + 0.5;
    }
    
    uniform mat4 matrix_viewProjection;
    uniform vec4 sphere;
    uniform vec3 sphereColor;  // Color parameter (RGB)
    uniform float depthOffset;  // Depth offset for render priority (negative = closer/front)
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
        
        // Use provided color with fake shading
        gl_FragColor = vec4(sphereColor * shade, 1.0);
        
        // Write depth with offset (negative offset = render in front)
        float depth = calcDepth(hitPos, matrix_viewProjection);
        gl_FragDepth = clamp(depth + depthOffset, 0.0, 1.0);
    }
`;

export { sphereVertexShader, sphereFragmentShader };

const cylinderVertexShader = /* glsl */ `
    attribute vec3 vertex_position;
    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    void main() {
        gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
    }
`;

const cylinderFragmentShader = /* glsl */ `
    // Ray-cylinder intersection
    // Cylinder defined by startPos, endPos, and radius
    bool intersectCylinder(out float t0, out float t1, vec3 rayPos, vec3 rayDir, vec3 startPos, vec3 endPos, float radius) {
        vec3 axis = endPos - startPos;
        float axisLen = length(axis);
        
        // Handle degenerate case (zero-length cylinder)
        if (axisLen < 0.0001) {
            return false;
        }
        
        vec3 axisDir = axis / axisLen;
        vec3 oc = rayPos - startPos;
        
        // Project ray onto cylinder axis
        float a = dot(rayDir, rayDir) - dot(rayDir, axisDir) * dot(rayDir, axisDir);
        float b = 2.0 * (dot(oc, rayDir) - dot(oc, axisDir) * dot(rayDir, axisDir));
        float c = dot(oc, oc) - dot(oc, axisDir) * dot(oc, axisDir) - radius * radius;
        
        float discriminant = b * b - 4.0 * a * c;
        if (discriminant < 0.0) {
            return false;
        }
        
        float sqrtDisc = sqrt(discriminant);
        t0 = (-b - sqrtDisc) / (2.0 * a);
        t1 = (-b + sqrtDisc) / (2.0 * a);
        
        if (t1 < 0.0) {
            return false;
        }
        
        // Clamp intersections to cylinder length
        vec3 hit0 = rayPos + rayDir * t0;
        vec3 hit1 = rayPos + rayDir * t1;
        
        float proj0 = dot(hit0 - startPos, axisDir);
        float proj1 = dot(hit1 - startPos, axisDir);
        
        // Check if intersections are within cylinder bounds
        bool valid0 = proj0 >= 0.0 && proj0 <= axisLen;
        bool valid1 = proj1 >= 0.0 && proj1 <= axisLen;
        
        if (!valid0 && !valid1) {
            return false;
        }
        
        // Adjust t values if needed
        if (!valid0) {
            t0 = t1;
        }
        if (!valid1) {
            t1 = t0;
        }
        
        return true;
    }
    
    float calcDepth(in vec3 pos, in mat4 viewProjection) {
        vec4 v = viewProjection * vec4(pos, 1.0);
        return (v.z / v.w) * 0.5 + 0.5;
    }
    
    uniform mat4 matrix_viewProjection;
    uniform vec3 startPosition;  // Cylinder start point
    uniform vec3 endPosition;    // Cylinder end point
    uniform float radius;        // Cylinder radius
    uniform vec3 cylinderColor;  // Color parameter (RGB)
    uniform float depthOffset;   // Depth offset for render priority (negative = closer/front)
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
        if (!intersectCylinder(t0, t1, worldNear, rayDir, startPosition, endPosition, radius)) {
            discard;
        }
        
        // Use front intersection point (closest to camera)
        float t = t0 > 0.0 ? t0 : t1;
        vec3 hitPos = worldNear + rayDir * t;
        
        // Calculate normal (perpendicular to cylinder axis, pointing outward)
        vec3 axis = normalize(endPosition - startPosition);
        vec3 toHit = hitPos - startPosition;
        vec3 projOnAxis = axis * dot(toHit, axis);
        vec3 normal = normalize(toHit - projOnAxis);
        
        // Fake lighting like Blender object mode: fixed light direction
        // Light from top-right-front (standard Blender shading)
        vec3 lightDir = normalize(vec3(0.4, 0.8, 0.4));
        float NdotL = dot(normal, lightDir);
        
        // Map from [-1, 1] to [0.3, 1.0] for smooth shading
        // This gives a nice 3D appearance without actual lighting
        float shade = NdotL * 0.5 + 0.5; // [0, 1]
        shade = mix(0.3, 1.0, shade); // [0.3, 1.0]
        
        // Use provided color with fake shading
        gl_FragColor = vec4(cylinderColor * shade, 1.0);
        
        // Write depth with offset (negative offset = render in front)
        float depth = calcDepth(hitPos, matrix_viewProjection);
        gl_FragDepth = clamp(depth + depthOffset, 0.0, 1.0);
    }
`;

export { cylinderVertexShader, cylinderFragmentShader };
