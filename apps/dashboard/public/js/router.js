export const VIEWS = ["overview", "servers", "features", "music", "cah", "tambola", "casino", "economy", "leaderboard", "stocks", "settings", "user", "audit", "commands"];

const SHORTCUTS = {
  o: "overview",
  s: "servers",
  f: "features",
  m: "music",
  h: "cah",
  b: "tambola",
  d: "casino",
  e: "economy",
  l: "leaderboard",
  k: "stocks",
  t: "settings",
  u: "user",
  a: "audit",
  c: "commands",
};

export function parseRoute(hash) {
  const match = hash.replace(/^#/, "").match(/^\/g\/([^/]+)\/([^/]+)$/);
  if (match && VIEWS.includes(match[2])) {
    return { guildId: decodeURIComponent(match[1]), view: match[2] };
  }
  const view = hash.replace(/^#\/?/, "").split("/")[0];
  return { guildId: null, view: VIEWS.includes(view) ? view : "overview" };
}

export function navigate(view, guildId) {
  if (!VIEWS.includes(view)) return;
  location.hash = guildId ? `/g/${encodeURIComponent(guildId)}/${view}` : `/${view}`;
}

export function writeRoute(view, guildId, replace = false) {
  if (!VIEWS.includes(view)) return;
  const hash = guildId ? `#/g/${encodeURIComponent(guildId)}/${view}` : `#/${view}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else location.hash = hash;
  }
}
