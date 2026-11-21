/**
 * WebGL2 分离引擎。
 * 职责：六波段纹理上传、NNLS 分离 Pass（MRT 输出丰度/残差）、显示 Pass、GPU 计时、结果回读。
 * 所有数学与 src/core/nnls.ts 的 CPU 参考实现一致。
 */
import type { BandWeights, Roi, Vec6 } from '../core/types';
import { BAND_COUNT } from '../core/bands';
import { DISPLAY_FS, FULLSCREEN_VS, SEPARATE_FS } from './shaders';
import { floatToHalf } from './floatHalf';
import type { GrayImage } from '../core/raster';

const MAX_ROI = 8;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('程序链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function packVec6(v: Vec6): Float32Array {
  return new Float32Array([v[0], v[1], v[2], v[3], v[4], v[5], 0, 0]);
}

export interface SeparateParams {
  a1: Vec6;
  a2: Vec6;
  paper: Vec6;
  globalWeights: BandWeights;
  rois: Roi[];
}

export interface GpuMaps {
  c1: Float32Array;
  c2: Float32Array;
  residual: Float32Array;
  width: number;
  height: number;
}

export class SeparationEngine {
  readonly gl: WebGL2RenderingContext;
  private sepProgram: WebGLProgram;
  private dispProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private bandTex: WebGLTexture[] = [];
  private outTex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('当前环境不支持 WebGL2');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('缺少 EXT_color_buffer_float，无法渲染浮点纹理');
    }

    this.sepProgram = link(gl, FULLSCREEN_VS, SEPARATE_FS);
    this.dispProgram = link(gl, FULLSCREEN_VS, DISPLAY_FS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.fbo = gl.createFramebuffer()!;
    for (let i = 0; i < BAND_COUNT; i++) this.bandTex.push(this.createBandTexture());
    for (let i = 0; i < 4; i++) this.outTex.push(this.createR32FTexture());
  }

  private createBandTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private createR32FTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    // R32F 在 WebGL2 核心中不可线性过滤（OES_texture_float_linear 才支持），必须 NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** 上传六波段灰度图（反射率 0..1），尺寸变化时重建输出纹理 */
  uploadBands(bands: GrayImage[]): void {
    const gl = this.gl;
    const w = bands[0]!.width;
    const h = bands[0]!.height;
    const resized = w !== this.width || h !== this.height;
    this.width = w;
    this.height = h;

    for (let b = 0; b < BAND_COUNT; b++) {
      const img = bands[b]!;
      const half = new Uint16Array(img.data.length);
      for (let i = 0; i < img.data.length; i++) {
        const v = Math.min(1, Math.max(0, img.data[i]!));
        half[i] = floatToHalf(v);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.bandTex[b]!);
      // 源数组首行为图像顶边，翻到 GL 纹理坐标（底边为 v=0），配合标准左下 UV
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, half);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    if (resized) {
      for (const t of this.outTex) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
      }
    }
  }

  private setVec6Uniform(loc: WebGLUniformLocation | null, v: Vec6): void {
    this.gl.uniform4fv(loc, packVec6(v));
  }

  /** 执行分离，返回 GPU 耗时 ms；丰度图留在输出纹理中 */
  separate(params: SeparateParams): number {
    const gl = this.gl;
    const t0 = performance.now();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex[0]!, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.outTex[1]!, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.outTex[2]!, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, this.outTex[3]!, 0);
    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      gl.COLOR_ATTACHMENT3,
    ]);
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(this.sepProgram);
    gl.bindVertexArray(this.vao);

    for (let b = 0; b < BAND_COUNT; b++) {
      gl.activeTexture(gl.TEXTURE0 + b);
      gl.bindTexture(gl.TEXTURE_2D, this.bandTex[b]!);
      gl.uniform1i(gl.getUniformLocation(this.sepProgram, `u_bands[${b}]`), b);
    }
    this.setVec6Uniform(gl.getUniformLocation(this.sepProgram, 'u_a1'), params.a1);
    this.setVec6Uniform(gl.getUniformLocation(this.sepProgram, 'u_a2'), params.a2);
    this.setVec6Uniform(gl.getUniformLocation(this.sepProgram, 'u_paper'), params.paper);
    this.setVec6Uniform(gl.getUniformLocation(this.sepProgram, 'u_globalW'), params.globalWeights);

    // ROI uniforms（最多 8 个）
    const rects = new Float32Array(MAX_ROI * 4);
    const weights = new Float32Array(MAX_ROI * 8);
    const visibleRois = params.rois.filter((r) => r.visible).slice(0, MAX_ROI);
    visibleRois.forEach((r, i) => {
      // ROI 按上=0 存储；GL uv 下=0，y 取 1-y
      const top = Math.min(r.y0, r.y1);
      const bottom = Math.max(r.y0, r.y1);
      rects[i * 4] = Math.min(r.x0, r.x1);
      rects[i * 4 + 1] = 1 - bottom;
      rects[i * 4 + 2] = Math.max(r.x0, r.x1);
      rects[i * 4 + 3] = 1 - top;
      for (let b = 0; b < 6; b++) weights[i * 8 + b] = r.weights[b]!;
    });
    gl.uniform1i(gl.getUniformLocation(this.sepProgram, 'u_roiCount'), visibleRois.length);
    gl.uniform4fv(gl.getUniformLocation(this.sepProgram, 'u_roiRects[0]'), rects);
    gl.uniform4fv(gl.getUniformLocation(this.sepProgram, 'u_roiWeights[0]'), weights);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
    return performance.now() - t0;
  }

  /** 显示 Pass，结果渲染到 canvas（或传入的 framebuffer） */
  renderDisplay(opts: {
    mode: number;
    gain: number;
    ink1Color: [number, number, number];
    ink2Color: [number, number, number];
  }): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(this.dispProgram);
    gl.bindVertexArray(this.vao);

    const bind = (sampler: string, tex: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(this.dispProgram, sampler), unit);
    };
    bind('u_c1', this.outTex[0]!, 0);
    bind('u_c2', this.outTex[1]!, 1);
    bind('u_res', this.outTex[2]!, 2);
    for (let b = 0; b < BAND_COUNT; b++) {
      gl.activeTexture(gl.TEXTURE0 + 3 + b);
      gl.bindTexture(gl.TEXTURE_2D, this.bandTex[b]!);
      gl.uniform1i(gl.getUniformLocation(this.dispProgram, `u_bands[${b}]`), 3 + b);
    }
    gl.uniform1i(gl.getUniformLocation(this.dispProgram, 'u_mode'), opts.mode);
    gl.uniform1f(gl.getUniformLocation(this.dispProgram, 'u_gain'), opts.gain);
    gl.uniform3fv(gl.getUniformLocation(this.dispProgram, 'u_ink1Color'), opts.ink1Color);
    gl.uniform3fv(gl.getUniformLocation(this.dispProgram, 'u_ink2Color'), opts.ink2Color);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 回读丰度图（用于评测/导出）；输出已按图像顶行在前排列，结束恢复默认帧缓冲 */
  readMaps(): GpuMaps {
    const gl = this.gl;
    const n = this.width * this.height;
    const read = (attachment: number): Float32Array => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.readBuffer(attachment);
      const buf = new Float32Array(n);
      gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.FLOAT, buf);
      // readPixels 按 GL 行序（底行在前），翻回图像行序（顶行在前）以对齐 CPU/掩膜
      const out = new Float32Array(n);
      const row = this.width;
      for (let y = 0; y < this.height; y++) {
        out.set(buf.subarray(y * row, (y + 1) * row), (this.height - 1 - y) * row);
      }
      return out;
    };
    const maps = {
      c1: read(gl.COLOR_ATTACHMENT0),
      c2: read(gl.COLOR_ATTACHMENT1),
      residual: read(gl.COLOR_ATTACHMENT2),
      width: this.width,
      height: this.height,
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readBuffer(gl.BACK);
    return maps;
  }

  get dimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  dispose(): void {
    const gl = this.gl;
    this.bandTex.forEach((t) => gl.deleteTexture(t));
    this.outTex.forEach((t) => gl.deleteTexture(t));
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.sepProgram);
    gl.deleteProgram(this.dispProgram);
    gl.deleteVertexArray(this.vao);
  }
}
