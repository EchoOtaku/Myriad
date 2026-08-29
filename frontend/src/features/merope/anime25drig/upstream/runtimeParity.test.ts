import type {
  UpstreamRig,
  UpstreamRuntimeBoundLayer,
  UpstreamRuntimeDrawCommand,
  UpstreamRuntimeExpression,
  UpstreamRuntimeFrame,
  UpstreamRuntimeLayer,
  UpstreamRuntimeParameters,
  UpstreamRuntimeTickAutomation,
} from './types'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { ANIME25D_VENDOR_SHA256 } from './revision'
import { baseName } from './rigger'
import {
  bindUpstreamRuntimeRig,
  createUpstreamRuntimeTickState,
  deformUpstreamRuntimeLayer,
  planUpstreamRuntimeDraw,
  stepUpstreamRuntimeTick,
  UPSTREAM_RUNTIME_DEFAULTS,
  upstreamRuntimeFadeAlpha,
} from './runtime'

interface RuntimeOracle {
  fadeAlpha: (
    layer: Pick<UpstreamRuntimeLayer, 'fade' | 'side'>,
    expression: UpstreamRuntimeExpression,
  ) => number
  deform: (
    layer: UpstreamRuntimeLayer,
    expression: UpstreamRuntimeExpression,
  ) => void
}

interface TickOracleSnapshot {
  lastTimeMs: number
  blinkElapsed: number
  nextBlinkAtMs: number
  cameraPhysicsScale: number
  current: UpstreamRuntimeParameters
  expression: UpstreamRuntimeExpression
  bounce: { x: number; v: number; dy: number }
  springs: Array<UpstreamRuntimeLayer['spr']>
}

interface TickOracle {
  step: (nowMs: number) => TickOracleSnapshot
}

interface BindingLayerSnapshot {
  name: string
  bn: string
  group: string
  side: string | null
  fade: string | null
  x: number
  y: number
  w: number
  h: number
  z: number
  depth: number
  phys: string | null
  synthetic?: true
  strands: UpstreamRuntimeLayer['strands']
  base: number[]
  cur: number[]
  uv: number[]
  indices: number[]
  nIdx: number
  sw?: number[]
  su?: number[]
  spr?: UpstreamRuntimeLayer['spr']
  bw?: number[]
}

interface BindingOracleSnapshot {
  canvas: { w: number; h: number }
  anchors: UpstreamRig['anchors']
  faceScale: number
  neckPivot: { cx: number; cy: number }
  bodyPivot: { cx: number; cy: number }
  faceCenter: { x: number; y: number }
  chest: { cx: number; cy: number; rx: number; ry: number }
  layers: BindingLayerSnapshot[]
}

interface DrawOracleSnapshot {
  expression: UpstreamRuntimeExpression
  commands: UpstreamRuntimeDrawCommand[]
}

const RUNTIME_URL = new URL('../vendor/index.html', import.meta.url)

const FRAME: UpstreamRuntimeFrame = {
  anchors: {
    face: { cx: 128, cy: 126, x0: 54, x1: 202, y0: 28, y1: 244 },
    eyeL: {
      x0: 73,
      x1: 111,
      y0: 88,
      y1: 115,
      icx: 92,
      icy: 102,
      closeY: 103,
    },
    eyeR: {
      x0: 145,
      x1: 184,
      y0: 86,
      y1: 114,
      icx: 164,
      icy: 101,
      closeY: 102,
    },
    mouth: { x0: 101, x1: 157, y0: 157, y1: 184, cx: 129, cy: 170 },
    neckPivot: { cx: 128, cy: 220 },
    neckTop: 195,
    neckBottom: 263,
    bodyPivot: { cx: 128, cy: 330 },
    faceScale: 0.83,
    hairRootY: 37,
  },
  faceScale: 0.83,
  neckPivot: { cx: 128, cy: 220 },
  bodyPivot: { cx: 128, cy: 330 },
  faceCenter: { x: 128, y: 126 },
  chest: { cx: 128, cy: 252, rx: 78, ry: 62 },
  physicsEnabled: true,
  bustDisplacement: -1.7,
}

