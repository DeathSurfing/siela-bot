const storedGuildId = localStorage.getItem("siela.selectedGuildId");

export const state = {
  authenticated: false,
  csrfToken: null,
  guilds: [],
  guildId: storedGuildId,
  view: "overview",
  status: null,
  data: null,
  loading: false,
  error: null,
  featureErrors: {},
  pendingFeatures: new Set(),
  search: "",
};

export function updateState(patch) {
  Object.assign(state, patch);
  window.dispatchEvent(new CustomEvent("dashboard:state"));
}

export function rememberGuild(guildId) {
  state.guildId = guildId || null;
  if (guildId) localStorage.setItem("siela.selectedGuildId", guildId);
  else localStorage.removeItem("siela.selectedGuildId");
}
