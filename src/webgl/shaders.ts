/**
 * GLSL 着色器源码。
 * 分离片元着色器与 src/core/nnls.ts 的 CPU 实现逐行对应：
 * 加权正规方程 -> 4 个候选活动集 -> 取加权 RSS 最小的可行非负解。
 */

export const FULLSCREEN_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  // 标准左下原点 UV；源图在 texImage 时通过 UNPACK_FLIP_Y_WEBGL 翻转，使图像顶边显示在屏幕上方
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * 分离 Pass。
 * 输入：u_bands 六波段反射率纹理数组（R8），u_paper 纸张反射率，
 *       u_a1/u_a2 两墨水吸光度端元，u_roiCount + u_roiRects/u_roiWeights 区域权重。
 * 输出 MRT：
 *   0 R32F 墨水1 丰度 c1
 *   1 R32F 墨水2 丰度 c2
 *   2 R32F 拟合残差（RMSE）
 *   3 R32F 混合墨量 c1+c2（供显示/阈值）
 */
export const SEPARATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bands[6];
uniform vec4 u_a1[2];   // 6 维吸光度拆成 vec4+vec2（末两分量补 0）
uniform vec4 u_a2[2];
uniform vec4 u_paper[2];
uniform vec4 u_globalW[2];
uniform int u_roiCount;
uniform vec4 u_roiRects[8];   // xy = 左下, zw = 右上（uv 坐标）
uniform vec4 u_roiWeights[16]; // 每个 ROI 6 个权重，占两个 vec4（末两分量补 0）
layout(location=0) out float o_c1;
layout(location=1) out float o_c2;
layout(location=2) out float o_res;
layout(location=3) out float o_total;

float bandVal(int b) {
  if (b == 0) return texture(u_bands[0], v_uv).r;
  if (b == 1) return texture(u_bands[1], v_uv).r;
  if (b == 2) return texture(u_bands[2], v_uv).r;
  if (b == 3) return texture(u_bands[3], v_uv).r;
  if (b == 4) return texture(u_bands[4], v_uv).r;
  return texture(u_bands[5], v_uv).r;
}
float a1v(int b) { return b < 4 ? u_a1[0][b] : u_a1[1][b-4]; }
float a2v(int b) { return b < 4 ? u_a2[0][b] : u_a2[1][b-4]; }
float papv(int b) { return b < 4 ? u_paper[0][b] : u_paper[1][b-4]; }
float wglob(int b) { return b < 4 ? u_globalW[0][b] : u_globalW[1][b-4]; }