const BASE_EXPRESSION: UpstreamRuntimeExpression = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeX: 0,
  eyeY: 0,
  brow: 0,
  mouthOpen: 0,
  mouthForm: 0,
  mouthCY: 0,
  body: 0,
  physAmp: 2,
  soft: 2,
  browAngL: 0,
  browAngR: 0,
  browAngSym: 0,
  bangL: 0,
  bangC: 0,
  bangR: 0,
  armY: 0,
  armPos: 0,
  bust: 2.5,
  bustY: 1,
  irisScale: 1,
  mouthEase: 0.45,
  eyeEase: 0.3,
  fhAmp: 2,
  fhSoft: 0.4,
  eyeCY: 0,
  eyeCAng: 0,
  mouthCAng: 0,
  eyeScaleL: 1,
  eyeScaleR: 1,
  mouthScale: 1,
  breath: 0,
  breathHead: 0,
}

test('pins the exact upstream WebGL runtime document', async () => {
  const source = await readFile(RUNTIME_URL)
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    ANIME25D_VENDOR_SHA256.runtime,
  )
})

test('TypeScript mesh binding matches upstream applyRig uploads and state', async () => {
  for (const canvasWidth of [320, 1_152]) {
    const rig = bindingRig(canvasWidth)
    const expected = await loadBindingOracle(rig)
    const actual = plainBindingSnapshot(bindUpstreamRuntimeRig(rig))
    assert.deepEqual(actual, expected, `binding mismatch at canvas width ${canvasWidth}`)
  }
})

test('TypeScript draw plan preserves upstream eye stencil order and hidden whites', async () => {
  const layers = drawLayers()
  const oracle = await loadDrawOracle(layers)
  assert.deepEqual(
    planUpstreamRuntimeDraw(layers, oracle.expression),
    oracle.commands,
  )
  assert.deepEqual(
    oracle.commands.map(({ name, stencil }) => [name, stencil]),
    [
      ['eyewhite_l', 'write'],
      ['face', 'none'],
      ['eyewhite_r', 'write'],
      ['irides_r', 'test'],
      ['mouth_close', 'none'],
    ],
  )
})

test('TypeScript fade thresholds match the runtime oracle frame by frame', async () => {
  const oracle = await loadRuntimeOracle(FRAME)
  const layers: Array<Pick<UpstreamRuntimeLayer, 'fade' | 'side'>> = [
    { fade: null, side: null },
    { fade: 'eyeOpen', side: 'L' },
    { fade: 'eyeOpen', side: 'R' },
    { fade: 'eyeClose', side: 'L' },
    { fade: 'eyeClose', side: 'R' },
    { fade: 'mouthOpen', side: null },
    { fade: 'mouthClose', side: null },
  ]
  for (let frame = 0; frame <= 120; frame += 1) {
    const expression = runtimeExpression(frame)
    for (const layer of layers) {
      assert.equal(
        upstreamRuntimeFadeAlpha(layer, expression),
        oracle.fadeAlpha(layer, expression),
        `fade mismatch at frame ${frame} for ${layer.fade}`,
      )
    }
  }
})

test('TypeScript vertex deformation matches the runtime oracle frame by frame', async () => {
  const oracle = await loadRuntimeOracle(FRAME)
  const fixtures = runtimeLayers()
  for (let frame = 0; frame <= 120; frame += 1) {
    const expression = runtimeExpression(frame)
    for (const fixture of fixtures) {
      const expected = cloneRuntimeLayer(fixture)
      const actual = cloneRuntimeLayer(fixture)
      applySpringFrame(expected, frame)
      applySpringFrame(actual, frame)
      oracle.deform(expected, expression)
      deformUpstreamRuntimeLayer(actual, expression, FRAME)
      assert.deepEqual(
        actual.cur,
        expected.cur,
        `deformation mismatch at frame ${frame} for ${fixture.name}`,
      )
    }
  }
})

test('disabled physics matches the oracle without strand displacement', async () => {
  const frame = { ...FRAME, physicsEnabled: false }
  const oracle = await loadRuntimeOracle(frame)
  const fixture = runtimeLayers().find((layer) => layer.bn === 'front hair')!
  const expression = runtimeExpression(57)
  const expected = cloneRuntimeLayer(fixture)
  const actual = cloneRuntimeLayer(fixture)
  applySpringFrame(expected, 57)
  applySpringFrame(actual, 57)
  oracle.deform(expected, expression)
  deformUpstreamRuntimeLayer(actual, expression, frame)
  assert.deepEqual(actual.cur, expected.cur)
})

