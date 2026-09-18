import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export const Route = createFileRoute('/')({ component: App })

type Vec2 = { x: number; z: number }

const LOGO_URL =
  'https://assets.macaly-user-data.dev/cdn-cgi/image/format=webp,width=2000,height=2000,fit=scale-down,quality=90,anim=true/i7kh60cl2hs0t0wml3sp1pbq/rvznhrr7a97tqwijcyhm2e9k/uatKNTlofhhp5AYbtJAni.png'

// Effectively endless terrain streamed in chunk tiles around the player.
// TILE_SIZE is large enough to keep re-tiling rare but small enough that a
// 3x3 (+1 ring) set of chunks fits comfortably in a mobile fog budget.
const TILE_SIZE = 100
const CHUNK_RING = 1 // active tiles span (2*CHUNK_RING+1)^2 around the player
const DRAIN_RADIUS = CHUNK_RING + 2 // tiles beyond this are disposed
const WATER_LEVEL = -3
const RIVER_HALF = 14
const SHORE_BAND = 6

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const smooth01 = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}
// Deterministic hash for per-tile / per-point decoration so revisiting a tile
// renders the same scenery every time, with no online RNG state.
const hash01 = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const hash2 = (ix: number, iz: number, salt: number, salt2 = 0) =>
  hash01(ix * 73856093 + iz * 19349663 + salt * 83492791 + salt2 * 1299721)

function riverCenter(x: number) {
  // Meandering river channel. Pure function of x -> seamless across chunks.
  return Math.sin(x * 0.07) * 22 + Math.sin(x * 0.19 + 1.1) * 8
}

function baseH(x: number, z: number) {
  let h = 0
  h += Math.sin(x * 0.05) * Math.cos(z * 0.045) * 6
  h += Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09) * 3
  h += Math.sin((x + z) * 0.07) * 2
  h += Math.sin(x * 0.03) * Math.cos(z * 0.025) * 4
  h += Math.sin(z * 0.085) * 3
  return h
}

function heightAt(x: number, z: number) {
  const d = Math.abs(z - riverCenter(x))
  const chw = smooth01((RIVER_HALF - d) / 6)
  const floor = WATER_LEVEL - 2
  return baseH(x, z) * (1 - chw) + floor * chw
}

// ---- Surface classification (shared by spawns, swimming, decorations) ----
type Surface = 'water' | 'shore' | 'meadow'

function surfaceAt(x: number, z: number): Surface {
  const y = heightAt(x, z)
  const d = Math.abs(z - riverCenter(x))
  // Water gameplay begins only where the river surface is actually above the
  // carved terrain. This keeps the visible channel and swimming area identical.
  if (d < RIVER_HALF && y < WATER_LEVEL + 0.1) return 'water'
  if (d < RIVER_HALF + SHORE_BAND) return 'shore'
  return 'meadow'
}

const onMeadow = (x: number, z: number) => surfaceAt(x, z) === 'meadow'
const onDryGround = (x: number, z: number) => {
  const s = surfaceAt(x, z)
  return s === 'meadow' || s === 'shore'
}

// The same deterministic decoration rules power collision, so a tree or rock
// that is rendered in a tile is also solid to the explorer.
function hasBlockingScenery(x: number, z: number, isMobile: boolean) {
  if (surfaceAt(x, z) === 'water') return false
  const centerX = Math.round(x / TILE_SIZE)
  const centerZ = Math.round(z / TILE_SIZE)
  const decorationCount = isMobile ? 60 : 120
  const playerRadius = 0.38
  for (let tx = centerX - 1; tx <= centerX + 1; tx++) {
    for (let tz = centerZ - 1; tz <= centerZ + 1; tz++) {
      for (let i = 0; i < decorationCount; i++) {
        const gx = tx * TILE_SIZE + (hash2(tx, tz, i) - 0.5) * TILE_SIZE
        const gz = tz * TILE_SIZE + (hash2(tx, tz, i + 1000) - 0.5) * TILE_SIZE
        if (!onDryGround(gx, gz) || !LANDMARKS.every((l) => Math.hypot(l.x - gx, l.z - gz) > l.radius + 4)) continue
        const kind = Math.floor(hash2(tx, tz, i + 4000) * 10)
        const dx = x - gx
        const dz = z - gz

        // Logs get a narrow, rotated box. Trees use the trunk, not their wide
        // canopy, so players can comfortably walk beside them.
        if (kind === 6) {
          const scale = 0.8 + hash2(tx, tz, i + 9800) * 0.7
          const angle = hash2(tx, tz, i + 9900) * Math.PI
          const along = Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle))
          const across = Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle))
          if (along < 2.1 * scale + playerRadius && across < 0.38 * scale + playerRadius) return true
          continue
        }

        const radius = kind === 0
          ? (0.7 + hash2(tx, tz, i + 5000) * 1.4) * 0.9 + playerRadius
          : kind === 2
            ? (0.8 + hash2(tx, tz, i + 5400) * 0.7) * 0.28 + playerRadius
            : kind === 3
              ? (0.85 + hash2(tx, tz, i + 5600) * 0.6) * 0.42 + playerRadius
              : kind === 7
                ? (0.55 + hash2(tx, tz, i + 10_100) * 0.45) * 0.55 + playerRadius
                : kind === 8
                  ? 0.9
                  : 0
        if (radius && Math.hypot(dx, dz) < radius) return true
      }
    }
  }
  // Fixed buildings and landmark bases are solid too. The bridge stays open.
  const fixed = [
    { x: 36, z: riverCenter(36) + 22, r: 1.55 },
    { x: 44, z: riverCenter(44) + 24, r: 1.55 },
    { x: 24, z: riverCenter(24) + 26, r: 1.55 },
    { x: 12, z: riverCenter(12) + 24, r: 1.55 },
    { x: -118, z: -108, r: 2.35 },
    { x: 112, z: 84, r: 2.0 },
  ]
  return fixed.some((item) => Math.hypot(x - item.x, z - item.z) < item.r + playerRadius)
}

const LANDMARKS: { name: string; x: number; z: number; radius: number; message: string }[] = [
  {
    name: 'Větrná věž',
    x: -118,
    z: -108,
    radius: 9,
    message: 'Stojíš u Větrné věže. Její větrník tiše cvaká v teplém stráni a z dálky ukazuje cestu přes celé údolí.',
  },
  {
    name: 'Kamenný most',
    x: 26,
    z: riverCenter(26),
    radius: 11,
    message: 'Přecházíš Kamenný most. Pod oblouky šumí voda a klenba spojuje oba břehy řeky.',
  },
  {
    name: 'Tábor pod javorem',
    x: 112,
    z: 84,
    radius: 9,
    message: 'Sedíš u Tábora pod javorem. Z ohniště stoupá kouř a javor vrhá klidný stín na cestu.',
  },
]

// Wandering low-poly creatures. Positions are deterministic per id so seams
// never matter; they roam on dry ground and respawn near the player when far.
type CreatureDef = { id: number; type: 'fox' | 'grazer'; seed: number }

