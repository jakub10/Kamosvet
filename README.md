# Dream World

A fog world that grows with the person walking in it. See
`dream-world-brief.md` for what this is, `NEXT.md` for the decisions and the
current instructions, and `CLAUDE.md` for how it is worked on.

## Running it

Double-click **`start.cmd`**. It serves the folder on
`http://localhost:8123/` and opens a browser there. Close the console
window to stop it.

A server is needed only because browsers refuse to load ES modules from a
`file://` path. There is no build step, no install, no dependencies to
fetch: three.js is checked in under `vendor/`. `serve.py` sends everything
with no-store, so what is on screen is always what is on disk.

## Controls

| | |
|---|---|
| click the world | enter (mouse look) |
| `W A S D` / arrows | walk |
| `Shift` | run |
| `Esc` | release the mouse |
| `H` | hide or show the panel |

The panel on the right changes the world while it runs. Top left is the
frame cost, always on screen. Panel text is Czech; everything else here is
English.

## What is here

- **Growth is a place, not a dial.** Each element carries a presence from 0
  to 1, and they arrive in a fixed order — sky, clouds, cloud shadows, then
  light, relief, ground cover, trees and stranger things, none of which are
  built yet. Growth itself is only the ceiling a person's life allows. The
  world actually wakes **where they have walked**: the same trace points
  that dent the ground also feed a wide bloom field, and every pixel of
  ground asks that field how awake its own patch is. Ahead and to the
  sides there is still nothing, and at growth zero, or before the first
  step, nothing above the ground is even constructed.

  The sky decides per direction: each one asks the bloom field about the
  ground a short way along it, so the sky opens over the walked line and
  stays shut over the Nothing. The ground takes its **relief** the same
  way — hills rise where people have walked — but through the party mix
  rather than one person's own vector, so two people always stand on the
  same hill.
- **Ground** — shared. A quiet height field, plus the depressions left by
  traces. Drawn as a disc of fixed vertex count that follows the camera, so
  the cost is the same whether you walk one metre or ten kilometres. Its
  swell is latent: the party deviation, a mix of everyone present, is what
  will wake it when relief is built.
- **Traces** — shared. Points with an age and a strength, saved in the
  browser and reloaded next time. Fresh ones are deepest; they settle to a
  permanent imprint rather than healing. The depth is the deepest trace at
  that spot, never the sum, so a path stays a path.
- **Sky and clouds** — personal, and painted rather than simulated: flat
  bands with hard edges, one enormous disc of light hanging in them, clouds
  as silhouettes. One cloud field is read twice — the sky shader meets it
  along the view ray, the ground shader meets it walking towards the light —
  which is why the shade on the plain belongs to the cloud overhead.
- **Ground cover** — the first thing here at human scale, and the one
  element that could break the cost rule, because blades per square metre
  of world grow without limit. So the count is fixed: two lattices ride
  with the camera, one blade to a cell, each placed by a hash of the
  cell's own world coordinates — which is what keeps blades standing still
  while the lattice slides underneath. Walk a kilometre and exactly as
  many are drawn as when you started. Blades behind the walker's head are
  dropped before the expensive half of the shader runs.
- **Regions, and one broken law.** A coarse lattice divides the world and
  a hash says what holds in each cell. At the moment there are two states:
  the bowl, and nothing. In a bowl the ground lifts as it goes away from
  the middle, so the place has a floor and the walker stands inside it
  instead of on an endless plain; past the rim it falls back to the shared
  ground, which is what lets the next region be something else. It shapes
  the surface, so like relief it comes through the party mix — two people
  in the same bowl stand on the same slope or the ground is not shared.
- **One enormous thing.** A coarse lattice covers the world and a hash
  decides which cells hold something, where it stands and how big it is.
  Nothing this size stands within four hundred metres of you: close up it
  stopped being a landmark and became a wall.
  The nearest one is tested analytically against each view ray in the sky
  shader — no geometry, no draw call, and it costs less than one octave of
  noise. It is not gated by the bloom: it stands on the far world, and
  something to walk towards is the point of it.
- **Air** — personal. Colour, light, fog, wind and surface grain, all
  driven by a deviation vector hashed from an identity string. The palette
  is keyed rather than clashing: the ground carries the world's hue, the
  sky sits beside it and is lighter and quieter so the ground stays
  dominant, and one element contradicts them both — the light, which is
  always warm. Only the fog is nearly colourless, because the fog is the
  Nothing. Change the identity, or press *jiný den*, and the same person
  walks into a different world. None of it touches the ground.

## The shape of the code

    src/world.js      the world function itself, in JS and in GLSL
    src/clock.js      one time source, and the wrapping that keeps it exact
    src/presence.js   how much of the world exists yet, and in what order
    src/deviation.js  identity -> a handful of numbers -> a palette
    src/clouds.js     one cloud field, read by the sky and by the ground
    src/traces.js     the point store, and the two fields drawn from it
    src/region.js     where one law of reality stops holding
    src/cover.js      ground cover, at a fixed count however far you walk
    src/monument.js   the one enormous thing, hashed out of the world
    src/gputimer.js   what the card actually took
    src/terrain.js    the ground mesh and its shader
    src/sky.js        the dome, built only once there is a sky
    src/player.js     one body, walking
    src/ui.js         the tuning panel and the frame cost readout
    src/main.js       wiring and the frame loop

`world.js` is the authority. Its JS and GLSL halves compute the same thing
and have to be changed together: the JS half answers where the ground is
for collision, the GLSL half draws it, and a server will later need to
agree with both.

### Time never reaches a shader

A 32-bit float loses whole seconds once the number grows large, and a
pattern that drifts by adding time to a coordinate eventually jumps. So
shaders are given phases and offsets, never a clock, and every field they
are added to is periodic — the pattern repeats exactly every 256 lattice
cells, which is hundreds of kilometres, far past the fog. `clock.js` wraps
each offset into that period in double precision. After a year of drift the
numbers reaching the GPU are still small, and nothing has ever jumped.

## Known limits

- **Clouds are smaller and lower than real ones.** The fog closes at a
  hundred-odd metres and an honest cloud casts a shadow far wider than
  that, which would read as the whole plain dimming at once rather than
  shade crossing it.
- **Traces thin out past 6000 points** (about 3 km of walking). The oldest
  are dropped. Traces are meant to persist for ever, so this holds only
  until they live on a server instead of in the browser.
- **The world is not multiplayer yet.** Nothing here holds world state, and
  the clock and the party mix are both in place for when it is.

### What the frame cost means

The readout is the time **the card** took, asked for with a timer query,
next to the time spent in JavaScript. It used to show only the second
number, which on this world is under a millisecond while the card is doing
twenty — an instrument that lies sends you looking in the wrong place.

Hardware antialiasing is off by default: at 2.7 megapixels on integrated
graphics it cost sixteen milliseconds of an *empty* frame, and this world
draws its own edges in the shader. The panel can turn it back on, and can
change how many pixels the card is asked for.

`window.dreamworld` exposes the running pieces for inspection.