test('TypeScript tick state matches blink, smoothing, breath, and springs', async () => {
  const automation: UpstreamRuntimeTickAutomation = { idle: true, blink: true }
  const target: UpstreamRuntimeParameters = { ...UPSTREAM_RUNTIME_DEFAULTS }
  const expectedLayers = [hairLayer()]
  const actualLayers = expectedLayers.map(cloneRuntimeLayer)
  const expectedRandom = sequenceRandom([0.35, 0.1, 0.72, 0.64])
  const actualRandom = sequenceRandom([0.35, 0.1, 0.72, 0.64])
  const oracle = await loadTickOracle({
    target,
    automation,
    layers: expectedLayers,
    frame: FRAME,
    cameraLive: false,
    random: expectedRandom,
  })
  const state = createUpstreamRuntimeTickState(0)

  for (let frame = 1; frame <= 300; frame += 1) {
    target.angleX = Math.sin(frame * 0.021) * 0.63
    target.angleY = Math.cos(frame * 0.017) * 0.51
    target.angleZ = Math.sin(frame * 0.013 + 0.4) * 0.48
    target.body = Math.cos(frame * 0.011) * 0.42
    target.mouthOpen = 0.5 + Math.sin(frame * 0.08) * 0.45
    target.physAmp = 1.4 + Math.sin(frame * 0.019) * 0.8
    target.soft = 1.3 + Math.cos(frame * 0.016) * 0.7
    target.fhAmp = 1.2 + Math.sin(frame * 0.023) * 0.6
    target.fhSoft = 0.7 + Math.cos(frame * 0.018) * 0.3
    const nowMs = (frame * 1_000) / 60
    const expected = oracle.step(nowMs)
    const expression = stepUpstreamRuntimeTick(state, {
      nowMs,
      target,
      automation,
      cameraLive: false,
      layers: actualLayers,
      frame: FRAME,
      random: actualRandom,
    })
    assert.deepEqual(
      plainTickSnapshot(state, expression, actualLayers),
      expected,
      `tick mismatch at frame ${frame}`,
    )
  }
})

test('camera tracking applies the original physics damping without target drift', async () => {
  const automation: UpstreamRuntimeTickAutomation = { idle: false, blink: false }
  const target: UpstreamRuntimeParameters = { ...UPSTREAM_RUNTIME_DEFAULTS }
  const expectedLayers = [hairLayer()]
  const actualLayers = expectedLayers.map(cloneRuntimeLayer)
  const oracle = await loadTickOracle({
    target,
    automation,
    layers: expectedLayers,
    frame: FRAME,
    cameraLive: true,
    random: () => 0.5,
  })
  const state = createUpstreamRuntimeTickState(0)
  for (let frame = 1; frame <= 90; frame += 1) {
    const nowMs = (frame * 1_000) / 60
    const expected = oracle.step(nowMs)
    const expression = stepUpstreamRuntimeTick(state, {
      nowMs,
      target,
      automation,
      cameraLive: true,
      layers: actualLayers,
      frame: FRAME,
      random: () => 0.5,
    })
    assert.deepEqual(
      plainTickSnapshot(state, expression, actualLayers),
      expected,
      `camera damping mismatch at frame ${frame}`,
    )
  }
})

