# Dream World — status for planning

Written for whoever writes the next instructions. Precedence, as recorded
in `CLAUDE.md`: `dream-world-brief.md` is the authority, `NEXT.md` holds
the settled decisions, `growth-and-look.md` overrides the brief's
aesthetic rules and sets the next step.

**5 September 2026.** Everything named in `growth-and-look.md` is now
built except one thing, and that one thing is what needs deciding.

**The owner's verdict, in his words: "much better", and the grass is
"OK for now".** The look question that blocked the last report is
answered — see section 4.

---

## 1. Where we are

Fourteen modules, ~2850 lines, one dependency, no build step, ten commits.

Walk and the world wakes behind you: the ground takes colour and grain
along the walked line, hills rise around the walker over hundreds of
metres, grass stands where it has woken, the sky opens overhead, cloud
shadows cross the plain, and one enormous thing stands on the horizon to
walk towards. Step off the path and it is all still the Nothing.

Built elements, in the order they arrive: sky, clouds, cloud shadows,
relief, ground cover, monument. Unbuilt: light (in the order but never
gated — light simply always exists), trees, "stranger things".

| | |
|---|---|
| Frame cost | 7–9 ms on the card at 0.65 Mpx; the owner sees ~24 ms at 1.65 Mpx |
| Scene | ~105k triangles, 4 draw calls, 25k blades of cover |
| Instrument | GPU timer query; the readout is what the card took, beside what the code took |

### Non-negotiables, audited

| Rule | State |
|---|---|
| Base world quiet, nothing hand-placed | Holds. Cover, monuments and relief are all hashed out of lattices. |
| Ground shared, air personal | Holds. Relief reaches the height function only through the party mix; cover is air and has no collision. |
| Cost scales with screen area | Holds, and cover was the test of it: the blade count is fixed, so a kilometre of walking draws exactly what the first step drew. |
| Traces persist | Holds, still capped at 6000 points in the browser. |

---

## 2. What was built since the last report

The four fixes that were asked for, in order, then ground cover.

- **Quantisation removed** from shadow, sky and fog. It was one cause with
  three faces — camouflage on the ground, stripes overhead, fog as a
  blurred wall. Flat colour is kept only where a real silhouette exists.
- **Depth is read by lightness.** Wide value range from the face turned to
  the light to the one turned away, near ground darker than far, and
  aerial perspective on top so each ridge is paler than the one in front.
  Relief was raised and its wavelength shortened so several ridges fall
  inside the fog at once, and the fog was let out to match.
- **Relief wakes broadly.** It answers to a third field, 260 m wide and
  slow, rather than to the bloom the colour uses. Sharing a radius with
  the path had built an embankment along the trail with the path's own
  groove down its crest.
- **Ground cover.** Two camera-following lattices, one blade to a cell,
  each placed by a hash of the cell's own world coordinates. Tufts rather
  than even spacing, and blades that arch — a straight blade with a wide
  foot reads as a thorn, which is what the owner called "a hedgehog".
- **The monument** was moved to a minimum of 420 m and thinned to one
  every two kilometres or so, and given the same haze as the ridges. Close
  up it had stopped being a landmark and become a wall.

---

## 3. The one thing left, and the decision it needs

`growth-and-look.md` asks for **one law of reality suspended per region,
held without exception** — gravity sideways, scale ten times what it
should be, colour with nothing to do with light, distance that does not
shorten as you approach. It calls this the grammar of every reference
film and says it is cheaper than detail. **Nothing of it is built.**

It is also, honestly, the thing that would deliver an item already
reported as done. The revision says growth must *change what kind of world
this is*, not amplify — "an element at 0.3 and the same element at 0.9
should not be the same shape at different strengths". Relief, as built,
raises a swell that was already there. It is amplification. The broken law
is the first thing on the list that would actually be a transformation.

### Decision one: which law

Three that this engine can carry for almost nothing:

