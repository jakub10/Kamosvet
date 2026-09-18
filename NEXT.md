# NEXT.md

Instructions for the next step. `dream-world-brief.md` remains the design
authority; this file records decisions made since milestone 1 and defines
what to build now.

## Settled decisions

- **View distance: keep it short.** Fog is the horizon. A visible edge
  destroys the mystery. Do not raise it to remove the fog.
- **Trace depth: constant.** A path does not deepen with repeated use.
  Current behaviour is correct — leave it.
- **Panel language: Czech.** UI strings only. Code, comments and
  documentation stay English.
- **Git: not yet initialised.** Owner is aware. Until it is, be careful:
  there is no way back from a bad change.

## New core principle — the world grows with the person

This is an addition to the brief and it outranks the milestone below.

A player entering for the first time finds **nothing**. Not a quiet
world — an empty one. As their life in Kamosféra accumulates, elements
appear: sky, then clouds, then light, then relief, then ground cover,
then trees, then stranger things. The world is not revealed to them. It
is grown by them.

How this must be built:

- Every element of the world carries a **presence scalar**, 0 to 1,
  derived from the deviation vector. Zero means the element does not
  exist at all and costs nothing to draw.
- Presence is **continuous, never a switch**. Elements fade in over their
  whole range. At 0.1 an element is a suggestion, at 0.5 it is present
  but thin, at 1.0 it is fully itself. Nothing may pop into existence.
- Presence is **monotonic in practice** but must not be assumed
  irreversible in code — treat it as a value that can move either way.
- Elements arrive in a fixed order, so that two players at different
  stages still recognise the same world. The intended order:

      sky → clouds → cloud shadows → light and colour → relief
      → ground cover → trees → stranger things

- **Nothing is hand-placed, ever.** Growth means an element's presence
  rises, not that objects get added to a scene.
- Each element must be cheap at zero and must not be constructed until
  its presence rises above zero.

Only the first three of that list are in scope now. But write the
presence mechanism as a general facility, because every element after
this one will use it.

## Ground responds to everyone at once

Terrain height must never take an individual player's deviation vector —
that would break the shared-ground rule. It takes a **party deviation**:
a deterministic mix of the vectors of everyone currently present. Both
players compute the same mix, so both stand on the same ground. With one
player present, the mix is that player.

The base terrain must be latent rather than flat: low-frequency
undulation at an amplitude that is barely perceptible, which the party
deviation scales up. The ground never gains new shapes — it only wakes
the ones already sleeping in it. This is `relief` in the order above and
is not built yet; the height function should simply be shaped so it can
accept it later.

## Milestone 2 — the sky

1. **Shared world clock.** A single authoritative time source that
   everything animated reads from. Cheap now, and required by everything
   that follows.

2. **Sky.** Procedural, no assets. Presence-gated: at zero the player is
   in featureless fog, exactly as now.

3. **Clouds.** A drifting field driven by the same single wind field as
   everything else in the world. Personal layer — cover, palette and
   light angle come from the player's own deviation vector.

4. **Cloud shadows on the ground.** Travelling shade across the plain.
   This is the main visual payoff of the milestone: an empty plain under
   moving shadow reads as alive, and it costs almost nothing.

5. **Runtime controls** for every new value — presence of each element,
   cloud cover, wind, light angle, palette, fog distance. The owner tunes
   by eye and cannot tune what he cannot reach.

Ground cover comes after this, not before. It is the one planned item
that can break the cost-scales-with-screen rule, so it should not be
first.

## Unchanged prohibitions

Mechanics · objectives or scoring · menus and UI decoration · hand-placed
landmarks · baked terrain · an interesting base world · persisted world
state · additional dependencies.