async function loadBindingOracle(
  rig: Readonly<UpstreamRig>,
): Promise<BindingOracleSnapshot> {
  const source = await readFile(RUNTIME_URL, 'utf8')
  const applyStart = source.indexOf('function applyRig(rig)')
  const applyEnd = source.indexOf('// ---------- PSD loading ----------', applyStart)
  const helperStart = source.indexOf('function clamp(v,a,b)')
  const helperEnd = source.indexOf('function fadeAlpha', helperStart)
  assert.ok(
    applyStart >= 0 && applyEnd > applyStart && helperStart >= 0 && helperEnd > helperStart,
    'upstream applyRig source is missing',
  )

  let currentBuffer: { data?: number[] } | null = null
  const noop = () => undefined
  const gl = {
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    STATIC_DRAW: 3,
    TEXTURE_2D: 4,
    RGBA: 5,
    UNSIGNED_BYTE: 6,
    TEXTURE_MIN_FILTER: 7,
    TEXTURE_MAG_FILTER: 8,
    LINEAR: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    CLAMP_TO_EDGE: 12,
    createBuffer: () => ({}),
    createTexture: () => ({}),
    bindBuffer: (_target: number, buffer: { data?: number[] }) => {
      currentBuffer = buffer
    },
    bufferData: (_target: number, data: ArrayLike<number>) => {
      if (currentBuffer) currentBuffer.data = Array.from(data)
    },
    bindTexture: noop,
    texImage2D: noop,
    texParameteri: noop,
    deleteTexture: noop,
    deleteBuffer: noop,
  }
  const rigInfo = { innerHTML: '' }
  const drop = { classList: { add: noop } }
  const context = vm.createContext({
    layers: [],
    A: null,
    CW: 768,
    CH: 768,
    FS: 1,
    NP: null,
    BP: null,
    FC: null,
    CHEST: null,
    gl,
    cv: { width: 0, height: 0 },
    fit: noop,
    renderLayerList: noop,
    document: {
      getElementById: (id: string) => (id === 'rigInfo' ? rigInfo : drop),
    },
    Rigger: { baseName },
    ImageData: undefined,
    mkTex: () => ({}),
    __rig: rig,
  })
  vm.runInContext(
    `${source.slice(helperStart, helperEnd)}\n${source.slice(applyStart, applyEnd)}`,
    context,
  )
  vm.runInContext('applyRig(__rig)', context)
  const serialized = vm.runInContext(
    `JSON.stringify({
      canvas: { w: CW, h: CH },
      anchors: A,
      faceScale: FS,
      neckPivot: NP,
      bodyPivot: BP,
      faceCenter: FC,
      chest: CHEST,
      layers: layers.map(L => ({
        name: L.name, bn: L.bn, group: L.group, side: L.side,
        fade: L.fade, x: L.x, y: L.y, w: L.w, h: L.h, z: L.z,
        depth: L.depth, phys: L.phys, synthetic: L.synthetic,
        strands: L.strands, base: Array.from(L.base), cur: Array.from(L.cur),
        uv: L.vboUV.data, indices: L.ibo.data, nIdx: L.nIdx,
        sw: L.sw && Array.from(L.sw), su: L.su && Array.from(L.su),
        spr: L.spr, bw: L.bw && Array.from(L.bw)
      }))
    })`,
    context,
  ) as string
  return JSON.parse(serialized) as BindingOracleSnapshot
}

async function loadDrawOracle(
  layers: readonly UpstreamRuntimeLayer[],
): Promise<DrawOracleSnapshot> {
  const source = await readFile(RUNTIME_URL, 'utf8')
  const start = source.indexOf('// ---------- animation state ----------')
  const end = source.lastIndexOf('requestAnimationFrame(tick);')
  assert.ok(start >= 0 && end > start, 'upstream tick loop is missing')
  const commands: UpstreamRuntimeDrawCommand[] = []
  let alpha = 0
  let alphaCut = 0
  let stencil: UpstreamRuntimeDrawCommand['stencil'] = 'none'
  let stencilEnabled = false
  let currentLayer = -1
  const locAl = {}
  const locCut = {}
  const gl = {
    ARRAY_BUFFER: 1,
    COLOR_BUFFER_BIT: 2,
    DYNAMIC_DRAW: 3,
    ELEMENT_ARRAY_BUFFER: 4,
    EQUAL: 5,
    FLOAT: 6,
    KEEP: 7,
    STENCIL_BUFFER_BIT: 8,
    STENCIL_TEST: 9,
    TRIANGLES: 10,
    UNSIGNED_SHORT: 11,
    ALWAYS: 12,
    REPLACE: 13,
    bindBuffer: () => undefined,
    bindTexture: (_target: number, texture: { layerIndex: number }) => {
      currentLayer = texture.layerIndex
    },
    bufferData: () => undefined,
    clear: () => undefined,
    clearColor: () => undefined,
    clearStencil: () => undefined,
    disable: (capability: number) => {
      if (capability === 9) stencilEnabled = false
    },
    drawElements: () => {
      commands.push({
        layerIndex: currentLayer,
        name: layers[currentLayer].name,
        alpha,
        alphaCut,
        stencil: stencilEnabled ? stencil : 'none',
      })
    },
    enable: (capability: number) => {
      if (capability === 9) stencilEnabled = true
    },
    stencilFunc: (mode: number) => {
      stencil = mode === 12 ? 'write' : 'test'
    },
    stencilOp: () => undefined,
    uniform1f: (location: object, value: number) => {
      if (location === locAl) alpha = value
      if (location === locCut) alphaCut = value
    },
    uniform2f: () => undefined,
    vertexAttribPointer: () => undefined,
    viewport: () => undefined,
  }
  const fps = { textContent: '' }
  const target = {
    ...UPSTREAM_RUNTIME_DEFAULTS,
    eyeOpenL: 0,
    eyeOpenR: 1,
    mouthOpen: 0,
  }
  const oracleLayers = layers.map((layer, layerIndex) => ({
    ...cloneRuntimeLayer(layer),
    nIdx: 6,
    vboPos: {},
    vboUV: {},
    ibo: {},
    tex: { layerIndex },
  }))
  const context = vm.createContext({
    A: FRAME.anchors,
    FS: FRAME.faceScale,
    NP: FRAME.neckPivot,
    BP: FRAME.bodyPivot,
    FC: FRAME.faceCenter,
    CHEST: FRAME.chest,
    CW: 256,
    CH: 384,
    T: target,
    cur: { ...target },
    layers: oracleLayers,
    auto: {
      idle: false,
      blink: false,
      rand: false,
      talk: false,
      mouse: false,
      mic: false,
      phys: false,
      cam: false,
    },
    cam: { live: false },
    camPhysScale: 1,
    mouse: { x: 0, y: 0, in: false },
    micLevel: 0,
    analyser: null,
    micBuf: new Uint8Array(256),
    bounce: { x: 0, v: 0, dy: 0 },
    cv: { style: {} },
    gl,
    locRes: {},
    locAl,
    locCut,
    locPos: 0,
    locUV: 0,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    window: { addEventListener: () => undefined },
    document: { getElementById: () => fps },
  })
  vm.runInContext(source.slice(start, end), context)
  vm.runInContext(
    'deform = function(_layer, expression) { globalThis.__expression = Object.assign({}, expression) }',
    context,
  )
  vm.runInContext('tick(16)', context)
  const expression = JSON.parse(
    vm.runInContext('JSON.stringify(globalThis.__expression)', context) as string,
  ) as UpstreamRuntimeExpression
  return { expression, commands }
}