| | What the walker sees | Cost |
|---|---|---|
| **Gravity pulls sideways** | Grass, cloud and dust lean permanently one way as though the world were tilted, while the horizon stays level | Lowest. One term in two shaders. |
| **Scale is ten times wrong** | Grass to the waist, tufts as bushes, the monument a mountain. Reads as having been shrunk rather than as the world being large | Low. A multiplier on sizes, but every size must obey it or it reads as a bug. |
| **The horizon does not behave** | The ground lifts in the distance into a shallow bowl, so the region has a floor and the walker stands in it | Low in code, largest in effect, and the most Neverending Story of the three. |

### Decision two: region, or person

This one has a hard constraint attached.

- **Region** — the law belongs to the place, everyone there sees it, and
  it is a property of the world. If it touches the surface at all (the
  bowl does; sideways gravity on grass does not) it **must** go through
  the party mix, or two people stand on different ground and a
  non-negotiable breaks.
- **Person** — the law belongs to the walker and travels with them.
  Then it may only touch the air: colour, light, wind, the size of things
  that have no collision. The bowl is not available under this reading.

### What has to be built either way

There is no concept of a *region* in the code yet. It needs one: a coarse
hash lattice, as the monument already uses, saying which law holds where,
plus a rule for the boundary. The revision says "held without exception",
which argues for a hard edge; walking across a hard edge in a continuous
world is jarring, so a narrow blend is the likely compromise and is worth
stating explicitly rather than leaving to the shader.

That lattice is the actual work. The law itself is a few lines once it
exists.

---

## 4. Answered, and worth writing down

- **Stylised or beautiful-through-realism** — settled in practice by the
  last instruction list. Quantisation came out, atmospheric depth went in,
  and the owner's response was that it is much better. The direction is
  atmospheric and value-led, not flat-poster. `growth-and-look.md` still
  reads as though flat colour and hard edges are the target, and should be
  corrected so the next round does not re-litigate it.
- **The colour rule's wording versus its examples** — the build follows
  the films: one dominant hue on the ground, the sky lighter and quieter
  beside it, the single contradiction carried by a light that is always
  warm. The revision's own words ("opposed", "clash", both at full
  saturation) produced something the owner called frightening.

## 5. Still open, smaller

- **Palette: generated or curated?** The vector rotates a hue wheel, which
  guarantees variety and not taste. A small set of made palettes with the
  vector choosing among them would breach nothing — that rule is about the
  world, not the paint.
- **The monument has no shape.** It stands correctly in the air and is a
  tapered slab. The revision wanted a door, a staircase to nowhere, a tree
  with no visible top.
- **The path is a smear, not a road.** It is the only landmark the walker
  makes themselves, and it reads as a soft darkening.
- **Traces cap at 6000 points**, browser-side. Blocked on a backend
  decision.
- **Kamosféra identities.** Growth is a hand-set number waiting for them.

---

## 6. Deliberately not done

Mechanics · objectives or scoring · menus and UI decoration · hand-placed
landmarks · baked terrain · an interesting base world · persisted world
state · additional dependencies.

---

## 7. File map

    src/world.js      the world function, in JS and in GLSL — the authority
    src/clock.js      one time source, and the wrapping that keeps it exact
    src/presence.js   how much of the world exists, and in what order
    src/deviation.js  identity -> a handful of numbers -> a palette; party mix
    src/clouds.js     one cloud field, read by the sky and by the ground
    src/traces.js     the point store and the three fields drawn from it
    src/cover.js      ground cover, at a fixed count however far you walk
    src/monument.js   the one enormous thing, hashed out of the world
    src/terrain.js    the ground mesh and its shader
    src/sky.js        the painted dome, built only once there is a sky
    src/gputimer.js   what the card actually took
    src/player.js     one body, walking
    src/ui.js         the tuning panel and the frame cost readout
    src/main.js       wiring and the frame loop