void main() {
  // 选取当前像素所在 ROI 的权重（ROI 可重叠时取最后匹配者，与 UI 列表顺序一致）
  float w[6];
  for (int b = 0; b < 6; b++) w[b] = wglob(b);
  for (int r = 0; r < 8; r++) {
    if (r >= u_roiCount) break;
    vec4 rect = u_roiRects[r];
    if (v_uv.x >= rect.x && v_uv.x <= rect.z && v_uv.y >= rect.y && v_uv.y <= rect.w) {
      vec4 w0 = u_roiWeights[r * 2];
      vec4 w1 = u_roiWeights[r * 2 + 1];
      w[0]=w0[0]; w[1]=w0[1]; w[2]=w0[2]; w[3]=w0[3];
      w[4]=w1[0]; w[5]=w1[1];
    }
  }

  // 反射率 -> 相对纸张吸光度
  float y[6];
  for (int b = 0; b < 6; b++) {
    float R = max(bandVal(b), 1e-4);
    y[b] = -log(R / max(papv(b), 1e-4));
  }

  // 加权 Gram 矩阵与内积
  float y1=0.0, y2=0.0, g11=0.0, g22=0.0, g12=0.0;
  for (int b = 0; b < 6; b++) {
    float wb = w[b];
    float v1 = a1v(b);
    float v2 = a2v(b);
    y1 += wb * y[b] * v1;
    y2 += wb * y[b] * v2;
    g11 += wb * v1 * v1;
    g22 += wb * v2 * v2;
    g12 += wb * v1 * v2;
  }
  g11 = max(g11, 1e-12);
  g22 = max(g22, 1e-12);

  // 候选 1：双端元（正规方程），可行才采纳
  float bestC1 = 0.0;
  float bestC2 = 0.0;
  float bestRss = 1e30;
  float det = g11 * g22 - g12 * g12;
  if (abs(det) > 1e-12) {
    float c1 = (y1 * g22 - y2 * g12) / det;
    float c2 = (y2 * g11 - y1 * g12) / det;
    if (c1 >= -1e-9 && c2 >= -1e-9) {
      c1 = max(c1, 0.0);
      c2 = max(c2, 0.0);
      float rss = 0.0;
      for (int b = 0; b < 6; b++) {
        float d = y[b] - c1 * a1v(b) - c2 * a2v(b);
        rss += w[b] * d * d;
      }
      if (rss < bestRss) { bestRss = rss; bestC1 = c1; bestC2 = c2; }
    }
  }
  // 候选 2：仅端元1
  {
    float c1 = max(y1 / g11, 0.0);
    float rss = 0.0;
    for (int b = 0; b < 6; b++) {
      float d = y[b] - c1 * a1v(b);
      rss += w[b] * d * d;
    }
    if (rss < bestRss) { bestRss = rss; bestC1 = c1; bestC2 = 0.0; }
  }
  // 候选 3：仅端元2
  {
    float c2 = max(y2 / g22, 0.0);
    float rss = 0.0;
    for (int b = 0; b < 6; b++) {
      float d = y[b] - c2 * a2v(b);
      rss += w[b] * d * d;
    }
    if (rss < bestRss) { bestRss = rss; bestC1 = 0.0; bestC2 = c2; }
  }
  // 候选 4：零解
  {
    float rss = 0.0;
    for (int b = 0; b < 6; b++) rss += w[b] * y[b] * y[b];
    if (rss < bestRss) { bestRss = rss; bestC1 = 0.0; bestC2 = 0.0; }
  }

  float resAcc = 0.0;
  for (int b = 0; b < 6; b++) {
    float d = y[b] - bestC1 * a1v(b) - bestC2 * a2v(b);
    resAcc += d * d;
  }
  o_c1 = bestC1;
  o_c2 = bestC2;
  o_res = sqrt(resAcc / 6.0);
  o_total = bestC1 + bestC2;
}`;

/**
 * 显示 Pass：把丰度图渲染成可视图。
 * mode: 0=ink1 1=ink2 2=split 3=residual 4=rgb
 */
export const DISPLAY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_c1;
uniform sampler2D u_c2;
uniform sampler2D u_res;
uniform sampler2D u_bands[6];
uniform int u_mode;
uniform float u_gain;     // 丰度显示增益
uniform vec3 u_ink1Color;
uniform vec3 u_ink2Color;
out vec4 o_color;

float bandVal(int b) {
  if (b == 0) return texture(u_bands[0], v_uv).r;
  if (b == 1) return texture(u_bands[1], v_uv).r;
  if (b == 2) return texture(u_bands[2], v_uv).r;
  if (b == 3) return texture(u_bands[3], v_uv).r;
  if (b == 4) return texture(u_bands[4], v_uv).r;
  return texture(u_bands[5], v_uv).r;
}
vec3 paperTone() {
  // 以纸张区为亮底的灰度底纹
  float g = pow(bandVal(2), 0.5);
  return vec3(g);
}

void main() {
  float c1 = texture(u_c1, v_uv).r * u_gain;
  float c2 = texture(u_c2, v_uv).r * u_gain;
  vec3 col;
  if (u_mode == 0) {
    // 单层：白底 + 墨水色，丰度做软阈值抑制纸张区噪色
    float a = smoothstep(0.08, 0.35, c1);
    col = mix(paperTone(), u_ink1Color, a);
  } else if (u_mode == 1) {
    float a = smoothstep(0.08, 0.35, c2);
    col = mix(paperTone(), u_ink2Color, a);
  } else if (u_mode == 2) {
    // 双墨水叠加：深色底上红/青两通道独立发光，交叠处偏白
    vec3 base = paperTone() * 0.22;
    float a1 = smoothstep(0.06, 0.3, c1);
    float a2 = smoothstep(0.06, 0.3, c2);
    col = base + u_ink1Color * a1 + u_ink2Color * a2;
  } else if (u_mode == 3) {
    float r = clamp(texture(u_res, v_uv).r * 3.0, 0.0, 1.0);
    col = mix(vec3(0.02), vec3(1.0, 0.4, 0.0), r);
  } else {
    col = vec3(pow(bandVal(4), 0.7), pow(bandVal(3), 0.7), pow(bandVal(2), 0.7));
  }
  o_color = vec4(col, 1.0);
}`;