async function loadRuntimeOracle(
  frame: Readonly<UpstreamRuntimeFrame>,
): Promise<RuntimeOracle> {
  const source = await readFile(RUNTIME_URL, 'utf8')
  const start = source.indexOf('function clamp(v,a,b)')
  const end = source.indexOf('// ---------- main loop ----------', start)
  assert.ok(start >= 0 && end > start, 'upstream runtime helpers are missing')
  const context = {
    A: frame.anchors,
    FS: frame.faceScale,
    NP: frame.neckPivot,
    BP: frame.bodyPivot,
    FC: frame.faceCenter,
    CHEST: frame.chest,
    auto: { phys: frame.physicsEnabled },
    bounce: { dy: frame.bustDisplacement },
  }
  return vm.runInNewContext(
    `${source.slice(start, end)}; ({ fadeAlpha, deform })`,
    context,
  ) as RuntimeOracle
}

async function loadTickOracle(options: {
  target: UpstreamRuntimeParameters
  automation: UpstreamRuntimeTickAutomation
  layers: UpstreamRuntimeLayer[]
  frame: Readonly<UpstreamRuntimeFrame>
  cameraLive: boolean
  random: () => number
}): Promise<TickOracle> {
  const source = await readFile(RUNTIME_URL, 'utf8')
  const start = source.indexOf('// ---------- animation state ----------')
  const end = source.lastIndexOf('requestAnimationFrame(tick);')
  assert.ok(start >= 0 && end > start, 'upstream tick loop is missing')
  const math = Object.create(Math) as Math
  Object.defineProperty(math, 'random', { value: options.random })
  const fps = { textContent: '' }
  const context = vm.createContext({
    A: options.frame.anchors,
    FS: options.frame.faceScale,
    NP: options.frame.neckPivot,
    BP: options.frame.bodyPivot,
    FC: options.frame.faceCenter,
    CHEST: options.frame.chest,
    CW: 256,
    CH: 384,
    T: options.target,
    cur: { ...UPSTREAM_RUNTIME_DEFAULTS },
    layers: options.layers,
    auto: {
      idle: options.automation.idle,
      blink: options.automation.blink,
      rand: false,
      talk: false,
      mouse: false,
      mic: false,
      phys: true,
      cam: options.cameraLive,
    },
    cam: {
      live: options.cameraLive,
      ax: 0,
      ay: 0,
      az: 0,
      eL: 1,
      eR: 1,
      mo: 0,
      ex: 0,
      ey: 0,
    },
    camPhysScale: 1,
    mouse: { x: 0, y: 0, in: false },
    micLevel: 0,
    analyser: null,
    micBuf: new Uint8Array(256),
    bounce: { x: 0, v: 0, dy: 0 },
    cv: { style: {} },
    gl: nullWebGlContext(),
    locRes: null,
    locAl: null,
    locPos: 0,
    locUV: 0,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    window: { addEventListener: () => undefined },
    document: { getElementById: () => fps },
    Math: math,
  })
  vm.runInContext(source.slice(start, end), context)
  vm.runInContext(
    'deform = function(_layer, expression) { globalThis.__expression = Object.assign({}, expression) }',
    context,
  )
  return {
    step(nowMs: number): TickOracleSnapshot {
      vm.runInContext(`tick(${JSON.stringify(nowMs)})`, context)
      const serialized = vm.runInContext(
        `JSON.stringify({
          lastTimeMs: last,
          blinkElapsed: blinkT,
          nextBlinkAtMs: nextBlink,
          cameraPhysicsScale: camPhysScale,
          current: cur,
          expression: globalThis.__expression,
          bounce,
          springs: layers.map(layer => layer.spr)
        })`,
        context,
      ) as string
      return JSON.parse(serialized) as TickOracleSnapshot
    },
  }
}

