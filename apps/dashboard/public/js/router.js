export const VIEWS = ["overview", "servers", "features", "music", "settings", "audit", "commands"];

const SHORTCUTS = {
  o: "overview",
  s: "servers",
  f: "features",
  m: "music",
  t: "settings",
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

export function installKeyboardShortcuts(onViewChange, focusSearch, openHelp) {
  let waitingForView = false;
  let chordTimer;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const dialog = document.querySelector("dialog[open]");
      if (dialog) dialog.close();
      return;
    }
    const target = event.target;
    const editing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "/") {
      event.preventDefault();
      focusSearch();
      return;
    }
    if (waitingForView) {
      waitingForView = false;
      clearTimeout(chordTimer);
      const view = SHORTCUTS[event.key.toLowerCase()];
      if (view) onViewChange(view);
      return;
    }
    if (event.key.toLowerCase() === "g") {
      waitingForView = true;
      chordTimer = setTimeout(() => { waitingForView = false; }, 1200);
    }
    if (event.key === "?") openHelp();
  });
}
