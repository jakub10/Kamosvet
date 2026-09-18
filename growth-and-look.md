# Growth and look — revision to the brief

This replaces the **Aesthetic rules** section of `dream-world-brief.md`
and rewrites how growth works. Everything else in that brief stands:
ground shared, air personal, cost scales with screen area, nothing
hand-placed, nothing baked, no mechanics yet.

The original aesthetic rules produced a quiet naturalistic world. That
was faithful to what was written and it is not what this project is.
The reference points are Neverending Story, Inside Out, Soul, Coraline,
Mirrormask, Big Fish, Stardust.

## The empty world is correct — it is the Nothing

A world with nobody in it is not a quiet meadow. It is emptiness: fog,
no sky, no ground worth the name. This part of the build is right and
should not be softened.

The player is not a visitor to this world. They are the reason it comes
back.

## Growth is transformation, not amplification

The mistake being corrected: growth was raising amplitudes — taller
hills, thicker cloud. That produces more of the same world.

Growth must instead **change what kind of world this is**. Cloud breaks
apart and a forest stands where it was. A waterfall falls upward. A road
appears and turns off to nowhere. The unfolding of a fractal, not the
turning up of a dial.

Practically: each element's presence controls not only *how much* of it
exists but *what it is*. An element at 0.3 and the same element at 0.9
should not be the same shape at different strengths.

## Growth is spatial — the world blooms along the path

Growth is not a global slider. It happens **where the player walks**.

Traces and presence are the same mechanism. Behind the player the world
does not dent — it comes alive, and stays alive. Ahead and to the sides
there is still nothing. The bloom spreads outward from the walked line
and falls off with distance from it.

This gives the world its landmarks for free: the only places that exist
are the places people have been, and they look like what those people
are.

Ground that blooms this way is still shared. Relief raised along a path
uses the **party deviation**, never one player's own vector, exactly as
already specified.

## One broken law per region, held without exception

A dream is not vague. It is precise and wrong.

The deviation vector should choose, for a region, **which law of reality
does not apply there** — and that law is then broken consistently
everywhere in that region. Gravity pulls sideways. Scale is ten times
what it should be. Colour has nothing to do with light. Water falls
upward. Distance does not shorten as you approach.

One law, broken completely, beats many things bent slightly. This is the
grammar of every reference film above and it is cheaper than detail.

## Scale before quantity

Nothing produces awe as cheaply as size. A door as tall as a tower. A
staircase into the sky that leads nowhere. A tree whose top is not
visible.

One enormous thing on the horizon does more than a thousand small ones,
and costs less. This does not violate the no-hand-placing rule: the rule
generates it, the same way it generates everything else.

## Look

- **Few colours, but contradictory.** The earlier rule asked for related
  colours; that makes tasteful landscape painting. Keep the palette
  small, but let it clash — saturated, opposed, unnatural.
- **The sky is painted, not simulated.** Bands, one enormous impossible
  sunset, one large thing hanging in it. Flat areas of colour, not a
  photographic dome with volumetric cloud.
- **Silhouette, flat colour, hard edge.** None of the reference works
  tries to look real. This is also cheaper than what is currently built.
- **Impossible geography is allowed and wanted.** A path that turns and
  goes nowhere. A horizon that does not behave.
- **Fog stays** — as the edge of the Nothing, not as atmosphere.

## What this means for the next milestone

Ground cover as previously planned is no longer the right next step. It
was a naturalism task. Propose instead:

1. **Bloom along the path.** Wire presence to the trace field so growth
   happens where the player has walked, falling off with distance.
2. **One transformation, end to end.** Pick a single element and make it
   genuinely change with presence rather than merely intensify. Relief is
   the cheapest candidate — it is already wired for the party mix.
3. **One enormous thing.** Generated from the rule, visible from far,
   different for different vectors.

Do these three before anything else. If the world does not feel like it
is coming alive behind the player, no amount of ground cover will fix it.