function bindingRig(canvasWidth: number): UpstreamRig {
  const pixel = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 255, 255, 255]),
  }
  return {
    canvas: { w: canvasWidth, h: 512 },
    anchors: FRAME.anchors,
    warnings: [],
    synth: { eye: false, mouth: false },
    layers: [
      {
        name: 'face',
        x: 51.25,
        y: 24.75,
        w: 18,
        h: 21,
        z: 7,
        depth: 1,
        group: 'head',
        phys: null,
        fade: null,
        side: null,
        strands: null,
        img: pixel,
      },
      {
        name: 'front hair_12_l',
        x: 39.2,
        y: 15.4,
        w: 203.6,
        h: 267.3,
        z: 11,
        depth: 1.55,
        group: 'head',
        phys: 'hair',
        fade: null,
        side: 'L',
        strands: [
          { x: 66.5, rootY: 28.5, tipY: 250.4 },
          { x: 115.25, rootY: 25.75, tipY: 263.6 },
          { x: 194.75, rootY: 31.2, tipY: 271.8 },
        ],
        synthetic: true,
        img: pixel,
      },
      {
        name: 'back hair',
        x: 18.1,
        y: 4.6,
        w: 241.8,
        h: 322.2,
        z: 0,
        depth: 0.72,
        group: 'head',
        phys: 'hair',
        fade: null,
        side: null,
        strands: [{ x: 129.4, rootY: 18.2, tipY: 318.9 }],
        img: pixel,
      },
    ],
  }
}

function plainBindingSnapshot(
  binding: ReturnType<typeof bindUpstreamRuntimeRig>,
): BindingOracleSnapshot {
  return JSON.parse(
    JSON.stringify({
      canvas: binding.canvas,
      anchors: binding.anchors,
      faceScale: binding.faceScale,
      neckPivot: binding.neckPivot,
      bodyPivot: binding.bodyPivot,
      faceCenter: binding.faceCenter,
      chest: binding.chest,
      layers: binding.layers.map((layer: UpstreamRuntimeBoundLayer) => ({
        name: layer.name,
        bn: layer.bn,
        group: layer.group,
        side: layer.side,
        fade: layer.fade,
        x: layer.x,
        y: layer.y,
        w: layer.w,
        h: layer.h,
        z: layer.z,
        depth: layer.depth,
        phys: layer.phys,
        synthetic: layer.synthetic,
        strands: layer.strands,
        base: Array.from(layer.base),
        cur: Array.from(layer.cur),
        uv: Array.from(layer.uv),
        indices: Array.from(layer.indices),
        nIdx: layer.nIdx,
        sw: layer.sw && Array.from(layer.sw),
        su: layer.su && Array.from(layer.su),
        spr: layer.spr,
        bw: layer.bw && Array.from(layer.bw),
      })),
    }),
  ) as BindingOracleSnapshot
}

function drawLayers(): UpstreamRuntimeLayer[] {
  return [
    layer('eyewhite_l', 'eyewhite', 'head', 'eyeOpen', 'L', 72, 86, 42, 29, 1.1),
    layer('irides_l', 'irides', 'head', 'eyeOpen', 'L', 83, 91, 20, 20, 1.2),
    layer('mouth_open', 'mouth_open', 'head', 'mouthOpen', null, 98, 153, 62, 35, 1.4),
    layer('face', 'face', 'head', null, null, 52, 25, 152, 224, 1),
    layer('eyewhite_r', 'eyewhite', 'head', 'eyeOpen', 'R', 142, 84, 45, 31, 1.1),
    layer('irides_r', 'irides', 'head', 'eyeOpen', 'R', 153, 90, 21, 21, 1.2),
    layer('mouth_close', 'mouth_close', 'head', 'mouthClose', null, 99, 163, 60, 14, 1.41),
  ]
}

