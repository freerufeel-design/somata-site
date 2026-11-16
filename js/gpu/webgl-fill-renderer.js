// WebGL: заливка.
import '../render/lamp-color.js'; // initialisation order: this module runs after it
import { normalizedFillGlCanvas } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { GPUColorCache } from './gpu-utils.js';

const FillWebGLRenderer = (() => {
  let gl = null,
    program = null,
    vao = null,
    vbo = null,
    texture = null,
    maskUniform = null,
    fillUniform = null;
  let attempted = false,
    available = false,
    lost = false,
    lastError = '',
    width = 0,
    height = 0;
  const canvas = normalizedFillGlCanvas;
  const VERT = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 aPos;
                layout(location=1) in vec2 aUv;
                out vec2 vUv;
                void main(){gl_Position=vec4(aPos,0.0,1.0);vUv=aUv;}`;
  const FRAG = `#version 300 es
                precision highp float;
                uniform sampler2D uMask;
                uniform vec4 uFill;
                in vec2 vUv;
                out vec4 outColor;
                void main(){
                    float cov=clamp(texture(uMask,vUv).a,0.0,1.0);
                    float a=clamp(uFill.a*cov,0.0,1.0);
                    outColor=vec4(uFill.rgb*a,a);
                }`;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || 'fill shader compile');
    return sh;
  }
  function init() {
    if (available && !lost) return true;
    if (attempted && !available) return false;
    attempted = true;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        depth: false,
        stencil: false,
      });
      if (!gl) throw new Error('WebGL2 не поддерживается');
      const vs = compile(gl.VERTEX_SHADER, VERT),
        fs = compile(gl.FRAGMENT_SHADER, FRAG);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || 'fill program link');
      maskUniform = gl.getUniformLocation(program, 'uMask');
      fillUniform = gl.getUniformLocation(program, 'uFill');
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.bindVertexArray(null);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      canvas.addEventListener(
        'webglcontextlost',
        (e) => {
          e.preventDefault();
          lost = true;
          available = false;
          lastError = 'context lost';
        },
        { passive: false },
      );
      canvas.addEventListener('webglcontextrestored', () => {
        attempted = false;
        available = false;
        lost = false;
        gl = null;
        width = height = 0;
        init();
        requestMainCanvasRender();
      });
      available = true;
      lastError = '';
      return true;
    } catch (err) {
      available = false;
      lastError = String(err?.message || err);
      console.warn('WebGL fill disabled:', err);
      return false;
    }
  }
  function ensureSize(w, h) {
    if (!init()) return false;
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (width === w && height === h && canvas.width === w && canvas.height === h) return true;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  function parseFill(style) {
    return GPUColorCache.rgba(style || '#ffffff');
  }
  function render(mask, fillStyle, targetCtx) {
    if (!mask || !targetCtx || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    const c = parseFill(fillStyle);
    if (c[3] <= 0.00001) return true;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
      gl.uniform1i(maskUniform, 0);
      gl.uniform4f(fillUniform, c[0], c[1], c[2], c[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
      const err = gl.getError();
      if (err !== gl.NO_ERROR) {
        lastError = `GL error ${err}`;
        return false;
      }
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(canvas, 0, 0);
      targetCtx.restore();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function clear() {
    if (gl && canvas) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  function status() {
    return { available: init(), lastError, width, height };
  }
  return { render, clear, status, isAvailable: () => init() };
})();

export { FillWebGLRenderer };