function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const keysRef = useRef(new Set<string>())
  // Start near a clear bank so the river is immediately visible ahead.
  const positionRef = useRef<Vec2>({ x: 14, z: -12 })
  const camYawRef = useRef(0)
  const avatarYawRef = useRef(0)
  const distanceRef = useRef(0)
  const animRef = useRef(0)
  const swingRef = useRef(0)
  const statusRef = useRef<'CHŮZE' | 'PLAVÁNÍ'>('CHŮZE')
  const dayTimeRef = useRef(0.32) // normalized 0..1, starts mid-morning
  const jumpVelocityRef = useRef(0)
  const jumpHeightRef = useRef(0)
  const heldItemRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [visited, setVisited] = useState<string[]>([])
  const [heldItem, setHeldItem] = useState<string | null>(null)
  const [pickupHint, setPickupHint] = useState('Najdi něco k sebrání')
  const [showMap, setShowMap] = useState(false)
  const [distance, setDistance] = useState(0)
  const pickUp = useCallback(() => {
    ;(window as unknown as { __echoesTakeItem?: () => void }).__echoesTakeItem?.()
  }, [])
  const [status, setStatus] = useState<'CHŮZE' | 'PLAVÁNÍ'>('CHŮZE')
  const [timeState, setTimeState] = useState<'SVÍTÁ' | 'DEN' | 'POLEDNE' | 'ODPOLEDNE' | 'SOU MRÁČKŮ' | 'STÍN' | 'ŠERO' | 'NOC'>('DEN')

  useEffect(() => {
    const mount = mountRef.current
    const canvas = canvasRef.current
    if (!mount || !canvas) return

    const style = getComputedStyle(document.documentElement)
    const parse = (name: string) => {
      const raw = style.getPropertyValue(name).trim().split(/\s+/)
      const h = Number(raw[0] ?? 0)
      const s = Number(raw[1]?.replace('%', '') ?? 0)
      const l = Number(raw[2]?.replace('%', '') ?? 0)
      return new THREE.Color(`hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`)
    }
    const C = {
      sky: parse('--game-sky'),
      skyLight: parse('--game-sky-light'),
      grass: parse('--game-grass'),
      grassLight: parse('--game-grass-light'),
      dirt: parse('--game-dirt'),
      rock: parse('--game-rock'),
      sun: parse('--game-sun'),
      coral: parse('--game-coral'),
      cream: parse('--game-cream'),
    }

    const width = mount.clientWidth || window.innerWidth
    const isMobile = window.matchMedia('(pointer: coarse)').matches || width < 720
    const enableShadows = !isMobile

    const scene = new THREE.Scene()
    scene.background = C.skyLight.clone()
    scene.fog = new THREE.Fog(C.skyLight.clone(), 70, 360)

    // Painterly gradient skydome (colors animated by the day/night cycle).
    const skyGeo = new THREE.SphereGeometry(1400, 32, 16)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: C.sky.clone() }, bottom: { value: C.skyLight.clone() } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float t = clamp(normalize(vPos).y * 0.55 + 0.32, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    })
    scene.add(new THREE.Mesh(skyGeo, skyMat))

    // Sun + moon discs orbiting with the day cycle; visible hemispheres swap.
    const sunMat = new THREE.MeshBasicMaterial({ color: C.sun.clone(), fog: false })
    const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 16), sunMat)
    scene.add(sunSphere)
    const moonMat = new THREE.MeshBasicMaterial({ color: C.cream.clone().lerp(new THREE.Color('hsl(210,30%,85%)'), 0.5), fog: false })
    const moonSphere = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 16), moonMat)
    scene.add(moonSphere)

    // Star field: faint points across the dome, revealed by alpha at night.
    const starGeo = new THREE.BufferGeometry()
    const starN = 700
    const starPos = new Float32Array(starN * 3)
    for (let i = 0; i < starN; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 0.9 + 0.05) // upper hemisphere only
      const r = 1100
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      starPos[i * 3 + 1] = r * Math.cos(phi)
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({ color: C.cream.clone(), size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)

    const hemi = new THREE.HemisphereLight(C.sky.clone(), C.grass.clone(), 0.95)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(C.sun.clone(), 1.15)
    sun.position.set(240, 340, 120)
    if (enableShadows) {
      sun.castShadow = true
      sun.shadow.mapSize.set(1024, 1024)
      const sc = sun.shadow.camera
      sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 1; sc.far = 700
    }
    scene.add(sun)
    scene.add(sun.target)
    const ambient = new THREE.AmbientLight(C.cream.clone(), 0.18)
    scene.add(ambient)

    // Moonlight fills shadows during the night half of the cycle.
    const moonLight = new THREE.DirectionalLight(C.sky.clone().lerp(new THREE.Color('hsl(210,40%,80%)'), 0.6), 0.0)
    moonLight.position.set(-200, 260, -120)
    scene.add(moonLight)

    const collect: { dispose: () => void }[] = []
    const track = <T extends THREE.BufferGeometry | THREE.Material>(obj: T) => {
      collect.push({ dispose: () => obj.dispose() })
      return obj
    }

    // ---- Shared decoration geometries / materials (reused across all tiles) ----
    const grassGeo = track(new THREE.ConeGeometry(0.07, 0.5, 4))
    grassGeo.translate(0, 0.25, 0)
    const grassMat = track(new THREE.MeshPhongMaterial({ color: C.grassLight.clone(), flatShading: true, shininess: 0 }))

    const boulderGeo = track(new THREE.DodecahedronGeometry(1, 0))
    const rockMat = track(new THREE.MeshPhongMaterial({ color: C.rock.clone(), flatShading: true, shininess: 0 }))

    const fallenLogGeo = track(new THREE.CylinderGeometry(0.32, 0.4, 4.2, 7))
    fallenLogGeo.rotateZ(Math.PI / 2)
    fallenLogGeo.translate(0, 0.4, 0)
    const logMat = track(new THREE.MeshPhongMaterial({ color: C.dirt.clone().multiplyScalar(0.6), flatShading: true, shininess: 0 }))

    // Conifer tree (shared trunk + two stacked cones).
    const trunkGeo = track(new THREE.CylinderGeometry(0.18, 0.28, 1.5, 6))
    trunkGeo.translate(0, 0.75, 0)
    const lowerGeo = track(new THREE.ConeGeometry(1.5, 2.3, 7))
    lowerGeo.translate(0, 2.5, 0)
    const upperGeo = track(new THREE.ConeGeometry(1.0, 1.9, 7))
    upperGeo.translate(0, 3.9, 0)
    const trunkMat = track(new THREE.MeshPhongMaterial({ color: C.dirt.clone().multiplyScalar(0.7), flatShading: true, shininess: 0 }))
    const foliMat = track(new THREE.MeshPhongMaterial({ color: C.grass.clone(), flatShading: true, shininess: 0 }))

    // Round deciduous tree (shared trunk + lobed icosahedron crown).
    const roundTrunkGeo = track(new THREE.CylinderGeometry(0.3, 0.42, 3.0, 6))
    roundTrunkGeo.translate(0, 1.5, 0)
    const roundCrownGeo = track(new THREE.IcosahedronGeometry(2.4, 0))
    roundCrownGeo.scale(1.1, 1.0, 1.1)
    roundCrownGeo.translate(0, 4.0, 0)
    const roundFoliMat = track(new THREE.MeshPhongMaterial({ color: C.grassLight.clone(), flatShading: true, shininess: 0 }))

    const flowerGeo = track(new THREE.IcosahedronGeometry(0.16, 0))
    const flowerMats = [
      track(new THREE.MeshPhongMaterial({ color: C.coral.clone(), flatShading: true, shininess: 0 })),
      track(new THREE.MeshPhongMaterial({ color: C.sun.clone(), flatShading: true, shininess: 0 })),
      track(new THREE.MeshPhongMaterial({ color: C.cream.clone().lerp(new THREE.Color('hsl(340,70%,85%)'), 0.7), flatShading: true, shininess: 0 })),
    ]

    const terrainMat = track(new THREE.MeshPhongMaterial({ color: C.grass.clone(), flatShading: true, shininess: 0, vertexColors: true }))
    const waterMat = track(
      new THREE.MeshPhongMaterial({
        color: C.sky.clone(),
        transparent: true,
        opacity: 0.78,
        shininess: 100,
        specular: C.cream.clone(),
        flatShading: false,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )

    // Build a terrain+water tile at tile coords (tx,tz). Heights follow the
    // global heightAt so neighbouring tiles line up with no seams.
    const SEG = isMobile ? 14 : 22
    const baseTerrainGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, SEG, SEG)
    baseTerrainGeo.rotateX(-Math.PI / 2)
    type Tile = {
      tx: number
      tz: number
      group: THREE.Group
      terrain: THREE.Mesh
      water: THREE.Mesh
      deco: THREE.Group
    }
    const tiles = new Map<string, Tile>()
    const tileKey = (tx: number, tz: number) => `${tx},${tz}`

    const dummy = new THREE.Object3D()
    const tmpColor = new THREE.Color()
    const shoreColor = C.dirt.clone().lerp(C.grassLight.clone(), 0.35)
    const grassDark = C.grass.clone().multiplyScalar(0.82)

    const terrainColors = (verts: THREE.BufferAttribute, colorAttr: THREE.BufferAttribute) => {
      for (let i = 0; i < verts.count; i++) {
        const y = verts.getY(i)
        const t = smooth01((y - WATER_LEVEL - 0.5) / 6)
        tmpColor.copy(shoreColor).lerp(grassDark, t)
        colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b)
      }
      colorAttr.needsUpdate = true
    }

    const buildTile = (tx: number, tz: number): Tile => {
      const group = new THREE.Group()
      const ox = tx * TILE_SIZE
      const oz = tz * TILE_SIZE

      const terrainGeo = baseTerrainGeo.clone()
      const tVerts = terrainGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < tVerts.count; i++) {
        const gx = ox + tVerts.getX(i)
        const gz = oz + tVerts.getZ(i)
        // Tile geometry uses global coordinates. Previously every terrain tile
        // sat on top of the origin, which made the close camera see a flat,
        // uninterrupted green surface instead of the surrounding landscape.
        tVerts.setX(i, gx)
        tVerts.setY(i, heightAt(gx, gz))
        tVerts.setZ(i, gz)
      }
      tVerts.needsUpdate = true
      terrainGeo.computeVertexNormals()
      const tColor = new THREE.BufferAttribute(new Float32Array(tVerts.count * 3), 3)
      terrainGeo.setAttribute('color', tColor)
      terrainColors(tVerts, tColor)
      const terrain = new THREE.Mesh(terrainGeo, terrainMat)
      terrain.receiveShadow = enableShadows
      group.add(terrain)

      // A real river ribbon, lifted slightly above its bed. Building only the
      // channel geometry avoids a transparent blue plane over the whole world.
      const waterGeo = new THREE.BufferGeometry()
      const waterVertices: number[] = []
      const minZ = oz - TILE_SIZE / 2
      const maxZ = oz + TILE_SIZE / 2
      const waterSteps = SEG * 2
      for (let i = 0; i < waterSteps; i++) {
        const x1 = ox - TILE_SIZE / 2 + (i / waterSteps) * TILE_SIZE
        const x2 = ox - TILE_SIZE / 2 + ((i + 1) / waterSteps) * TILE_SIZE
        const c1 = riverCenter(x1)
        const c2 = riverCenter(x2)
        if (Math.max(c1, c2) + RIVER_HALF < minZ || Math.min(c1, c2) - RIVER_HALF > maxZ) continue
        const z1L = c1 - RIVER_HALF
        const z1R = c1 + RIVER_HALF
        const z2L = c2 - RIVER_HALF
        const z2R = c2 + RIVER_HALF
        const y = WATER_LEVEL + 0.16
        waterVertices.push(x1, y, z1L, x2, y, z2L, x2, y, z2R, x1, y, z1L, x2, y, z2R, x1, y, z1R)
      }
      waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3))
      waterGeo.computeVertexNormals()
      const water = new THREE.Mesh(waterGeo, waterMat)
      group.add(water)

      // Decorations laid out deterministically from tile coords; nothing is
      // ever placed under the river. Geometries/materials are shared.
      const deco = new THREE.Group()

      const rocks: { x: number; y: number; z: number; ry: number; sx: number; sy: number }[] = []
      const coniferTrees: { x: number; y: number; z: number; ry: number; s: number }[] = []
      const roundTrees: { x: number; y: number; z: number; ry: number; s: number }[] = []
      const grassTufts: { x: number; y: number; z: number; rot: number; s: number }[] = []
      const flowerSets: { x: number; y: number; z: number; mi: number; s: number }[] = []
      const fallenLogs: { x: number; y: number; z: number; ry: number; s: number }[] = []

      const N = isMobile ? 60 : 120
      const avoidLandmark = (x: number, z: number, gap: number) =>
        LANDMARKS.every((l) => Math.hypot(l.x - x, l.z - z) > l.radius + gap)

      for (let i = 0; i < N; i++) {
        const rx = hash2(tx, tz, i) - 0.5
        const rz = hash2(tx, tz, i + 1000) - 0.5
        const gx = ox + rx * TILE_SIZE
        const gz = oz + rz * TILE_SIZE
        const kind = Math.floor(hash2(tx, tz, i + 4000) * 10)
        if (!onDryGround(gx, gz)) continue
        const y = heightAt(gx, gz)
        if (!avoidLandmark(gx, gz, 4)) continue
        if (kind === 0) {
          // Bigger boulder (rock instance using shared geometry).
          const s = 0.7 + hash2(tx, tz, i + 5000) * 1.4
          rocks.push({ x: gx, y: y - 0.2, z: gz, ry: hash2(tx, tz, i + 5100) * Math.PI, sx: s, sy: s * 0.8 })
        } else if (kind === 1) {
          // Small skalky.
          const s = 0.3 + hash2(tx, tz, i + 5200) * 0.5
          rocks.push({ x: gx, y: y - 0.1, z: gz, ry: hash2(tx, tz, i + 5300) * Math.PI, sx: s, sy: s })
        } else if (kind === 2) {
          // Conifer.
          const s = 0.8 + hash2(tx, tz, i + 5400) * 0.7
          coniferTrees.push({ x: gx, y, z: gz, ry: hash2(tx, tz, i + 5500) * Math.PI * 2, s })
        } else if (kind === 3) {
          // Round deciduous tree.
          const s = 0.85 + hash2(tx, tz, i + 5600) * 0.6
          roundTrees.push({ x: gx, y, z: gz, ry: hash2(tx, tz, i + 5700) * Math.PI * 2, s })
        } else if (kind === 4) {
          // Tall grass clump (a few tufts together).
          for (let k = 0; k < 5; k++) {
            const oxg = (hash2(tx, tz, i * 5 + k + 6000) - 0.5) * 1.6
            const ozg = (hash2(tx, tz, i * 5 + k + 7000) - 0.5) * 1.6
            const gxg = gx + oxg
            const gzg = gz + ozg
            if (!onDryGround(gxg, gzg)) continue
            grassTufts.push({ x: gxg, y: heightAt(gxg, gzg), z: gzg, rot: hash2(tx, tz, i + k + 8000) * Math.PI, s: 0.8 + hash2(tx, tz, i + k + 8100) * 0.9 })
          }
        } else if (kind === 5) {
          // Flower cluster.
          for (let k = 0; k < 6; k++) {
            const oxg = (hash2(tx, tz, i * 6 + k + 9000) - 0.5) * 2.0
            const ozg = (hash2(tx, tz, i * 6 + k + 9500) - 0.5) * 2.0
            const gxg = gx + oxg
            const gzg = gz + ozg
            if (!onDryGround(gxg, gzg)) continue
            const mi = Math.floor(hash2(tx, tz, i + k + 9600) * flowerMats.length)
            flowerSets.push({ x: gxg, y: heightAt(gxg, gzg) + 0.18, z: gzg, mi, s: 0.8 + hash2(tx, tz, i + k + 9700) * 0.7 })
          }
        } else if (kind === 6) {
          // Fallen log on dry ground.
          const s = 0.8 + hash2(tx, tz, i + 9800) * 0.7
          fallenLogs.push({ x: gx, y, z: gz, ry: hash2(tx, tz, i + 9900) * Math.PI, s })
        } else if (kind === 7) {
          // Weathered standing stone, a rare vertical landmark in the meadow.
          const s = 0.55 + hash2(tx, tz, i + 10_100) * 0.45
          rocks.push({ x: gx, y: y + s * 1.6, z: gz, ry: hash2(tx, tz, i + 10_200) * Math.PI, sx: s * 0.55, sy: s * 1.6 })
        } else if (kind === 8) {
          // Small cairn, built from three offset stones.
          const s = 0.38 + hash2(tx, tz, i + 10_300) * 0.32
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + hash2(tx, tz, i + 10_400) * 0.5
            rocks.push({ x: gx + Math.cos(a) * s * 0.65, y: y + s * (k === 2 ? 1.2 : 0.35), z: gz + Math.sin(a) * s * 0.65, ry: a, sx: s, sy: s * (k === 2 ? 1.15 : 0.7) })
          }
        } else {
          // Extra grass tuft to thicken the meadow.
          grassTufts.push({ x: gx, y, z: gz, rot: hash2(tx, tz, i + 9200) * Math.PI, s: 0.7 + hash2(tx, tz, i + 9300) * 0.8 })
        }
      }

      // Solid meshes (logs, trees crowns, trunks) — shared geometry + shared
      // material where color variance isn't required; per-instance color added
      // only where it cheaply adds variety.
      const addMesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry: number, sx: number, sy: number) => {
        const mesh = new THREE.Mesh(g, m)
        mesh.position.set(x, y, z)
        mesh.rotation.y = ry
        mesh.scale.set(sx, sy, sx)
        mesh.castShadow = enableShadows
        mesh.receiveShadow = enableShadows
        deco.add(mesh)
        return mesh
      }

      // Rocks (per-instance tint for variety) share one geometry/material.
      for (const r of rocks) addMesh(boulderGeo, rockMat, r.x, r.y, r.z, r.ry, r.sx, r.sy)

      // Conifers.
      const foliTint = new THREE.Color()
      for (const t of coniferTrees) {
        addMesh(trunkGeo, trunkMat, t.x, t.y, t.z, t.ry, t.s, t.s)
        foliTint.copy(C.grass).multiplyScalar(0.7 + hash2(tx, tz, Math.floor(t.x) + Math.floor(t.z), 1) * 0.5)
        const lower = addMesh(lowerGeo, foliMat, t.x, t.y, t.z, t.ry, t.s, t.s)
        const upper = addMesh(upperGeo, foliMat, t.x, t.y, t.z, t.ry, t.s, t.s)
        lower.material = foliMat.clone()
        ;(lower.material as THREE.MeshPhongMaterial).color.copy(foliTint.clone().offsetHSL(0, 0, -0.03))
        upper.material = lower.material
      }

      // Round deciduous trees, per-instance autumn/spring tinted foliage.
      const roundTint = new THREE.Color()
      const palettes = [C.grassLight.clone(), C.grass.clone().lerp(C.sun.clone(), 0.4), C.coral.clone().lerp(C.dirt.clone(), 0.45)]
      for (const t of roundTrees) {
        addMesh(roundTrunkGeo, trunkMat, t.x, t.y, t.z, t.ry, t.s, t.s)
        roundTint.copy(palettes[Math.floor(hash2(tx, tz, Math.floor(t.x) + 2, 9) * palettes.length)])
        const crown = addMesh(roundCrownGeo, roundFoliMat, t.x, t.y, t.z, t.ry, t.s, t.s)
        crown.material = roundFoliMat.clone()
        ;(crown.material as THREE.MeshPhongMaterial).color.copy(roundTint)
      }

      // Fallen logs.
      for (const l of fallenLogs) addMesh(fallenLogGeo, logMat, l.x, l.y, l.z, l.ry, l.s, l.s)

      // Grass tufts + flowers use tiny instanced meshes per tile, sharing
      // geometries/materials across tiles. InstancedMesh keeps draw calls low.
      if (grassTufts.length) {
        const ig = new THREE.InstancedMesh(grassGeo, grassMat, grassTufts.length)
        for (let i = 0; i < grassTufts.length; i++) {
          const tu = grassTufts[i]
          dummy.position.set(tu.x, tu.y, tu.z)
          dummy.rotation.set(0, tu.rot, (hash2(tx, tz, i, 3) - 0.5) * 0.18)
          dummy.scale.setScalar(tu.s)
          dummy.updateMatrix()
          ig.setMatrixAt(i, dummy.matrix)
          tmpColor.copy(C.grassLight).multiplyScalar(0.78 + hash2(tx, tz, i, 4) * 0.45)
          ig.setColorAt(i, tmpColor)
        }
        ig.instanceMatrix.needsUpdate = true
        if (ig.instanceColor) ig.instanceColor.needsUpdate = true
        deco.add(ig)
      }
      if (flowerSets.length) {
        const perMat: number[] = Array.from({ length: flowerMats.length }, () => 0)
        flowerSets.forEach((f) => perMat[f.mi]++)
        for (let mi = 0; mi < flowerMats.length; mi++) {
          if (!perMat[mi]) continue
          const uses = flowerSets.filter((f) => f.mi === mi)
          const igf = new THREE.InstancedMesh(flowerGeo, flowerMats[mi], uses.length)
          for (let i = 0; i < uses.length; i++) {
            const f = uses[i]
            dummy.position.set(f.x, f.y, f.z)
            dummy.rotation.set(0, hash2(tx, tz, i, 5) * Math.PI, 0)
            dummy.scale.setScalar(f.s)
            dummy.updateMatrix()
            igf.setMatrixAt(i, dummy.matrix)
          }
          igf.instanceMatrix.needsUpdate = true
          deco.add(igf)
        }
      }

      group.add(deco)
      scene.add(group)
      return { tx, tz, group, terrain, water, deco }
    }

    const disposeTile = (t: Tile) => {
      scene.remove(t.group)
      t.terrain.geometry.dispose()
      t.water.geometry.dispose()
      t.deco.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isInstancedMesh) {
          if (m.material && (m.material as THREE.Material).clone) {
            // per-tile instanced meshes reuse shared materials/forms; only
            // dispose the instance buffers automatically through .dispose().
            m.dispose?.()
          }
          m.dispose?.()
        }
      })
    }

    const ensureTilesAround = (px: number, pz: number) => {
      const ctx = Math.round(px / TILE_SIZE)
      const ctz = Math.round(pz / TILE_SIZE)
      for (let dx = -CHUNK_RING; dx <= CHUNK_RING; dx++) {
        for (let dz = -CHUNK_RING; dz <= CHUNK_RING; dz++) {
          const tx = ctx + dx
          const tz = ctz + dz
          const key = tileKey(tx, tz)
          if (!tiles.has(key)) tiles.set(key, buildTile(tx, tz))
        }
      }
      // Drain anything well outside the active ring.
      for (const [key, tile] of tiles) {
        if (Math.abs(tile.tx - ctx) > DRAIN_RADIUS || Math.abs(tile.tz - ctz) > DRAIN_RADIUS) {
          disposeTile(tile)
          tiles.delete(key)
        }
      }
    }

    // Build the initial 3x3 around the spawn so the first frame is populated.
    ensureTilesAround(positionRef.current.x, positionRef.current.z)

    // ---- Fixed landmark structures (kept at their original global coords) ----
    let flagMesh: THREE.Mesh | null = null
    let flameMesh: THREE.Mesh | null = null

    const makeMaple = (x: number, z: number) => {
      const g = new THREE.Group()
      const tgeo = track(new THREE.CylinderGeometry(0.45, 0.6, 3.2, 7))
      tgeo.translate(0, 1.6, 0)
      const tmesh = new THREE.Mesh(tgeo, trunkMat.clone())
      g.add(tmesh)
      const cgeo = track(new THREE.IcosahedronGeometry(2.6, 0))
      const crownMat = track(new THREE.MeshPhongMaterial({ color: C.grassLight.clone(), flatShading: true, shininess: 0 }))
      const crown = new THREE.Mesh(cgeo, crownMat)
      crown.position.y = 4.6
      crown.castShadow = enableShadows
      g.add(crown)
      const c2 = new THREE.Mesh(cgeo.clone().scale(1.4, 1.3, 1.4), crownMat)
      c2.position.set(0.9, 3.8, 0.6)
      g.add(c2)
      g.position.set(x, heightAt(x, z), z)
      scene.add(g)
    }
    makeMaple(118, 76)
    makeMaple(128, 86)

    const makeHouse = (x: number, z: number, rot: number) => {
      const g = new THREE.Group()
      const bodyMat = track(new THREE.MeshPhongMaterial({ color: C.cream.clone(), flatShading: true, shininess: 0 }))
      const roofMat = track(new THREE.MeshPhongMaterial({ color: C.coral.clone(), flatShading: true, shininess: 0 }))
      const body = new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 1.8, 2.4)), bodyMat)
      body.position.y = 0.9
      body.castShadow = enableShadows
      g.add(body)
      const roof = new THREE.Mesh(track(new THREE.ConeGeometry(2.0, 1.4, 4)), roofMat)
      roof.rotation.y = Math.PI / 4
      roof.position.y = 2.5
      roof.castShadow = enableShadows
      g.add(roof)
      g.position.set(x, heightAt(x, z), z)
      g.rotation.y = rot
      scene.add(g)
    }
    makeHouse(36, riverCenter(36) + 22, -0.3)
    makeHouse(44, riverCenter(44) + 24, 0.2)
    makeHouse(24, riverCenter(24) + 26, 0.5)
    makeHouse(12, riverCenter(12) + 24, 1.1)

    const towerPos = LANDMARKS[0]
    {
      const g = new THREE.Group()
      const stone = track(new THREE.MeshPhongMaterial({ color: C.rock.clone(), flatShading: true, shininess: 0 }))
      const shaft = new THREE.Mesh(track(new THREE.CylinderGeometry(1.6, 2.0, 9, 8)), stone)
      shaft.position.y = 4.5
      g.add(shaft)
      const ring = new THREE.Mesh(track(new THREE.CylinderGeometry(2.4, 2.4, 1.0, 8)), stone)
      ring.position.y = 9.2
      g.add(ring)
      const roof = new THREE.Mesh(track(new THREE.ConeGeometry(2.4, 2.4, 8)), track(new THREE.MeshPhongMaterial({ color: C.dirt.clone(), flatShading: true, shininess: 0 })))
      roof.position.y = 11.4
      g.add(roof)
      const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5)), track(new THREE.MeshPhongMaterial({ color: C.rock.clone(), flatShading: true })))
      pole.position.set(0, 13.2, 0)
      g.add(pole)
      flagMesh = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 0.6, 0.05)), new THREE.MeshPhongMaterial({ color: C.coral.clone(), flatShading: true, side: THREE.DoubleSide }))
      flagMesh.position.set(0.6, 13.5, 0)
      g.add(flagMesh)
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = enableShadows })
      g.position.set(towerPos.x, heightAt(towerPos.x, towerPos.z), towerPos.z)
      scene.add(g)
    }

    const bridgePos = LANDMARKS[1]
    {
      const g = new THREE.Group()
      const stone = track(new THREE.MeshPhongMaterial({ color: C.rock.clone().multiplyScalar(0.86), flatShading: true, shininess: 0 }))
      const deck = new THREE.Mesh(track(new THREE.BoxGeometry(4.2, 1.0, 36)), stone)
      deck.position.y = 1.0
      deck.castShadow = enableShadows
      g.add(deck)
      const railL = new THREE.Mesh(track(new THREE.BoxGeometry(0.35, 0.9, 36)), stone)
      railL.position.set(-2.1, 1.8, 0)
      g.add(railL)
      const railR = railL.clone()
      railR.position.x = 2.1
      g.add(railR)
      for (let k = -2; k <= 2; k++) {
        const pz = k * 11
        const baseY = heightAt(bridgePos.x, bridgePos.z + pz)
        const top = 1.5
        const h = Math.max(1, top - Math.min(baseY, 1))
        const pillar = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, h, 0.9)), stone)
        pillar.position.set(0, top - h / 2, pz)
        pillar.castShadow = enableShadows
        g.add(pillar)
        const arch = new THREE.Mesh(track(new THREE.TorusGeometry(4.5, 0.25, 6, 9, Math.PI)), stone)
        arch.position.set(0, 1.0, pz + 5.5)
        arch.rotation.z = Math.PI
        arch.scale.set(0.5, 0.65, 1)
        g.add(arch)
      }
      g.position.set(bridgePos.x, WATER_LEVEL, bridgePos.z)
      scene.add(g)
    }

    const campPos = LANDMARKS[2]
    {
      const g = new THREE.Group()
      const tentMat = track(new THREE.MeshPhongMaterial({ color: C.coral.clone().multiplyScalar(0.85), flatShading: true, shininess: 0, side: THREE.DoubleSide }))
      const tentGeo = track(new THREE.CylinderGeometry(0.01, 1.5, 2.2, 3, 1, false, 0, Math.PI))
      const tent = new THREE.Mesh(tentGeo, tentMat)
      tent.rotation.z = Math.PI / 2
      tent.rotation.y = Math.PI / 6
      tent.position.set(0, 0.7, 0)
      tent.castShadow = enableShadows
      g.add(tent)
      const fireRing = new THREE.Mesh(track(new THREE.TorusGeometry(0.5, 0.12, 4, 10)), track(new THREE.MeshPhongMaterial({ color: C.rock.clone(), flatShading: true })))
      fireRing.rotation.x = Math.PI / 2
      fireRing.position.set(2.4, 0.12, 0.6)
      g.add(fireRing)
      const logMat2 = track(new THREE.MeshPhongMaterial({ color: C.dirt.clone().multiplyScalar(0.6), flatShading: true }))
      for (let k = 0; k < 3; k++) {
        const log = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 5)), logMat2)
        log.position.set(2.4, 0.18, 0.6)
        log.rotation.z = Math.PI / 2
        log.rotation.y = (k / 3) * Math.PI
        g.add(log)
      }
      flameMesh = new THREE.Mesh(track(new THREE.ConeGeometry(0.28, 0.7, 7)), new THREE.MeshBasicMaterial({ color: C.sun.clone(), transparent: true, opacity: 0.9, fog: false }))
      flameMesh.position.set(2.4, 0.45, 0.6)
      g.add(flameMesh)
      g.position.set(campPos.x, heightAt(campPos.x, campPos.z), campPos.z)
      scene.add(g)
    }

    // ---- Explorer avatar ----
    const avatar = new THREE.Group()
    const jacket = track(new THREE.MeshPhongMaterial({ color: C.coral.clone(), flatShading: true, shininess: 0 }))
    const skin = track(new THREE.MeshPhongMaterial({ color: C.cream.clone().multiplyScalar(0.78), flatShading: true, shininess: 0 }))
    const pack = track(new THREE.MeshPhongMaterial({ color: C.dirt.clone().multiplyScalar(0.6), flatShading: true, shininess: 0 }))
    const hatMat = track(new THREE.MeshPhongMaterial({ color: C.rock.clone(), flatShading: true, shininess: 0 }))
    const body = new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.78, 0.42)), jacket)
    body.position.y = 1.07
    avatar.add(body)
    const backpack = new THREE.Mesh(track(new THREE.BoxGeometry(0.4, 0.56, 0.26)), pack)
    backpack.position.set(0, 1.08, -0.3)
    avatar.add(backpack)
    const head = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.24, 0)), skin)
    head.position.y = 1.66
    avatar.add(head)
    const hat = new THREE.Mesh(track(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 8)), hatMat)
    hat.position.y = 1.86
    avatar.add(hat)
    const brim = new THREE.Mesh(track(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10)), hatMat)
    brim.position.y = 1.8
    avatar.add(brim)
    const legPivotL = new THREE.Group(); const legPivotR = new THREE.Group()
    legPivotL.position.set(-0.16, 0.72, 0); legPivotR.position.set(0.16, 0.72, 0)
    const legMeshL = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 0.7, 0.22)), pack)
    legMeshL.position.y = -0.36
    const legMeshR = legMeshL.clone()
    legPivotL.add(legMeshL); legPivotR.add(legMeshR)
    avatar.add(legPivotL, legPivotR)
    const armPivotL = new THREE.Group(); const armPivotR = new THREE.Group()
    armPivotL.position.set(-0.36, 1.34, 0); armPivotR.position.set(0.36, 1.34, 0)
    const armMeshL = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.6, 0.18)), jacket)
    armMeshL.position.y = -0.3
    const armMeshR = armMeshL.clone()
    armPivotL.add(armMeshL); armPivotR.add(armMeshR)
    avatar.add(armPivotL, armPivotR)
    avatar.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = enableShadows })
    avatar.scale.setScalar(1.15)
    scene.add(avatar)

    // ---- Wandering creatures ----
    type Creature = {
      def: CreatureDef
      group: THREE.Group
      legA: THREE.Object3D
      legB: THREE.Object3D
      legC: THREE.Object3D
      legD: THREE.Object3D
      headPivot: THREE.Object3D
      cur: Vec2
      yaw: number
      phase: number
      speed: number
    }

    const foxBodyMat = track(new THREE.MeshPhongMaterial({ color: C.coral.clone().lerp(C.dirt.clone(), 0.35), flatShading: true, shininess: 0 }))
    const foxBellyMat = track(new THREE.MeshPhongMaterial({ color: C.cream.clone(), flatShading: true, shininess: 0 }))
    const grazerMat = track(new THREE.MeshPhongMaterial({ color: C.rock.clone().lerp(C.cream.clone(), 0.4), flatShading: true, shininess: 0 }))

    const makeFox = () => {
      const g = new THREE.Group()
      const body = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.32, 0.9, 4, 8)), foxBodyMat)
      body.rotation.z = Math.PI / 2
      body.position.y = 0.55
      g.add(body)
      const belly = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.22, 0.7, 3, 6)), foxBellyMat)
      belly.rotation.z = Math.PI / 2
      belly.position.set(0, 0.4, 0)
      g.add(belly)
      const headPivot = new THREE.Group()
      headPivot.position.set(0.65, 0.62, 0)
      const head = new THREE.Mesh(track(new THREE.ConeGeometry(0.3, 0.55, 6)), foxBodyMat)
      head.rotation.z = -Math.PI / 2
      headPivot.add(head)
      const snout = new THREE.Mesh(track(new THREE.ConeGeometry(0.14, 0.28, 5)), foxBodyMat.clone())
      snout.rotation.z = -Math.PI / 2
      snout.position.set(0.32, -0.03, 0)
      headPivot.add(snout)
      const ear = new THREE.Mesh(track(new THREE.ConeGeometry(0.1, 0.18, 4)), foxBodyMat)
      ear.position.set(-0.05, 0.22, 0.12)
      headPivot.add(ear)
      const ear2 = ear.clone()
      ear2.position.z = -0.12
      headPivot.add(ear2)
      g.add(headPivot)
      const tail = new THREE.Mesh(track(new THREE.ConeGeometry(0.14, 0.7, 6)), foxBodyMat)
      tail.position.set(-0.7, 0.55, 0)
      tail.rotation.z = Math.PI / 2.2
      g.add(tail)
      const mkLeg = (x: number, z: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(x, 0.45, z)
        const m = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 5)), foxBodyMat)
        m.position.y = -0.25
        pivot.add(m)
        g.add(pivot)
        return pivot
      }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = enableShadows })
      scene.add(g)
      return { group: g, legA: mkLeg(0.3, 0.2), legB: mkLeg(0.3, -0.2), legC: mkLeg(-0.3, 0.2), legD: mkLeg(-0.3, -0.2), headPivot }
    }

    const makeGrazer = () => {
      const g = new THREE.Group()
      // Round "potato" body.
      const bodyGeo = track(new THREE.IcosahedronGeometry(0.7, 0))
      bodyGeo.scale(1.2, 0.85, 1.1)
      const body = new THREE.Mesh(bodyGeo, grazerMat)
      body.position.y = 0.8
      g.add(body)
      const head = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.34, 0)), grazerMat)
      head.position.set(0.85, 0.95, 0)
      g.add(head)
      const horn = (z: number) => {
        const h = new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.25, 4)), grazerMat.clone())
        h.position.set(0.78, 1.2, z)
        h.rotation.z = -0.3
        g.add(h)
      }
      horn(0.16); horn(-0.16)
      const mkLeg = (x: number, z: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(x, 0.55, z)
        const m = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.08, 0.6, 6)), grazerMat)
        m.position.y = -0.3
        pivot.add(m)
        g.add(pivot)
        return pivot
      }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = enableShadows })
      scene.add(g)
      return { group: g, legA: mkLeg(0.35, 0.32), legB: mkLeg(0.35, -0.32), legC: mkLeg(-0.35, 0.32), legD: mkLeg(-0.35, -0.32), headPivot: g }
    }

    // Mix of foxes and grazers roaming near the player.
    const defs: CreatureDef[] = [
      { id: 0, type: 'fox', seed: 1.1 },
      { id: 1, type: 'fox', seed: 2.7 },
      { id: 2, type: 'grazer', seed: 4.2 },
      { id: 3, type: 'grazer', seed: 5.9 },
      { id: 4, type: 'fox', seed: 7.3 },
      { id: 5, type: 'grazer', seed: 8.8 },
    ]
    const creatures: Creature[] = defs.map((d) => {
      const m = d.type === 'fox' ? makeFox() : makeGrazer()
      // Deterministic spawn around the player on dry ground.
      const ang = d.seed * Math.PI * 2
      const rad = 26 + (d.seed % 3) * 12
      const sx = positionRef.current.x + Math.cos(ang) * rad
      const sz = positionRef.current.z + Math.sin(ang) * rad
      return {
        def: d,
        ...m,
        cur: { x: sx, z: sz },
        yaw: ang,
        phase: d.seed * 3,
        speed: d.type === 'fox' ? 1.2 : 0.7,
      }
    })

    const findDryPointNear = (px: number, pz: number, minR: number, maxR: number, seed: number) => {
      for (let i = 0; i < 18; i++) {
        const a = hash01(seed + i * 13.7) * Math.PI * 2
        const r = minR + hash01(seed + i * 7.3) * (maxR - minR)
        const x = px + Math.cos(a) * r
        const z = pz + Math.sin(a) * r
        if (onDryGround(x, z) && !LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + 3)) return { x, z }
      }
      return { x: px + minR, z: pz }
    }

    // ---- Objects the explorer can carry ----
    // Each object is visible in the landscape until the player picks it up.
    const handItem = new THREE.Group()
    handItem.position.set(0.18, -0.55, 0.18)
    handItem.rotation.set(0.35, 0.2, -0.25)
    armPivotR.add(handItem)

    const crystalMat = track(new THREE.MeshPhongMaterial({ color: C.sky.clone().lerp(C.cream.clone(), 0.35), flatShading: true, shininess: 80 }))
    const flowerHeadMat = track(new THREE.MeshPhongMaterial({ color: C.coral.clone(), flatShading: true, shininess: 0 }))
    const flowerStemMat = track(new THREE.MeshPhongMaterial({ color: C.grassLight.clone(), flatShading: true, shininess: 0 }))
    const crystalGeo = track(new THREE.OctahedronGeometry(0.28, 0))
    const flowerHeadGeo = track(new THREE.IcosahedronGeometry(0.17, 0))
    const flowerStemGeo = track(new THREE.CylinderGeometry(0.035, 0.05, 0.52, 5))

    const heldCrystal = new THREE.Mesh(crystalGeo, crystalMat)
    heldCrystal.position.y = -0.12
    heldCrystal.visible = false
    handItem.add(heldCrystal)
    const heldFlower = new THREE.Group()
    const heldStem = new THREE.Mesh(flowerStemGeo, flowerStemMat)
    heldStem.position.y = -0.26
    const heldHead = new THREE.Mesh(flowerHeadGeo, flowerHeadMat)
    heldHead.position.y = 0.08
    heldFlower.add(heldStem, heldHead)
    heldFlower.visible = false
    handItem.add(heldFlower)

    type Pickup = { name: string; kind: 'KRYSTAL' | 'KVĚT'; group: THREE.Group; x: number; z: number; picked: boolean }
    const pickupSeeds: { name: string; kind: Pickup['kind']; seed: number }[] = [
      { name: 'Modrý krystal', kind: 'KRYSTAL', seed: 14.7 },
      { name: 'Květ ozvěny', kind: 'KVĚT', seed: 28.2 },
      { name: 'Modrý krystal', kind: 'KRYSTAL', seed: 43.6 },
      { name: 'Květ ozvěny', kind: 'KVĚT', seed: 57.1 },
    ]
    const pickups: Pickup[] = pickupSeeds.map((def, index) => {
      // Leave one small item close to the initial path so the carrying mechanic
      // is discoverable immediately. The rest are scattered further afield.
      const p = index === 0
        ? { x: positionRef.current.x + 3, z: positionRef.current.z }
        : findDryPointNear(positionRef.current.x, positionRef.current.z, 10, 44, def.seed)
      const group = new THREE.Group()
      if (def.kind === 'KRYSTAL') {
        const gem = new THREE.Mesh(crystalGeo, crystalMat)
        gem.position.y = 0.38
        group.add(gem)
      } else {
        const stem = new THREE.Mesh(flowerStemGeo, flowerStemMat)
        stem.position.y = 0.26
        const head = new THREE.Mesh(flowerHeadGeo, flowerHeadMat)
        head.position.y = 0.61
        group.add(stem, head)
      }
      group.position.set(p.x, heightAt(p.x, p.z), p.z)
      scene.add(group)
      return { ...def, group, x: p.x, z: p.z, picked: false }
    })

    ;(window as unknown as { __echoesTakeItem?: () => void }).__echoesTakeItem = () => {
      if (heldItemRef.current) {
        setPickupHint(`Už držíš: ${heldItemRef.current}`)
        return
      }
      const pos = positionRef.current
      const nearby = pickups
        .filter((item) => !item.picked)
        .map((item) => ({ item, distance: Math.hypot(item.x - pos.x, item.z - pos.z) }))
        .filter((candidate) => candidate.distance < 3.4)
        .sort((a, b) => a.distance - b.distance)[0]
      if (!nearby) {
        setPickupHint('Přijdi blíž k modrému krystalu nebo květu')
        return
      }
      const item = nearby.item
      item.picked = true
      item.group.visible = false
      heldItemRef.current = item.name
      heldCrystal.visible = item.kind === 'KRYSTAL'
      heldFlower.visible = item.kind === 'KVĚT'
      setHeldItem(item.name)
      setPickupHint(`Držíš: ${item.name}`)
    }

    // ---- Bird flock for atmosphere ----
    const birdMat = track(new THREE.MeshLambertMaterial({ color: C.rock.clone().multiplyScalar(1.2), flatShading: true, fog: true }))
    const birdGeo = track(new THREE.ConeGeometry(0.18, 0.5, 4))
    const birds: { mesh: THREE.Mesh; pivot: THREE.Group; ang: number; radius: number; y: number; speed: number; flap: number }[] = []
    const birdN = isMobile ? 7 : 12
    const flockCenter = new THREE.Vector3(positionRef.current.x, 30, positionRef.current.z - 60)
    for (let i = 0; i < birdN; i++) {
      const pivot = new THREE.Group()
      pivot.position.copy(flockCenter)
      const mesh = new THREE.Mesh(birdGeo, birdMat)
      const ang = (i / birdN) * Math.PI * 2
      const radius = 8 + (i % 3) * 4
      mesh.position.set(Math.cos(ang) * radius, (i % 2 ? 1 : -1) * 2, Math.sin(ang) * radius)
      mesh.rotation.y = ang
      pivot.add(mesh)
      scene.add(pivot)
      birds.push({ mesh, pivot, ang, radius, y: 30 + (i % 3) * 3, speed: 0.18 + (i % 3) * 0.05, flap: i })
    }

    // ---- Camera + renderer ----
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / (mount.clientHeight || 1), 0.1, 2000)
    const dpr = Math.min(window.devicePixelRatio || 1, width < 640 ? 1 : width < 1200 ? 1.5 : 2)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' })
    renderer.setPixelRatio(dpr)
    renderer.setSize(mount.clientWidth, mount.clientHeight || 720, false)
    renderer.shadowMap.enabled = enableShadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    })
    ro.observe(mount)

    // Pointer drag to rotate the camera (no pointer lock).
    let dragging = false
    let lastX = 0
    const onDown = (e: PointerEvent) => {
      dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      camYawRef.current -= dx * 0.005
    }
    const onUp = (e: PointerEvent) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId) } catch { /* noop */ } }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    // Day/night palettes (derived from token colors via lerp, no hard literals).
    const nightSky = C.sky.clone().lerp(new THREE.Color('hsl(218,40%,12%)'), 0.82)
    const nightSkyLight = C.skyLight.clone().lerp(new THREE.Color('hsl(220,35%,22%)'), 0.85)
    const dawnSky = C.sky.clone().lerp(C.coral.clone(), 0.34)
    const dawnSkyLight = C.skyLight.clone().lerp(C.sun.clone(), 0.25)
    const duskSky = C.sky.clone().lerp(C.coral.clone().lerp(C.dirt.clone(), 0.4), 0.45)
    const duskSkyLight = C.skyLight.clone().lerp(C.coral.clone().lerp(C.dirt.clone(), 0.5), 0.3)

    const lerpColor = (out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) => out.copy(a).lerp(b, t)

    const camTarget = new THREE.Vector3()
    const lookAtTarget = new THREE.Vector3()
    let raf = 0
    let last = performance.now()
    let lastDistUpdate = 0
    let lastTimeUpdate = 0
    const DAY_SECONDS = 420 // a calm, seven-minute full day/night cycle

    const updateDayCycle = (dt: number) => {
      dayTimeRef.current = (dayTimeRef.current + dt / DAY_SECONDS) % 1
      const t = dayTimeRef.current // 0/1 = midnight, 0.5 = noon
      // Sun elevation: cos over [0,1]; positive during day half.
      const sunAngle = (t - 0.25) * Math.PI * 2 // 0.25 -> sunrise, 0.75 -> sunset
      const sunElev = Math.sin(sunAngle) // -1..1
      const horizon = Math.cos(sunAngle) // east->west sweep
      const skyR = 900
      sunSphere.position.set(horizon * skyR, sunElev * skyR * 0.9 + 20, -skyR * 0.4)
      sunSphere.visible = sunElev > -0.05
      moonSphere.position.set(-horizon * skyR, -sunElev * skyR * 0.9 + 20, -skyR * 0.4)
      moonSphere.visible = sunElev < 0.05

      // Blend top/bottom sky colors through dawn/day/dusk/night.
      const top = new THREE.Color()
      const bottom = new THREE.Color()
      const e = clamp((sunElev + 0.18) / 0.36, 0, 1) // 0 night .. 1 full day
      const low = Math.abs(horizon) // 0 at noon/midnight, 1 at horizon
      const horiz = clamp(1 - sunElev * 4, 0, 1) // glow near sunrise/sunset
      if (sunElev < -0.18) {
        top.copy(nightSky); bottom.copy(nightSkyLight)
      } else if (sunElev < 0.18) {
        // Dawn (horizon>0) vs dusk (horizon<0): tint with warm zón
        const warm = horizon >= 0 ? dawnSky : duskSky
        const warmL = horizon >= 0 ? dawnSkyLight : duskSkyLight
        lerpColor(top, warm, C.sky, e)
        lerpColor(bottom, warmL, C.skyLight, e)
      } else {
        top.copy(C.sky); bottom.copy(C.skyLight)
      }
      skyMat.uniforms.top.value.copy(top)
      skyMat.uniforms.bottom.value.copy(bottom)
      scene.background.copy(bottom)
      scene.fog!.color.copy(bottom)

      // Light intensities: direct sun fades across the horizon, moonlight up at night.
      const dayAmt = clamp((sunElev + 0.05) / 0.35, 0, 1)
      sun.intensity = dayAmt * 1.15
      // Direction follows the visible disc so shadows stay grounded.
      const sx = sunSphere.position.x
      const sy = Math.max(sunSphere.position.y, 40)
      const sz = sunSphere.position.z
      sun.position.set(sx, sy, sz)
      // Warm/dawn shift to the sun color so dusk reads golden.
      const sunCol = C.sun.clone()
      if (horiz > 0.4) sunCol.lerp(C.coral.clone(), (horiz - 0.4) * 0.6)
      sun.color.copy(sunCol)
      moonLight.intensity = (1 - dayAmt) * 0.35
      ambient.intensity = 0.1 + dayAmt * 0.18
      hemi.intensity = 0.4 + dayAmt * 0.6
      hemi.color.copy(top)
      hemi.groundColor.copy(C.grass.clone().multiplyScalar(0.5 + dayAmt * 0.5))

      // Stars fade in at night.
      starMat.opacity = clamp(-sunElev * 2.2 - 0.1, 0, 0.9)

      return { t, sunElev, dayAmt }
    }

    const animate = (time: number) => {
      const dt = clamp((time - last) / 1000, 0, 0.05)
      last = time
      const keys = keysRef.current

      const turn = 1.7 * dt
      if (keys.has('q') || keys.has('arrowleft')) camYawRef.current += turn
      if (keys.has('e') || keys.has('arrowright')) camYawRef.current -= turn

      const cy = camYawRef.current
      const sin = Math.sin(cy), cos = Math.cos(cy)
      const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
      const str = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0)
      let vx = sin * fwd + cos * str
      let vz = cos * fwd - sin * str
      const moving = (vx !== 0 || vz !== 0) && (fwd !== 0 || str !== 0)
      const pos2 = positionRef.current

      const terrainY = heightAt(pos2.x, pos2.z)
      const inWater = surfaceAt(pos2.x, pos2.z) === 'water'
      const groundY = Math.max(terrainY, WATER_LEVEL)

      if (moving) {
        const len = Math.hypot(vx, vz) || 1
        vx /= len; vz /= len
        const baseSpeed = inWater ? 3.4 : keys.has('shift') ? 11 : 6
        const speed = baseSpeed * dt
        const nextX = pos2.x + vx * speed
        const nextZ = pos2.z + vz * speed
        // Trees, rocks, logs, standing stones and buildings stop movement.
        // Water remains passable so the existing swimming behaviour works.
        if (!hasBlockingScenery(nextX, nextZ, isMobile)) {
          pos2.x = nextX
          pos2.z = nextZ
          distanceRef.current += speed
        }
        const targetYaw = Math.atan2(vx, vz)
        const d = Math.atan2(Math.sin(targetYaw - avatarYawRef.current), Math.cos(targetYaw - avatarYawRef.current))
        avatarYawRef.current += d * (1 - Math.exp(-dt * 12))
      }

      // Stream chunks around the explorer so travel never hits an edge.
      ensureTilesAround(pos2.x, pos2.z)

      if (inWater) {
        animRef.current += dt * (moving ? 7 : 4)
        const paddle = Math.sin(animRef.current)
        legPivotL.rotation.x = paddle * 0.5 - 0.35
        legPivotR.rotation.x = -paddle * 0.5 - 0.35
        armPivotL.rotation.x = -paddle * 0.7
        armPivotR.rotation.x = paddle * 0.7
      } else if (moving) {
        animRef.current += dt * (keys.has('shift') ? 13 : 9)
        swingRef.current = Math.sin(animRef.current) * 0.55
        legPivotL.rotation.x = swingRef.current
        legPivotR.rotation.x = -swingRef.current
        armPivotL.rotation.x = -swingRef.current * 0.8
        armPivotR.rotation.x = swingRef.current * 0.8
      } else {
        swingRef.current *= Math.pow(0.001, dt)
        legPivotL.rotation.x = swingRef.current
        legPivotR.rotation.x = -swingRef.current
        armPivotL.rotation.x = -swingRef.current * 0.8
        armPivotR.rotation.x = swingRef.current * 0.8
      }

      let avatarY: number
      if (inWater) {
        jumpVelocityRef.current = 0
        jumpHeightRef.current = 0
        const swimBob = Math.sin(animRef.current * 1.3) * 0.12
        avatarY = WATER_LEVEL - 0.8 + swimBob
        avatar.rotation.x = -0.5
      } else {
        // Simple, responsive jump arc. The player always returns to the
        // terrain height even while crossing the streamed tile boundaries.
        if (jumpHeightRef.current > 0 || jumpVelocityRef.current > 0) {
          jumpVelocityRef.current -= 20 * dt
          jumpHeightRef.current = Math.max(0, jumpHeightRef.current + jumpVelocityRef.current * dt)
          if (jumpHeightRef.current === 0) jumpVelocityRef.current = 0
        }
        const walkBob = moving ? Math.abs(Math.sin(animRef.current)) * 0.06 : 0
        avatarY = groundY + 0.02 + walkBob + jumpHeightRef.current
        avatar.rotation.x = 0
      }
      avatar.position.set(pos2.x, avatarY, pos2.z)
      avatar.rotation.y = avatarYawRef.current
      ;(window as unknown as { __echoesJumpHeight?: number }).__echoesJumpHeight = jumpHeightRef.current

      if (flagMesh) flagMesh.rotation.y = Math.sin(time * 0.004) * 0.4
      if (flameMesh) {
        const f = 1 + Math.sin(time * 0.012) * 0.18
        flameMesh.scale.set(f, 1 + Math.sin(time * 0.016) * 0.16, f)
      }

      // Move the sun shadow frustum with the explorer so streaming tiles stay lit.
      sun.target.position.set(pos2.x, 0, pos2.z)

      // ---- Creature roaming ----
      const creatureReadout: { x: number; z: number; type: string }[] = []
      for (const c of creatures) {
        // Gentle wander, biased to keep near the player.
        const distToPlayer = Math.hypot(c.cur.x - pos2.x, c.cur.z - pos2.z)
        if (distToPlayer > 70) {
          const np = findDryPointNear(pos2.x, pos2.z, 30, 55, c.def.seed + time * 0.001)
          c.cur.x = np.x
          c.cur.z = np.z
          c.phase = c.def.seed + time * 0.001
        }
        const wob = Math.sin(time * 0.0006 + c.phase) * 0.8
        const nx = c.cur.x + Math.cos(c.yaw) * c.speed * dt
        const nz = c.cur.z + Math.sin(c.yaw) * c.speed * dt
        let nxA = nx
        let nzA = nz
        // Steer off water and away from steep banks; never enter the river.
        if (!onDryGround(nxA, nzA)) {
          c.yaw += 1.6 + wob
          nxA = c.cur.x
          nzA = c.cur.z
        } else {
          c.yaw += wob * dt * 0.4
          c.cur.x = nxA
          c.cur.z = nzA
        }
        const gy = Math.max(heightAt(c.cur.x, c.cur.z), WATER_LEVEL + 0.1)
        c.group.position.set(c.cur.x, gy, c.cur.z)
        c.group.rotation.y = c.yaw
        // Idle/easy leg swing and a subtle head nod.
        const gait = Math.sin(time * 0.006 + c.phase) * 0.35
        c.legA.rotation.x = gait
        c.legC.rotation.x = -gait
        c.legB.rotation.x = -gait
        c.legD.rotation.x = gait
        c.headPivot.rotation.y = Math.sin(time * 0.0015 + c.phase) * 0.3
        creatureReadout.push({ x: c.cur.x, z: c.cur.z, type: c.def.type })
      }
      ;(window as unknown as { __echoesCreatures?: { x: number; z: number; type: string }[] }).__echoesCreatures = creatureReadout

      // ---- Bird flock: lazily circles high above the explorer ----
      flockCenter.set(pos2.x, birds[0].y, pos2.z - 50)
      for (const b of birds) {
        b.ang += b.speed * dt
        b.pivot.position.lerp(flockCenter, 1 - Math.exp(-dt * 0.8))
        b.mesh.position.set(Math.cos(b.ang) * b.radius, Math.sin(b.flap + time * 0.01) * 0.4, Math.sin(b.ang) * b.radius)
        b.mesh.rotation.y = -b.ang + Math.PI / 2
        b.mesh.rotation.z = Math.sin(time * 0.02 + b.flap) * 0.5
      }

      // A slightly wider, forward-looking view keeps the horizon, river and
      // nearby objects visible instead of aiming almost straight into grass.
      const camDist = inWater ? 9 : 13
      const camHeight = inWater ? 5.5 : 8
      const lookH = inWater ? 1.0 : 1.2
      const lookAhead = inWater ? 8 : 14
      const lookX = pos2.x + sin * lookAhead
      const lookZ = pos2.z + cos * lookAhead
      const lookY = Math.max(heightAt(lookX, lookZ), WATER_LEVEL) + lookH
      camTarget.set(pos2.x - sin * camDist, avatarY + camHeight, pos2.z - cos * camDist)
      camera.position.lerp(camTarget, 1 - Math.exp(-dt * 7))
      lookAtTarget.set(lookX, lookY, lookZ)
      camera.lookAt(lookAtTarget)

      const newStatus = inWater ? 'PLAVÁNÍ' : 'CHŮZE'
      if (newStatus !== statusRef.current) {
        statusRef.current = newStatus
        setStatus(newStatus)
      }

      if (time - lastDistUpdate > 240) {
        lastDistUpdate = time
        setDistance(Math.round(distanceRef.current * 1.4))
      }

      // Update the time-of-day HUD ~2x/sec.
      updateDayCycle(dt)
      if (time - lastTimeUpdate > 520) {
        lastTimeUpdate = time
        const elev = Math.sin((dayTimeRef.current - 0.25) * Math.PI * 2)
        let s: typeof timeState = 'NOC'
        if (elev > 0.65) s = 'POLEDNE'
        else if (elev > 0.25) s = 'DEN'
        else if (elev > 0.05) s = 'ODPOLEDNE'
        else if (elev > -0.05) s = dayTimeRef.current < 0.5 ? 'SVÍTÁ' : 'STÍN'
        else if (elev > -0.2) s = 'ŠERO'
        else if (elev > -0.4) s = 'SOU MRÁČKŮ'
        else s = 'NOC'
        setTimeState(s)
      }

      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }

    // Initial camera placement (no lerp on first frame).
    const startCy = camYawRef.current
    const startY = heightAt(positionRef.current.x, positionRef.current.z)
    const startLookX = positionRef.current.x + Math.sin(startCy) * 14
    const startLookZ = positionRef.current.z + Math.cos(startCy) * 14
    camera.position.set(
      positionRef.current.x - Math.sin(startCy) * 13,
      startY + 8,
      positionRef.current.z - Math.cos(startCy) * 13,
    )
    camera.lookAt(startLookX, Math.max(heightAt(startLookX, startLookZ), WATER_LEVEL) + 1.2, startLookZ)
    raf = requestAnimationFrame(animate)
    setReady(true)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      tiles.forEach((t) => disposeTile(t))
      tiles.clear()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose?.()
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose())
          else (m.material as THREE.Material).dispose()
        }
      })
      collect.forEach((c) => c.dispose())
      delete (window as unknown as { __echoesTakeItem?: () => void }).__echoesTakeItem
      delete (window as unknown as { __echoesCreatures?: { x: number; z: number; type: string }[] }).__echoesCreatures
      delete (window as unknown as { __echoesJumpHeight?: number }).__echoesJumpHeight
      renderer.dispose()
    }
  }, [])

  useEffect(() => {
    const isFormEl = (el: Element | null) =>
      el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'q', 'e', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' '].includes(key)) {
        if (key === ' ') {
          if (!isFormEl(document.activeElement) && jumpHeightRef.current === 0 && jumpVelocityRef.current === 0) {
            event.preventDefault()
            const pos = positionRef.current
            if (surfaceAt(pos.x, pos.z) !== 'water') jumpVelocityRef.current = 7.2
          }
          return
        }
        if (key === 'f') {
          if (!isFormEl(document.activeElement)) { event.preventDefault(); pickUp() }
          return
        }
        event.preventDefault()
        keysRef.current.add(key)
      }
    }
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [pickUp])

  const key = (name: string, active: boolean) => {
    if (active) keysRef.current.add(name)
    else keysRef.current.delete(name)
  }

  return (
    <main className="min-h-screen bg-game-rock font-[Georgia,serif] text-game-cream">
      <section
        ref={mountRef}
        className="relative mx-auto min-h-screen max-w-[1600px] overflow-hidden bg-game-rock touch-none select-none"
        data-testid="world"
        data-state={ready ? 'ready' : 'loading'}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Otevřený 3D svět Údolí ozvěn" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_46%,hsl(var(--game-rock)/0.4))]" />

        <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4 sm:p-6">
          <div className="flex items-center gap-3 rounded-2xl border border-game-cream/35 bg-game-rock/80 px-4 py-3 shadow-2xl backdrop-blur-md">
            <img
              src={LOGO_URL}
              alt="Logo Údolí ozvěn"
              width={42}
              height={42}
              className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-game-sun/40"
            />
            <div>
              <p className="text-[9px] font-bold tracking-[0.32em] text-game-sun">OTEVŘENÝ SVĚT</p>
              <h1 className="mt-1 text-xl font-black leading-none sm:text-2xl">Údolí ozvěn</h1>
            </div>
          </div>
          <div className="rounded-2xl border border-game-cream/30 bg-game-rock/80 px-4 py-3 text-right shadow-2xl backdrop-blur-md">
            <p className="text-[9px] font-bold tracking-[0.2em] text-game-cream/60">VÝPRAVA</p>
            <p className="mt-0.5 text-sm font-bold">
              <span className="text-game-sun">{visited.length}</span> / {LANDMARKS.length} míst
            </p>
            <p className="text-[10px] text-game-cream/65">{distance} metrů</p>
          </div>
        </header>

        <div
          data-testid="world-status"
          className="absolute left-1/2 top-5 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-game-cream/35 bg-game-rock/80 px-3 py-1.5 shadow-xl backdrop-blur-md"
        >
          <span className={`h-2 w-2 rounded-full animate-pulse ${status === 'PLAVÁNÍ' ? 'bg-game-sky' : 'bg-game-grass-light'}`} />
          <span className="text-[10px] font-bold tracking-[0.28em] text-game-cream">{status}</span>
        </div>

        <div
          data-testid="world-time"
          className="absolute right-4 top-20 z-20 rounded-2xl border border-game-cream/35 bg-game-rock/80 px-3 py-2 text-right shadow-xl backdrop-blur-md sm:p-6 sm:top-6 sm:left-1/2 sm:right-auto sm:translate-x-[min(220px,42vw)]"
        >
          <p className="text-[9px] font-bold tracking-[0.28em] text-game-sun">Časová doba</p>
          <p className="mt-0.5 text-xs font-black tracking-wide text-game-cream sm:text-sm">{timeState}</p>
        </div>

        <aside className="absolute bottom-4 left-4 z-20 sm:bottom-7 sm:left-7">
          <div data-testid="inventory" className="rounded-2xl border border-game-cream/35 bg-game-rock/85 p-3 shadow-2xl backdrop-blur-md">
            <p className="text-[9px] font-bold tracking-[0.24em] text-game-sun">V RUCE</p>
            <p data-testid="held-item" className="mt-1 text-sm font-bold text-game-cream">{heldItem ?? 'nic'}</p>
            <p className="mt-1 max-w-52 text-[10px] leading-relaxed text-game-cream/70">{pickupHint}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                data-testid="pickup-action"
                type="button"
                onClick={pickUp}
                className="rounded-xl bg-game-coral px-3 py-2 text-xs font-bold tracking-wide text-game-cream shadow-lg transition hover:-translate-y-0.5 hover:bg-game-sun hover:text-game-rock focus:outline-none focus-visible:ring-2 focus-visible:ring-game-sun"
              >
                SEBRAT <span className="ml-1 rounded bg-game-rock/20 px-1">F</span>
              </button>
              <button
                data-testid="map-toggle"
                type="button"
                onClick={() => setShowMap((v) => !v)}
                className="rounded-xl border border-game-cream/30 bg-game-cream/10 px-3 py-2 text-xs font-bold tracking-wide text-game-cream transition hover:bg-game-cream/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-game-sun"
              >
                MAPA
              </button>
            </div>
          </div>
        </aside>

        <div className="absolute bottom-5 right-5 z-20 grid grid-cols-3 gap-1 rounded-2xl border border-game-cream/30 bg-game-rock/80 p-2 shadow-2xl backdrop-blur-md sm:hidden">
          <span />
          <Control label="↑" ariaLabel="Vpřed" onStart={() => key('w', true)} onEnd={() => key('w', false)} />
          <span />
          <Control label="↺" ariaLabel="Otočit doleva" onStart={() => key('q', true)} onEnd={() => key('q', false)} />
          <Control label="↓" ariaLabel="Vzad" onStart={() => key('s', true)} onEnd={() => key('s', false)} />
          <Control label="↻" ariaLabel="Otočit doprava" onStart={() => key('e', true)} onEnd={() => key('e', false)} />
        </div>

        <p className="absolute bottom-5 right-7 z-20 hidden rounded-xl bg-game-rock/75 px-3 py-2 text-[10px] font-bold tracking-wider text-game-cream/80 backdrop-blur sm:block">
          WASD POHYB · MEZERNÍK SKOK · F SEBRAT · Q/E OTÁČENÍ KAMERY · TAHEM MYŠI OTÁČET
        </p>

        {showMap && <WorldMap visited={visited} onClose={() => setShowMap(false)} />}
      </section>
    </main>
  )
}