function runtimeExpression(frame: number): UpstreamRuntimeExpression {
  const time = frame / 60
  return {
    ...BASE_EXPRESSION,
    angleX: Math.sin(time * 1.7) * 0.82,
    angleY: Math.cos(time * 1.3) * 0.71,
    angleZ: Math.sin(time * 0.9 + 0.3) * 0.64,
    eyeOpenL: 0.5 + Math.sin(time * 4.1) * 0.58,
    eyeOpenR: 0.5 + Math.cos(time * 3.7) * 0.58,
    eyeX: Math.sin(time * 2.3) * 0.91,
    eyeY: Math.cos(time * 2.9) * 0.78,
    brow: Math.sin(time * 1.1) * 0.74,
    mouthOpen: 0.5 + Math.sin(time * 3.3) * 0.61,
    mouthForm: Math.cos(time * 2.1) * 0.88,
    mouthCY: Math.sin(time * 1.2) * 0.76,
    body: Math.cos(time * 0.8) * 0.69,
    browAngL: Math.sin(time * 1.4) * 0.63,
    browAngR: Math.cos(time * 1.6) * 0.59,
    browAngSym: Math.sin(time * 1.8) * 0.66,
    bangL: Math.sin(time * 2.2) * 0.77,
    bangC: Math.cos(time * 2.4) * 0.72,
    bangR: Math.sin(time * 2.6) * -0.68,
    armY: Math.cos(time * 1.5) * 0.81,
    armPos: Math.sin(time * 1.9) * 0.73,
    bust: 1.4 + Math.sin(time) * 1.1,
    bustY: Math.cos(time * 0.7) * 1.9,
    irisScale: 0.85 + Math.sin(time * 2.7) * 0.31,
    mouthEase: 0.5 + Math.sin(time * 0.6) * 0.45,
    eyeEase: 0.5 + Math.cos(time * 0.5) * 0.45,
    fhAmp: 1.5 + Math.sin(time * 0.9) * 1.2,
    fhSoft: 0.8 + Math.cos(time * 0.8) * 0.7,
    physAmp: 1.4 + Math.cos(time * 0.75) * 1.2,
    soft: 1.6 + Math.sin(time * 0.65) * 1.3,
    eyeCY: Math.sin(time * 1.7) * 0.79,
    eyeCAng: Math.cos(time * 1.9) * 0.84,
    mouthCAng: Math.sin(time * 1.25) * 0.81,
    eyeScaleL: 1 + Math.sin(time * 1.45) * 0.37,
    eyeScaleR: 1 + Math.cos(time * 1.55) * 0.34,
    mouthScale: 1 + Math.sin(time * 1.35) * 0.42,
    breath: 0.5 + Math.sin((time * 2 * Math.PI) / 3.4) * 0.5,
    breathHead:
      0.5 + Math.sin((time * 2 * Math.PI) / 3.4 - 0.6) * 0.5,
  }
}

function runtimeLayers(): UpstreamRuntimeLayer[] {
  return [
    layer('irides_l', 'irides', 'head', 'eyeOpen', 'L', 80, 91, 24, 20, 1.2),
    layer('eyelash_r', 'eyelash', 'head', 'eyeOpen', 'R', 142, 84, 45, 34, 1.3),
    layer('eye_close_l', 'eye_close', 'head', 'eyeClose', 'L', 72, 98, 42, 15, 1.31),
    layer('eyebrow_r', 'eyebrow', 'head', null, 'R', 143, 68, 44, 13, 1.34),
    layer('mouth_open', 'mouth_open', 'head', 'mouthOpen', null, 98, 153, 62, 35, 1.4),
    layer('mouth_close', 'mouth_close', 'head', 'mouthClose', null, 99, 163, 60, 14, 1.41),
    layer('face', 'face', 'head', null, null, 52, 25, 152, 224, 1),
    layer('neck', 'neck', 'body', null, null, 102, 193, 54, 82, 0.96),
    layer('topwear', 'topwear', 'body', null, null, 39, 218, 181, 132, 0.9),
    layer('handwear_l', 'handwear', 'body', null, 'L', 20, 227, 43, 118, 0.88),
    hairLayer(),
  ]
}

