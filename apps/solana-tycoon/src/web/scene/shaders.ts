// One full-screen pass: match each low-res pixel to the nearest base palette color (4x4 Bayer
// dithering), output that index's tier-tinted color, then CRT treatment (barrel curvature,
// scanlines, vignette, chromatic offset). Matching on the base palette keeps the room's structure
// in every tier; only the colors shift.
export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uBase[16];
uniform vec3 uPal[16];
uniform vec2 uLow;
uniform float uChroma;
uniform vec2 uShake;
uniform float uCurve;
varying vec2 vUv;

float bayer2(vec2 a) {
	a = floor(a);
	return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
	return bayer2(0.5 * a) * 0.25 + bayer2(a);
}
vec3 quantize(vec3 color, vec2 cell) {
	color += (bayer4(cell) - 0.5) * 0.06;
	float best = 1e9;
	vec3 chosen = uPal[0];
	for (int i = 0; i < 16; i++) {
		vec3 delta = color - uBase[i];
		float distance = dot(delta * delta, vec3(0.3, 0.59, 0.11));
		if (distance < best) {
			best = distance;
			chosen = uPal[i];
		}
	}
	return chosen;
}
vec3 sampleLow(vec2 px) {
	px = clamp(px, vec2(0.5), uLow - 0.5);
	return texture2D(tDiffuse, px / uLow).rgb;
}
void main() {
	vec2 centered = vUv * 2.0 - 1.0;
	centered *= 1.0 + uCurve * dot(centered, centered);
	vec2 uv = centered * 0.5 + 0.5;
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		gl_FragColor = vec4(0.01, 0.012, 0.024, 1.0);
		return;
	}
	vec2 cell = floor(uv * uLow);
	vec2 px = cell + 0.5 + uShake;
	vec3 color = quantize(sampleLow(px), cell);
	if (uChroma > 0.0) {
		vec3 red = quantize(sampleLow(px + vec2(uChroma, 0.0)), cell);
		vec3 blue = quantize(sampleLow(px - vec2(uChroma, 0.0)), cell);
		color = vec3(red.r, color.g, blue.b);
	}
	float line = fract(uv.y * uLow.y);
	color *= 0.8 + 0.2 * smoothstep(0.0, 0.35, line) * smoothstep(1.0, 0.65, line);
	vec2 edge = vUv * (1.0 - vUv.yx);
	color *= clamp(pow(edge.x * edge.y * 18.0, 0.18), 0.0, 1.0);
	gl_FragColor = vec4(color, 1.0);
}
`;
