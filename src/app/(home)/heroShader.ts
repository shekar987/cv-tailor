// The hero's backdrop, drawn by HeroCanvas.tsx: a dark desk with a faint
// stretched fibre, and the lamp — one warm light, upper-left, inverse-square
// falloff with a soft cone, breathing by a few per cent. No textures, no
// imports: value noise from a hash. Every colour arrives as a uniform read
// from the CSS tokens (lib/landing/heroPalette), so the canvas stays on the
// palette.
//
// `#version 300 es` must be the first characters of each string.

export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_desk;
uniform vec3 u_amber;
uniform vec3 u_amberHi;
uniform vec2 u_lamp;
uniform float u_grain;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 lamp = vec2(u_lamp.x * aspect, u_lamp.y);

  // The desk: a matte surface with a faint fibre, stretched along the grain.
  float fibre = fbm(vec2(p.x * 160.0, p.y * 28.0));
  vec3 col = u_desk * (0.86 + 0.28 * fibre);

  // The lamp.
  float dist = distance(p, lamp);
  float breathe = 1.0 + 0.04 * sin(u_time * 0.45);
  float light = breathe / (1.0 + 8.0 * dist * dist) * smoothstep(0.95, 0.0, dist);
  vec3 lampCol = mix(u_amber, u_amberHi, 0.35);
  col = col * (0.7 + 0.6 * light) + lampCol * light * 0.18;

  // Grain, then the fade into the page at the bottom edge.
  col += (hash(gl_FragCoord.xy + fract(u_time) * 7.0) - 0.5) * u_grain;
  col = mix(col, u_bg, smoothstep(0.16, 0.0, uv.y));
  outColor = vec4(col, 1.0);
}`;
