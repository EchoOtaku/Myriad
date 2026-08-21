import type { CompanionRigManifest } from './types'
import { RIG_MATRIX_CAPACITY } from './contract'

export interface GpuPart {
  id: string
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  texture: WebGLTexture
  indexCount: number
  opacity: number
  zIndex: number
  stableIndex: number
  slot?: string
  variant?: string
}

export interface ShaderLocations {
  fit: WebGLUniformLocation
  bones: WebGLUniformLocation
  opacity: WebGLUniformLocation
  alphaCutoff: WebGLUniformLocation
  texture: WebGLUniformLocation
}

const FLOATS_PER_VERTEX = 12
// Reserve crop-safe room for head/torso overshoot and hair follow-through.
// The upper-body source stays bottom-aligned so breathing does not make it float.
const MOTION_FRAME_SCALE = 0.9

export const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_uv;
in vec4 a_joints;
in vec4 a_weights;
uniform mat3 u_bones[${RIG_MATRIX_CAPACITY}];
uniform vec4 u_fit;
out vec2 v_uv;
void main() {
  mat3 skin =
    u_bones[int(a_joints.x)] * a_weights.x +
    u_bones[int(a_joints.y)] * a_weights.y +
    u_bones[int(a_joints.z)] * a_weights.z +
    u_bones[int(a_joints.w)] * a_weights.w;
  vec2 model = (skin * vec3(a_position, 1.0)).xy;
  vec2 fitted = model * u_fit.xy + u_fit.zw;
  gl_Position = vec4(fitted.x * 2.0 - 1.0, 1.0 - fitted.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
}`

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_alpha_cutoff;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec4 color = texture(u_texture, v_uv);
  if (color.a < u_alpha_cutoff) discard;
  out_color = vec4(color.rgb, color.a * u_opacity);
}`

export function computeRigFit(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Float32Array {
  const output = new Float32Array(4)
  writeRigFit(output, viewportWidth, viewportHeight, canvasWidth, canvasHeight)
  return output
}

export function writeRigFit(
  output: Float32Array,
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const viewportAspect = viewportWidth / viewportHeight
  const contentAspect = canvasWidth / canvasHeight
  if (viewportAspect > contentAspect) {
    const width = contentAspect / viewportAspect
    output[0] = width / canvasWidth
    output[1] = 1 / canvasHeight
    output[2] = (1 - width) / 2
    output[3] = 0
  } else {
    const height = viewportAspect / contentAspect
    output[0] = 1 / canvasWidth
    output[1] = height / canvasHeight
    output[2] = 0
    output[3] = 1 - height
  }
  output[0] *= MOTION_FRAME_SCALE
  output[1] *= MOTION_FRAME_SCALE
  output[2] = (1 - output[0] * canvasWidth) / 2
  output[3] = 1 - output[1] * canvasHeight
}

export function createGpuPart(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  part: CompanionRigManifest['parts'][number],
  texture: WebGLTexture,
  stableIndex: number,
  renderDepth = part.zIndex,
): GpuPart {
  const vao = gl.createVertexArray()
  const vertexBuffer = gl.createBuffer()
  const indexBuffer = gl.createBuffer()
  if (!vao || !vertexBuffer || !indexBuffer) {
    throw new Error('Could not allocate rig GPU buffers')
  }
  const vertices = new Float32Array(part.vertices.length * FLOATS_PER_VERTEX)
  part.vertices.forEach((vertex, index) => {
    const offset = index * FLOATS_PER_VERTEX
    vertices.set(
      [
        vertex.position.x,
        vertex.position.y,
        vertex.uv.x,
        vertex.uv.y,
        ...vertex.joints,
        ...vertex.weights,
      ],
      offset,
    )
  })
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(part.indices),
    gl.STATIC_DRAW,
  )
  const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT
  enableAttribute(gl, program, 'a_position', 2, stride, 0)
  enableAttribute(gl, program, 'a_uv', 2, stride, 2 * 4)
  enableAttribute(gl, program, 'a_joints', 4, stride, 4 * 4)
  enableAttribute(gl, program, 'a_weights', 4, stride, 8 * 4)
  gl.bindVertexArray(null)
  return {
    id: part.id,
    vao,
    vertexBuffer,
    indexBuffer,
    texture,
    indexCount: part.indices.length,
    opacity: part.opacity,
    zIndex: renderDepth,
    stableIndex,
    slot: part.slot,
    variant: part.variant,
  }
}

export async function loadTexture(
  gl: WebGL2RenderingContext,
  url: string,
): Promise<WebGLTexture> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const texture = gl.createTexture()
  if (!texture) throw new Error('Could not allocate rig texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  return texture
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Could not allocate rig shader program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message =
      gl.getProgramInfoLog(program) || 'Unknown rig shader link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`Missing rig shader uniform: ${name}`)
  return location
}

function enableAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  size: number,
  stride: number,
  offset: number,
): void {
  const location = gl.getAttribLocation(program, name)
  if (location < 0) throw new Error(`Missing rig shader attribute: ${name}`)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset)
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not allocate rig shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) || 'Unknown rig shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}