function Control({ label, ariaLabel, onStart, onEnd }: { label: string; ariaLabel: string; onStart: () => void; onEnd: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={onStart}
      onPointerUp={onEnd}
      onPointerLeave={onEnd}
      onPointerCancel={onEnd}
      className="grid h-10 w-10 place-items-center rounded-lg bg-game-grass text-game-cream shadow-lg active:bg-game-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-game-sun"
    >
      {label}
    </button>
  )
}

function WorldMap({ visited, onClose }: { visited: string[]; onClose: () => void }) {
  // The map is an Orientační náčrt (sketch) — open-ended, with fixed landmarks.
  // It deliberately shows no world edge because the valley continues forever.
  const VIEW = 200
  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center bg-game-rock/70 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Orientační náčrt Údolí ozvěn"
    >
      <div className="relative w-full max-w-lg rounded-[2rem] border border-game-cream/35 bg-game-cream p-6 text-game-rock shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg bg-game-rock px-3 py-1 text-xs font-bold text-game-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-game-sun"
        >
          ZAVŘÍT
        </button>
        <p className="text-[10px] font-bold tracking-[0.28em] text-game-coral">ORIENTAČNÍ NÁČRT</p>
        <h2 className="mt-1 text-2xl font-black">Údolí ozvěn</h2>
        <p className="mt-1 text-xs leading-relaxed text-game-rock/75">
          Údolí pokračuje za obzor a den se zde střídá s nocí, takže mapa nezobrazuje žádnou hranici světa. Je to jen náčrt, který ti pomůže najít tři pevná místa.
        </p>

        <div className="relative mt-5 aspect-square overflow-hidden rounded-2xl border-4 border-game-rock bg-game-grass-light">
          <svg className="absolute inset-0 h-full w-full" viewBox="-VIEW -VIEW 2*VIEW 2*VIEW" preserveAspectRatio="none" aria-hidden="true">
            <path
              d={Array.from({ length: 81 }, (_, i) => {
                const x = -VIEW + (i * 2 * VIEW) / 80
                return `${i === 0 ? 'M' : 'L'} ${x} ${riverCenter(x)}`
              }).join(' ')}
              fill="none"
              stroke="hsl(var(--game-sky))"
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.85"
            />
          </svg>
          {LANDMARKS.map((p) => {
            const left = ((p.x + VIEW) / (2 * VIEW)) * 100
            const top = ((p.z + VIEW) / (2 * VIEW)) * 100
            const done = visited.includes(p.name)
            return (
              <div
                key={p.name}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                <div
                  className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-black shadow-md ${done ? 'border-game-rock bg-game-sun text-game-rock' : 'border-game-cream bg-game-rock text-game-cream'}`}
                >
                  {done ? '✓' : '•'}
                </div>
              </div>
            )
          })}
          <div className="absolute left-[54%] top-[42%] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-game-cream bg-game-coral shadow-md" title="Tvoje poloha" />
          <div className="absolute right-2 top-2 rounded-md bg-game-cream/80 px-2 py-1 text-[9px] font-bold tracking-wide text-game-rock/70">
            MĚŘÍTKO ~ ORIENTAČNÍ
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {LANDMARKS.map((p) => {
            const done = visited.includes(p.name)
            return (
              <li key={p.name} className="flex items-center justify-between rounded-xl bg-game-grass-light/70 px-3 py-2">
                <span className="text-sm font-bold">{p.name}</span>
                <span className={`text-[10px] font-bold tracking-wider ${done ? 'text-game-coral' : 'text-game-rock/60'}`}>
                  {done ? 'PROZKOUMÁNO' : 'NEPROZKOUMÁNO'}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-game-rock/80">
          Modrá stuha je řeka, po které můžeš plavat — k prozkoumání místa ale doplav k břehu. Najdi všechna tři pevná místa, přibliž se k nim a stiskni Prozkoumat, abys objevil jejich příběh. Větší tvorové se potulují okolím, takže je občas potkáš na cestách.
        </p>
      </div>
    </div>
  )
}

export default App
