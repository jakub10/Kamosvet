# CLAUDE.md

## Read first

`dream-world-brief.md` defines what this project is. Read it before
writing anything. It is the design authority; this file only covers how
to work here.

When the documents disagree: `dream-world-brief.md` is the authority,
`NEXT.md` holds the decisions already settled, and `growth-and-look.md`
overrides the brief's aesthetic rules and sets the next step.

## Who you are working with

The owner does not write code and will not debug for you. He judges the
project by looking at it. This has consequences:

- Keep `main` runnable at all times. A broken build is invisible
  progress and he has no way to recover it.
- Explain changes in plain language, not diffs. "The wind now bends the
  ground cover" — not "refactored the vertex displacement pass".
- Never ask him to inspect a console, read a stack trace, or diagnose a
  black screen. If something needs verifying, build a visible control
  for it.
- When you need a decision, describe the two outcomes and what each
  costs. He decides well when he can picture the result.

Working language is Slovak in conversation, English in code, comments
and docs.

## Kamosféra

This world is fed by Kamosféra (repo `jakub10/kamosfera`) through one
function, `world_seed()`, read by `src/kamosfera.js`. Do not read
anything else from that database, and do not widen what the seed
carries without changing the privacy test on the other side. Identity
crosses (nickname, avatar, friends); content never does.

## Non-negotiables

These come from the brief. If a change would break one, stop and ask.

1. The base world stays quiet. No hand-placed features, ever.
2. Ground is shared, air is personal. No personal deviation may move a
   surface with collision.
3. Cost scales with screen area, not world size. Nothing gets baked,
   nothing accumulates in memory as the player walks.
4. Traces persist. Player vectors persist. The world itself never does.

## Shape of the code

- Browser, WebGL, three.js. No build step unless it becomes unavoidable.
- No art assets. No textures, models or audio files. Everything is
  computed.
- Dependencies: three.js and nothing else without asking first.
- The world is a set of pure deterministic functions of position, time
  and the deviation vector. Same inputs, same output, always. Keep them
  free of global state so they can later run identically on a server.
- Multiplayer is not built yet, but the world functions must be written
  as if two clients will have to agree. Do not hide state inside the
  renderer.

## How to work

- Small steps that end in something visible. Prefer shipping one working
  layer over half of three.
- Build the runtime controls early — deviation vector, wind, palette,
  fog. Tuning by hand is how this project gets good, and he cannot tune
  what he cannot reach.
- Show frame cost on screen from day one. Performance decisions are
  design decisions here.
- Do not expand scope. No mechanics, objectives, UI chrome, menus,
  scoring or multiplayer until the brief says so.
- If a task is ambiguous, ask before building. A wrong week costs more
  than a question.

## Current milestone

Walkable empty fog world, one player, persistent traces, editable
deviation vector. Nothing beyond that.