function layer(
  name: string,
  bn: string,
  group: 'head' | 'body',
  fade: UpstreamRuntimeLayer['fade'],
  side: UpstreamRuntimeLayer['side'],
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
): UpstreamRuntimeLayer {
  const base = new Float32Array([x, y, x + w, y, x, y + h, x + w, y + h])
  return {
    name,
    bn,
    group,
    fade,
    side,
    x,
    y,
    w,
    h,
    depth,
    base,
    cur: new Float32Array(base),
    strands: null,
  }
}

function hairLayer(): UpstreamRuntimeLayer {
  const result = layer(
    'front hair_1',
    'front hair',
    'head',
    null,
    null,
    45,
    20,
    166,
    222,
    1.52,
  )
  result.strands = [
    { x: 83, rootY: 34, tipY: 226 },
    { x: 169, rootY: 31, tipY: 229 },
  ]
  result.sw = new Float32Array([1, 0, 0.65, 0.35, 0.35, 0.65, 0, 1])
  result.su = new Float32Array([0, 0.28, 0.73, 1])
  result.bw = new Float32Array([
    1,
    0,
    0,
    0.6,
    0.4,
    0,
    0,
    0.35,
    0.65,
    0,
    0,
    1,
  ])
  result.spr = [
    {
      stiff: { x: 0, v: 0, dx: 0 },
      soft: { x: 0, v: 0, dx: 0 },
      phase: 1.52,
    },
    {
      stiff: { x: 0, v: 0, dx: 0 },
      soft: { x: 0, v: 0, dx: 0 },
      phase: 2.89,
    },
  ]
  return result
}

function cloneRuntimeLayer(layer: UpstreamRuntimeLayer): UpstreamRuntimeLayer {
  return {
    ...layer,
    base: new Float32Array(layer.base),
    cur: new Float32Array(layer.cur),
    strands: layer.strands?.map((strand) => ({ ...strand })) ?? null,
    sw: layer.sw ? new Float32Array(layer.sw) : undefined,
    su: layer.su ? new Float32Array(layer.su) : undefined,
    bw: layer.bw ? new Float32Array(layer.bw) : undefined,
    spr: layer.spr?.map((spring) => ({
      stiff: { ...spring.stiff },
      soft: { ...spring.soft },
      phase: spring.phase,
    })),
  }
}

function applySpringFrame(layer: UpstreamRuntimeLayer, frame: number): void {
  for (let index = 0; index < (layer.spr?.length ?? 0); index += 1) {
    const spring = layer.spr![index]
    spring.stiff.dx = Math.sin(frame * 0.07 + spring.phase) * 3.2
    spring.soft.dx = Math.cos(frame * 0.043 + spring.phase * 1.7) * 6.4
  }
}

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0
  return () => {
    const value = values[index % values.length]
    index += 1
    return value
  }
}

function plainTickSnapshot(
  state: ReturnType<typeof createUpstreamRuntimeTickState>,
  expression: UpstreamRuntimeExpression,
  layers: readonly UpstreamRuntimeLayer[],
): TickOracleSnapshot {
  return JSON.parse(
    JSON.stringify({
      lastTimeMs: state.lastTimeMs,
      blinkElapsed: state.blinkElapsed,
      nextBlinkAtMs: state.nextBlinkAtMs,
      cameraPhysicsScale: state.cameraPhysicsScale,
      current: state.current,
      expression,
      bounce: state.bounce,
      springs: layers.map((layer) => layer.spr),
    }),
  ) as TickOracleSnapshot
}

function nullWebGlContext(): Record<string, unknown> {
  const noop = () => undefined
  return {
    ARRAY_BUFFER: 0,
    COLOR_BUFFER_BIT: 1,
    DYNAMIC_DRAW: 2,
    ELEMENT_ARRAY_BUFFER: 3,
    EQUAL: 4,
    FLOAT: 5,
    KEEP: 6,
    STENCIL_BUFFER_BIT: 8,
    STENCIL_TEST: 9,
    TRIANGLES: 10,
    UNSIGNED_SHORT: 11,
    ALWAYS: 12,
    bindBuffer: noop,
    bindTexture: noop,
    bufferData: noop,
    clear: noop,
    clearColor: noop,
    clearStencil: noop,
    disable: noop,
    drawElements: noop,
    enable: noop,
    stencilFunc: noop,
    stencilOp: noop,
    uniform1f: noop,
    uniform2f: noop,
    vertexAttribPointer: noop,
    viewport: noop,
  }
}
