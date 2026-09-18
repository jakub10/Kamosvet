// kamosfera.js — the one door between Kamosféra and this world.
//
// Kamosvět has no account of its own. A person arrives from Kamosféra with
// their session in the URL fragment, and this module asks Kamosféra's
// database one question: `world_seed()`. The answer is a distillation of a
// life — who (nickname, avatar), how much of the world that life allows
// (growth), the shape of their attention (traits), who their friends are,
// and how much time they have shared with each. Never a name, an e-mail,
// a message, a post, or a place.
//
// The seed is fetched with plain fetch(): no client library, no dependency,
// in keeping with the rest of this project. The fragment is scrubbed from
// the address bar as soon as it is read, so the token is not left lying in
// history or in a shared screenshot.
//
// Without a seed the world still runs — as the Nothing, growth 0, for the
// panel and for tuning. That is not a fallback. A world nobody has lived
// in is supposed to be empty.

import { KAMOSFERA_URL, KAMOSFERA_ANON_KEY } from './kamosfera.config.js';

const SESSION_KEY = 'kamosvet.session.v1';

// Kamosféra opens this world as  …/#access_token=…&expires_at=…
function readFragment() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const token = params.get('access_token');
  if (!token) return null;
  const expiresAt = Number(params.get('expires_at') || 0);
  // Leave the address bar clean.
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return { token, expiresAt };
}

function loadSession() {
  const fresh = readFragment();
  if (fresh) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(fresh)); } catch (err) { /* private mode */ }
    return fresh;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (saved && saved.token && (!saved.expiresAt || saved.expiresAt * 1000 > Date.now())) {
      return saved;
    }
  } catch (err) { /* nothing saved */ }
  return null;
}

/**
 * The seed, or null when nobody arrived from Kamosféra.
 *
 * Shape (version 1):
 *   identity   stable opaque key — hashed into the deviation vector
 *   name       nickname, what other players see
 *   avatar_url
 *   epoch      season index; the same person next season gets a shifted world
 *   growth     0..1, how much of the world this life allows
 *   traits     { kindness, breadth, supportive, rhythm, mood|null }  0..1
 *   conduct    { withdrawn, blocked_by }  — kept apart from growth on purpose
 *   friends    [{ identity, name, avatar_url }]
 *   shared     [{ with, weight }]
 */
export async function loadSeed() {
  const session = loadSession();
  if (!session) return null;

  try {
    const res = await fetch(`${KAMOSFERA_URL}/rest/v1/rpc/world_seed`, {
      method: 'POST',
      headers: {
        'apikey': KAMOSFERA_ANON_KEY,
        'Authorization': `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: '{}',
    });
    if (!res.ok) {
      console.warn('kamosfera: world_seed refused', res.status);
      return null;
    }
    const seed = await res.json();
    return seed && seed.version === 1 ? seed : null;
  } catch (err) {
    console.warn('kamosfera: unreachable', err);
    return null;
  }
}

/** Seeds of the friends who may share this ground, for the party mix. */
export async function loadFriendSeeds(seed) {
  if (!seed || !Array.isArray(seed.friends) || seed.friends.length === 0) return [];
  const session = loadSession();
  if (!session) return [];

  const one = async (identity) => {
    try {
      const res = await fetch(`${KAMOSFERA_URL}/rest/v1/rpc/world_seed`, {
        method: 'POST',
        headers: {
          'apikey': KAMOSFERA_ANON_KEY,
          'Authorization': `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _user_id: identity }),
      });
      return res.ok ? await res.json() : null;
    } catch (err) {
      return null;
    }
  };

  const seeds = await Promise.all(seed.friends.map((f) => one(f.identity)));
  return seeds.filter(Boolean);
}
