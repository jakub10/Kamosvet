# Dream World — design brief

A shared 3D world for a co-operative game linked to Kamosféra, a social
network. This document defines what the world *is*. Game mechanics are
deliberately absent and will be added later.

## The one idea

The world is not content. It is a rule.

    world(x, z, t) = base(x, z, t) + Σ deviation(player)

`base` is identical for everyone and is deliberately quiet. Everything
worth looking at comes from the deviation term, which is supplied by the
people present. A world with nobody in it should be close to nothing.

This is the load-bearing decision. If `base` is dramatic on its own, the
human contribution becomes invisible and the whole design collapses into
an ordinary procedural landscape.

## Starting state

Pale, near-featureless fog. Ground is barely legible underfoot — enough
to know you are standing on something, not enough to call it a place.
No horizon, no landmarks, no objects.

The world resolves where players walk, and what resolves stays.

## Layer separation — hard rule

| Layer | Contents | Scope |
|---|---|---|
| Ground | terrain, walkable surface, traces, anything with collision | **Shared.** Identical for every player. |
| Air | colour, light, weather, wind character, density and shape of detail | **Personal.** Differs per player. |

Two players standing in the same spot must agree on where the ground is
and where the traces are. They may disagree on everything else. Never
let a personal deviation move a surface someone can stand on.

## Deviation source

Each player carries a small vector of constants — a handful of numbers,
not a world. It is derived by hashing their Kamosféra identity: posts,
connections, activity. The same person at a different time produces a
different vector, which is intended: the world they walk into is not the
one they left.

The vector feeds coefficients inside the world function — amplitudes,
frequencies, bend, colour ramps, wind character. Players never place
objects. They change constants.

## Traces

Where a player passes, the world deforms and does not fully recover.
Traces are the only landmarks that will ever exist here, so they must be
readable at a distance and must persist across sessions.

Store traces as a sparse set of points with an age and a strength. Never
store generated geometry.

## Aesthetic rules

These are not decoration. They are what makes a nearly empty world look
composed rather than unfinished.

- **One wind field.** A single coherent field drives every moving thing.
  Coherence of motion is what reads as "alive" — not object count.
- **One light.** One direction, soft or no shadows.
- **Few colours.** Six or fewer, related, shifted as a whole by the
  personal layer. A wide palette reads as an unfinished game; a narrow
  one reads as painted.
- **Silhouette over detail.** Suggest form. Do not model it.
- **Fog is the horizon.** It is the aesthetic and it is also what hides
  the fact that nothing further out exists yet.

## Cost model

Cost must scale with screen area, not with world size. One metre of
world and ten kilometres of world cost the same.

Target: two players, mid-range laptop, comfortable frame rate. When
something must give, give up view distance first, then detail density.
Never give up motion coherence — a sparse world that moves as one whole
beats a dense one that stutters.

## Do not

- Do not bake terrain into textures or heightmaps at load.
- Do not build per-object geometry for ground cover.
- Do not hand-place any landmark, structure, or point of interest.
- Do not make the base world interesting.
- Do not add objectives, scoring, or win conditions.
- Do not persist the world. Persist only the player vectors and traces.

## First milestone

A walkable empty fog world for one player. Traces persist. The deviation
vector is editable at runtime so its effect can be seen immediately.

Nothing else.
