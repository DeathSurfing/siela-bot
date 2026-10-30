const storedGuildId = localStorage.getItem("siela.selectedGuildId");

export const state = {
  authenticated: false,
  user: null,
  oauth: false,
  password: false,
  csrfToken: null,
  guilds: [],
  guildId: storedGuildId,
  view: "overview",
  status: null,
  data: null,
  permissions: { administrator: false },
  loading: false,
  error: null,
  featureErrors: {},
  pendingFeatures: new Set(),
  search: "",
  casinoResult: null,
  casinoPending: null,
  casinoBusy: false,
  economyBusy: false,
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
