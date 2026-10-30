import { api, ApiError, setCsrfToken } from "./api.js";
import { navigate, parseRoute, writeRoute } from "./router.js";
import { installHotkeys } from "./vendor/hotkeys.js";
import { rememberGuild, state } from "./store.js";
import { escapeHtml, fmtTrackTime, initialOf, renderLivePanel, renderLogin, renderStatusPill, renderView, viewTitle } from "./views.js";

const boot = document.querySelector("#boot-state");
const loginScreen = document.querySelector("#login-screen");
const shell = document.querySelector("#app-shell");
const rail = document.querySelector("#app-rail");
const railToggle = document.querySelector("#rail-toggle");
const navDrawer = document.querySelector("#nav-drawer");
const navDrawerBody = document.querySelector("#nav-drawer-body");
const navToggle = document.querySelector("#nav-toggle");
const compactNav = window.matchMedia("(max-width: 700px)");
const main = document.querySelector("#main-content");
const guildPickerButton = document.querySelector("#guild-picker-button");
const guildPickerName = document.querySelector("#guild-picker-name");
const guildPickerAvatar = document.querySelector("#guild-picker-avatar");
const guildPickerMenu = document.querySelector("#guild-picker-menu");
const dialog = document.querySelector("#help-dialog");
const themeIcon = document.querySelector("#theme-icon");
let loadSequence = 0;
let currentRoute = { view: "overview", guildId: null };
let progressTimer = null;
let gamePoll = null;
let gamePollSequence = 0;
const RAIL_COLLAPSED_KEY = "siela.rail.collapsed";
let railCollapsed = false;
try { railCollapsed = localStorage.getItem(RAIL_COLLAPSED_KEY) === "1"; } catch { /* storage may be blocked */ }

function applyRailCollapsed(collapsed = railCollapsed) {
  railCollapsed = Boolean(collapsed);
  shell.classList.toggle("is-rail-collapsed", railCollapsed);
  if (railToggle) {
    const label = railCollapsed ? "Expand sidebar" : "Collapse sidebar";
    railToggle.setAttribute("aria-label", label);
    railToggle.setAttribute("aria-expanded", String(!railCollapsed));
    railToggle.setAttribute("title", label);
  }
  try { localStorage.setItem(RAIL_COLLAPSED_KEY, railCollapsed ? "1" : "0"); } catch { /* storage may be blocked */ }
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("siela.theme", next); } catch { /* storage may be blocked */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#0a0a0a" : "#f6f6f4");
  if (themeIcon) {
    themeIcon.src = next === "dark" ? "/icons/sun.svg" : "/icons/moon.svg";
    themeIcon.closest("button")?.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  announce(`${document.documentElement.dataset.theme === "light" ? "Light" : "Dark"} theme.`);
}

function showLogin(error = "", oauth = state.oauth, password = state.password) {
  closeNavDrawer({ restoreFocus: false });
  state.authenticated = false;
  state.csrfToken = null;
  state.user = null;
  state.oauth = Boolean(oauth);
  state.password = Boolean(password);
  setCsrfToken(null);
  boot.hidden = true;
  shell.hidden = true;
  loginScreen.hidden = false;
  loginScreen.innerHTML = renderLogin(error, state.oauth, state.password);
  if (state.oauth) loginScreen.querySelector(".login-discord")?.focus();
  else if (state.password) loginScreen.querySelector("#login-password")?.focus();
}

function oauthMessage() {
  const value = new URLSearchParams(location.search).get("oauth");
  if (!value) return "";
  history.replaceState(null, "", location.pathname + location.hash);
  if (value === "denied") return "That Discord account is not allowed to use this dashboard.";
  if (value === "state") return "That Discord sign-in attempt expired. Try again.";
  if (value === "cancelled") return "Discord sign-in was cancelled.";
  return state.password ? "Discord sign-in failed. Try again or use the password." : "Discord sign-in failed. Try again.";
}

function updateUserChip() {
  const chip = document.querySelector("#session-user");
  if (!chip) return;
  const user = state.user;
  chip.hidden = !user;
  if (!user) return;
  const name = user.name || "Operator";
  chip.title = `Open your profile and settings, ${name}`;
  chip.setAttribute("aria-label", `Open your profile and settings, ${name}`);
  const nameNode = document.querySelector("#session-name");
  if (nameNode) nameNode.textContent = name;
  const avatar = document.querySelector("#session-avatar");
  if (avatar) {
    avatar.dataset.initial = initialOf(name);
    avatar.innerHTML = user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy">` : "";
  }
}

function guildLogoMarkup(guild, extra = "") {
  const initial = initialOf(guild?.name);
  const image = guild?.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-guild-icon>` : "";
  return `<span class="guild-logo ${extra}" data-initial="${escapeHtml(initial)}" aria-hidden="true">${image}</span>`;
}

function setAvatar(node, guild) {
  if (!node) return;
  node.dataset.initial = initialOf(guild?.name);
  node.innerHTML = guild?.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-guild-icon>` : "";
}

function updateGuildPicker() {
  if (!guildPickerButton || !guildPickerMenu) return;
  const selected = state.guilds.find((guild) => guild.id === state.guildId) ?? state.guilds[0] ?? null;
  guildPickerButton.disabled = state.guilds.length === 0;
  guildPickerButton.setAttribute("aria-label", selected ? `Select a server, ${selected.name}` : "Select a server");
  if (guildPickerName) guildPickerName.textContent = selected?.name ?? (state.guilds.length ? "Select a server" : "No servers");
  setAvatar(guildPickerAvatar, selected);
  const activeId = state.guildId ?? selected?.id ?? null;
  guildPickerMenu.innerHTML = state.guilds.map((guild) => `<button type="button" class="guild-option" role="option" aria-selected="${guild.id === activeId}" data-guild-id="${escapeHtml(guild.id)}">${guildLogoMarkup(guild, "guild-logo-option")}<span class="guild-option-copy"><strong>${escapeHtml(guild.name ?? "Unnamed server")}</strong><small>${Number(guild.memberCount ?? 0).toLocaleString()} members</small></span></button>`).join("");
}

function openGuildMenu(position = "first") {
  if (!guildPickerMenu || !guildPickerButton || !state.guilds.length) return;
  guildPickerMenu.hidden = false;
  guildPickerButton.setAttribute("aria-expanded", "true");
  const options = [...guildPickerMenu.querySelectorAll('[role="option"]')];
  const target = position === "last" ? options.at(-1) : options[0];
  target?.focus();
}

function closeGuildMenu(restoreFocus = false) {
  if (!guildPickerMenu || !guildPickerButton) return;
  guildPickerMenu.hidden = true;
  guildPickerButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) guildPickerButton.focus();
}

function syncNavPlacement() {
  if (!rail) return;
  const parent = compactNav.matches ? navDrawerBody : shell;
  if (parent && rail.parentElement !== parent) parent.prepend(rail);
}

function openNavDrawer() {
  if (!compactNav.matches || !navDrawer) return;
  closeGuildMenu();
  syncNavPlacement();
  if (!navDrawer.open) navDrawer.showModal();
  navToggle?.setAttribute("aria-expanded", "true");
  const current = navDrawer.querySelector('.primary-nav a[aria-current="page"]');
  (current ?? navDrawer.querySelector(".nav-drawer-close"))?.focus();
}

function closeNavDrawer({ restoreFocus = true } = {}) {
  if (!navDrawer?.open) return;
  navDrawer.close();
  navToggle?.setAttribute("aria-expanded", "false");
  if (restoreFocus && compactNav.matches) navToggle?.focus({ preventScroll: true });
}

navDrawer?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeNavDrawer();
});

navDrawer?.addEventListener("close", () => {
  navToggle?.setAttribute("aria-expanded", "false");
});

navDrawer?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target === navDrawer) {
    closeNavDrawer();
    return;
  }
  const link = target.closest(".primary-nav a, .brand, .rail-user");
  if (!link) return;
  const hash = link.getAttribute("href");
  closeNavDrawer({ restoreFocus: false });
  if (hash && hash === location.hash) main.focus({ preventScroll: true });
});

compactNav.addEventListener("change", (event) => {
  const focusInNav = Boolean(rail?.contains(document.activeElement) || navDrawer?.contains(document.activeElement));
  const focusOnToggle = document.activeElement === navToggle;
  closeNavDrawer({ restoreFocus: false });
  syncNavPlacement();
  if (!focusInNav && !focusOnToggle) return;
  if (event.matches) main.focus({ preventScroll: true });
  else shell.querySelector('.primary-nav a[aria-current="page"]')?.focus({ preventScroll: true });
});

async function selectGuild(guildId) {
  closeGuildMenu(true);
  if (!guildId || guildId === state.guildId) return;
  rememberGuild(guildId);
  writeRoute(currentRoute.view, guildId);
  await loadData({ view: currentRoute.view, guildId });
}

guildPickerButton?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openGuildMenu(event.key === "ArrowUp" ? "last" : "first");
});

guildPickerMenu?.addEventListener("keydown", (event) => {
  const options = [...guildPickerMenu.querySelectorAll('[role="option"]')];
  const index = options.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    closeGuildMenu(true);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
    options[next]?.focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    (event.key === "Home" ? options[0] : options.at(-1))?.focus();
  } else if (event.key === "Tab") {
    closeGuildMenu();
  }
});

function setStatusPill(status) {
  const oldPill = document.querySelector("#bot-status");
  const template = document.createElement("template");
  template.innerHTML = renderStatusPill(status);
  const newPill = template.content.firstElementChild;
  newPill.id = "bot-status";
  const changed = oldPill && oldPill.textContent.trim() !== newPill.textContent.trim();
  oldPill.replaceWith(newPill);
  if (changed) {
    newPill.classList.add("is-changing");
    newPill.addEventListener("animationend", () => newPill.classList.remove("is-changing"), { once: true });
  }
  document.querySelector("#build-version").textContent = status?.version ? `V${status.version}` : "SIELA";
}

function activateShell() {
  boot.hidden = true;
  loginScreen.hidden = true;
  shell.hidden = false;
  syncNavPlacement();
  updateGuildPicker();
}

function renderMain(preserveSearch = false) {
  const previousSearch = preserveSearch ? document.querySelector("#view-search") : null;
  const selectionStart = previousSearch?.selectionStart;
  const selectionEnd = previousSearch?.selectionEnd;
  main.innerHTML = renderView(state.view);
  document.title = `${viewTitle(state.view)} · Siela Control`;
  document.querySelectorAll(".primary-nav a[data-view]").forEach((link) => {
    if (link.dataset.view === state.view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (preserveSearch) {
    const search = document.querySelector("#view-search");
    search?.focus({ preventScroll: true });
    if (typeof selectionStart === "number" && typeof selectionEnd === "number") search?.setSelectionRange(selectionStart, selectionEnd);
  }
}

async function loadData(route = currentRoute) {
  const sequence = ++loadSequence;
  stopProgress();
  stopGamePoll();
  closeGuildMenu();
  state.view = route.view;
  state.featureErrors = {};
  state.voiceChannelId = route.guildId ? (localStorage.getItem(`siela.voice.${route.guildId}`) ?? "") : "";
  state.error = null;
  state.loading = true;
  state.search = "";
  state.casinoResult = null;
  state.casinoPending = null;
  state.casinoBusy = false;
  state.economyBusy = false;
  state.stockBusy = false;
  state.permissions = { administrator: false };
  currentRoute = route;
  updateGuildPicker();
  renderMain();
  const permissionsRequest = route.guildId
    ? api.permissions(route.guildId).catch(() => ({ administrator: false }))
    : Promise.resolve({ administrator: false });
  let statusRequest;
  try {
    if (route.view === "overview") {
      const [status, audit] = await Promise.all([
        api.status(),
        route.guildId ? api.audit(route.guildId, 50).catch((error) => ({ entries: [], error: error instanceof Error ? error.message : "Audit history could not load." })) : Promise.resolve({ entries: [] }),
      ]);
      if (sequence !== loadSequence) return;
      state.status = status;
      state.data = { status, audit };
    } else if (!route.guildId) {
      state.data = null;
      statusRequest = api.status();
    } else {
      const canLoadUserData = /^\d{17,20}$/.test(state.user?.id ?? "");
      const loaders = {
        features: () => api.features(route.guildId),
        music: () => api.music(route.guildId),
        cah: () => api.cah(route.guildId),
        tambola: () => api.tambola(route.guildId),
        casino: () => canLoadUserData
          ? api.casino(route.guildId)
          : Promise.resolve({ enabled: true, balance: null, maxBet: 10_000, discordRequired: true }),
        economy: () => canLoadUserData
          ? api.economy(route.guildId)
          : Promise.resolve({ enabled: true, discordRequired: true }),
        leaderboard: () => canLoadUserData
          ? api.leaderboard(route.guildId)
          : Promise.resolve({ enabled: true, discordRequired: true, entries: [], me: null }),
        stocks: () => canLoadUserData
          ? api.stocks(route.guildId)
          : Promise.resolve({ enabled: true, discordRequired: true, market: null, portfolio: null }),
        settings: () => api.config(route.guildId),
        user: () => canLoadUserData ? api.birthday(route.guildId) : Promise.resolve({ birthday: null }),
        audit: () => api.audit(route.guildId, 50),
        commands: () => api.commands(),
      };
      const loader = loaders[route.view];
      if (loader) state.data = await loader();
      statusRequest = api.status();
    }
    if (statusRequest) {
      try {
        state.status = await statusRequest;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) throw error;
        state.status = null;
      }
    }
    const permissions = await permissionsRequest;
    if (sequence !== loadSequence) return;
    state.permissions = { administrator: permissions?.administrator === true };
    state.error = null;
  } catch (error) {
    if (sequence !== loadSequence) return;
    if (error instanceof ApiError && error.status === 401) {
      showLogin("Your session expired. Sign in again.");
      return;
    }
    state.error = error instanceof Error ? error.message : "The dashboard could not load this view.";
    state.status = null;
  } finally {
    if (sequence === loadSequence && state.authenticated) {
      state.loading = false;
      setStatusPill(state.status);
      renderMain();
      startProgress();
      if (!state.error) startGamePoll();
    }
  }
}

function stopGamePoll() {
  gamePollSequence += 1;
  if (gamePoll) {
    clearInterval(gamePoll);
    gamePoll = null;
  }
}

function startGamePoll() {
  stopGamePoll();
  if (!["cah", "tambola"].includes(state.view) || !state.guildId || document.hidden) return;
  gamePoll = setInterval(() => { void pollGameView(); }, 5000);
}

function fetchGameState() {
  return state.view === "cah" ? api.cah(state.guildId) : api.tambola(state.guildId);
}

function renderGamePanel(force = false) {
  const panel = document.querySelector(`[data-live-panel="${state.view}"]`);
  if (!panel) return false;
  if (!force && panel.contains(document.activeElement)) return false;
  panel.innerHTML = renderLivePanel(state.view, state.data);
  return true;
}

async function pollGameView(force = false) {
  if (document.hidden || !["cah", "tambola"].includes(state.view) || !state.guildId) return;
  const sequence = ++gamePollSequence;
  const view = state.view;
  const guildId = state.guildId;
  try {
    const data = await fetchGameState();
    if (sequence !== gamePollSequence || document.hidden || state.view !== view || state.guildId !== guildId) return;
    const changed = JSON.stringify(data) !== JSON.stringify(state.data);
    state.data = data;
    if (changed || force) renderGamePanel(force);
  } catch {
    // Keep the last good table on a transient poll failure.
  }
}

async function refreshGuilds() {
  const payload = await api.guilds();
  const guilds = Array.isArray(payload?.guilds) ? payload.guilds : [];
  state.guilds = guilds;
  if (!guilds.some((guild) => guild.id === state.guildId)) rememberGuild(guilds[0]?.id ?? null);
  updateGuildPicker();
  const route = parseRoute(location.hash);
  const view = route.view;
  writeRoute(view, state.guildId, true);
  return guilds;
}

async function enterDashboard(csrf, user = null) {
  state.authenticated = true;
  state.csrfToken = csrf;
  state.user = user ?? state.user;
  setCsrfToken(csrf);
  activateShell();
  updateUserChip();
  try {
    await refreshGuilds();
  } catch (error) {
    state.guilds = [];
    state.error = error instanceof Error ? error.message : "The server list could not be loaded.";
  }
  const route = parseRoute(location.hash);
  const guildId = route.guildId && state.guilds.some((guild) => guild.id === route.guildId) ? route.guildId : state.guildId;
  if (guildId !== state.guildId) rememberGuild(guildId);
  writeRoute(route.view, guildId, true);
  await loadData({ view: route.view, guildId });
}

function announce(message) {
  const region = document.querySelector("#announcement");
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = message; });
}

function formatPosition(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setInlineFeedback(section, message, isError = false) {
  const feedback = document.querySelector(`[data-feedback="${CSS.escape(section)}"]`);
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("feedback-error", isError);
}

const RESOLVE_DELAY_MS = 250;
const RESOLVE_SNOWFLAKE = /^\d{17,20}$/;
const resolverRecords = new WeakMap();
let resolverListSequence = 0;
let resolverRequestSequence = 0;

function resolverRecord(input) {
  let record = resolverRecords.get(input);
  if (!record) {
    record = { timer: null, sequence: 0, results: [], active: -1 };
    resolverRecords.set(input, record);
  }
  return record;
}

function resolverQuery(input) {
  const value = input.value.trim();
  if (!input.hasAttribute("data-resolve-append")) return value;
  return value.split(/[\s,]+/).filter(Boolean).at(-1) ?? "";
}

function enhanceResolver(input) {
  if (input.dataset.resolveReady === "1") return;
  input.dataset.resolveReady = "1";
  const list = document.createElement("ul");
  list.className = "resolver-list";
  list.id = `resolver-list-${++resolverListSequence}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  const status = document.createElement("small");
  status.className = "resolved-label";
  status.hidden = true;
  input.after(list, status);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("autocomplete", "off");
}

function closeResolverList(input) {
  const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
  if (list) {
    list.hidden = true;
    list.replaceChildren();
  }
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  const record = resolverRecords.get(input);
  if (record) {
    record.active = -1;
    record.results = [];
  }
}

function closeAllResolverLists() {
  document.querySelectorAll("[data-resolve-ready]").forEach((node) => {
    if (node instanceof HTMLInputElement) closeResolverList(node);
  });
}

function syncResolvedLabel(input) {
  const status = input.parentElement?.querySelector(".resolved-label");
  if (!status || status.hidden) return;
  const values = input.value.split(/[\s,]+/);
  if (!values.includes(status.dataset.forId ?? "")) {
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.forId;
  }
}

function renderResolverOptions(input, record) {
  const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
  if (!list) return;
  if (!record.results.length) {
    closeResolverList(input);
    return;
  }
  list.innerHTML = record.results.map((result, index) => `<li role="option" id="${list.id}-${index}" aria-selected="false" data-resolve-index="${index}"><span class="resolver-label">${escapeHtml(result.label ?? result.name ?? "")}</span>${result.description ? `<small>${escapeHtml(result.description)}</small>` : ""}</li>`).join("");
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function setResolverActive(input, record, index) {
  const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
  if (!list) return;
  const options = [...list.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  record.active = Math.max(0, Math.min(options.length - 1, index));
  options.forEach((option, position) => option.setAttribute("aria-selected", String(position === record.active)));
  const active = options[record.active];
  input.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

async function loadResolverResults(input, record) {
  const query = resolverQuery(input);
  if (!query || RESOLVE_SNOWFLAKE.test(query) || !state.guildId) return null;
  const sequence = ++resolverRequestSequence;
  record.sequence = sequence;
  let payload;
  try {
    payload = await api.resolve(state.guildId, query, input.dataset.resolveKind || undefined);
  } catch {
    if (record.sequence === sequence) record.results = [];
    return null;
  }
  if (record.sequence !== sequence || !input.isConnected) return null;
  record.results = Array.isArray(payload?.results) ? payload.results : [];
  return record.results;
}

async function fetchResolverSuggestions(input, record) {
  const results = await loadResolverResults(input, record);
  if (!results) return;
  if (document.activeElement !== input) return;
  renderResolverOptions(input, record);
}

function handleResolverInput(input) {
  if (!input.dataset.resolveKind) return;
  enhanceResolver(input);
  const record = resolverRecord(input);
  clearTimeout(record.timer);
  closeResolverList(input);
  syncResolvedLabel(input);
  const query = resolverQuery(input);
  if (!query || RESOLVE_SNOWFLAKE.test(query)) return;
  record.timer = setTimeout(() => {
    record.timer = null;
    void fetchResolverSuggestions(input, record);
  }, RESOLVE_DELAY_MS);
}

function selectResolverResult(input, result) {
  const id = String(result?.id ?? "");
  if (!RESOLVE_SNOWFLAKE.test(id)) return;
  if (input.hasAttribute("data-resolve-append")) {
    const values = input.value.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    const query = resolverQuery(input).toLocaleLowerCase();
    if (values.length && query && values.at(-1).toLocaleLowerCase() === query) values.pop();
    if (!values.includes(id)) values.push(id);
    input.value = values.join(", ");
  } else {
    input.value = id;
  }
  const status = input.parentElement?.querySelector(".resolved-label");
  if (status) {
    status.textContent = `${result.label ?? result.name ?? id} · ${id}`;
    status.dataset.forId = id;
    status.hidden = false;
  }
  closeResolverList(input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function exactResolverResult(input, record) {
  const query = resolverQuery(input).replace(/^[#@]/, "").trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = record.results.filter((result) => String(result.name ?? "").toLocaleLowerCase() === query);
  return matches.length === 1 ? matches[0] : null;
}

async function resolveInputValue(input) {
  if (!input.dataset.resolveKind || !state.guildId) return;
  const query = resolverQuery(input);
  if (!query || RESOLVE_SNOWFLAKE.test(query)) return;
  const record = resolverRecord(input);
  const results = await loadResolverResults(input, record);
  if (!results?.length) {
    closeResolverList(input);
    return;
  }
  const match = exactResolverResult(input, record) ?? (results.length === 1 ? results[0] : null);
  if (match) selectResolverResult(input, match);
  else closeResolverList(input);
}

function singleResolverResult(results, query) {
  const term = query.toLocaleLowerCase();
  const exact = results.filter((result) => String(result.name ?? "").toLocaleLowerCase() === term);
  if (exact.length === 1) return exact[0];
  return results.length === 1 ? results[0] : null;
}

async function resolveSingle(kind, raw) {
  const value = String(raw ?? "").trim();
  if (RESOLVE_SNOWFLAKE.test(value)) return { id: value };
  const query = value.replace(/^[#@]/, "").trim();
  if (!query || !state.guildId) return null;
  let payload;
  try {
    payload = await api.resolve(state.guildId, query, kind);
  } catch {
    return null;
  }
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const match = singleResolverResult(results, query);
  const id = String(match?.id ?? "");
  return RESOLVE_SNOWFLAKE.test(id) ? { ...match, id } : null;
}

document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.resolveKind) enhanceResolver(target);
});

document.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.resolveReady) return;
  const next = event.relatedTarget;
  if (next instanceof Node && target.parentElement?.contains(next)) return;
  void resolveInputValue(target);
  setTimeout(() => {
    if (document.activeElement !== target) closeResolverList(target);
  }, 120);
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest(".resolver-list")) event.preventDefault();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const option = target.closest("[data-resolve-index]");
  if (!option) {
    if (!target.closest("[data-resolve-kind]")) closeAllResolverLists();
    return;
  }
  const list = option.closest(".resolver-list");
  if (!list) return;
  const input = document.querySelector(`[aria-controls="${CSS.escape(list.id)}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  const result = resolverRecord(input).results[Number(option.dataset.resolveIndex)];
  if (result) selectResolverResult(input, result);
});

document.addEventListener("keydown", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.resolveKind) return;
  const record = resolverRecord(input);
  const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
  const open = list && !list.hidden;
  if (event.key === "Escape" && open) {
    event.preventDefault();
    event.stopPropagation();
    closeResolverList(input);
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!open && event.key === "ArrowDown" && resolverQuery(input)) {
      event.preventDefault();
      void fetchResolverSuggestions(input, record);
      return;
    }
    if (!open) return;
    event.preventDefault();
    const options = list.querySelectorAll('[role="option"]');
    const position = event.key === "ArrowDown" ? record.active + 1 : record.active - 1;
    setResolverActive(input, record, position < 0 ? options.length - 1 : position);
    return;
  }
  if (event.key === "Enter") {
    const query = resolverQuery(input);
    if (!query || RESOLVE_SNOWFLAKE.test(query)) return;
    event.preventDefault();
    event.stopPropagation();
    const active = open ? record.results[record.active] ?? exactResolverResult(input, record) : null;
    if (active) selectResolverResult(input, active);
    else void resolveInputValue(input);
  }
});

function featureButton(featureId) {
  return document.querySelector(`[data-feature-id="${CSS.escape(featureId)}"]`);
}

function setFeatureCount(node, value) {
  if (!node || node.textContent === String(value)) return;
  node.textContent = String(value);
}

function syncDependencyHints() {
  const features = state.data?.features ?? [];
  const byId = new Map(features.map((item) => [item.id, item]));
  for (const item of features) {
    const copy = featureButton(item.id)?.closest(".feature-row")?.querySelector(".feature-copy");
    if (!copy) continue;
    const unmet = (Array.isArray(item.dependsOn) ? item.dependsOn : []).filter((dependency) => {
      const match = byId.get(dependency);
      return !match || !match.enabled;
    });
    let node = copy.querySelector(".feature-deps");
    if (!unmet.length) {
      node?.remove();
      continue;
    }
    if (!node) {
      node = document.createElement("p");
      node.className = "feature-deps";
      const error = copy.querySelector(".feature-error");
      if (error) error.before(node);
      else copy.append(node);
    }
    node.textContent = `Needs ${unmet.map((dependency) => byId.get(dependency)?.label ?? dependency).join(", ")}`;
  }
}

function syncFeatureIndicators(feature, enabled) {
  const button = featureButton(feature.id);
  if (button) {
    button.setAttribute("aria-checked", String(enabled));
    button.setAttribute("aria-label", `${enabled ? "Disable" : "Enable"} ${feature.label ?? feature.id}`);
  }
  const features = state.data?.features ?? [];
  const enabledCount = features.filter((item) => item.enabled).length;
  setFeatureCount(document.querySelector("[data-enabled-count]"), enabledCount);
  const totalNode = document.querySelector("[data-total-count]");
  if (totalNode) totalNode.textContent = String(features.length);
  const countText = document.querySelector("[data-feature-count-text]");
  if (countText) countText.textContent = `${enabledCount} of ${features.length} enabled`;
  syncDependencyHints();
}

function renderFeatureError(featureId, message) {
  const copy = featureButton(featureId)?.closest(".feature-row")?.querySelector(".feature-copy");
  if (!copy) return;
  copy.querySelector(".feature-error")?.remove();
  const error = document.createElement("p");
  error.className = "feature-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  copy.append(error);
}

async function applyFeature(featureId, enabled, options = {}) {
  const feature = state.data?.features?.find((item) => item.id === featureId);
  if (!feature || state.pendingFeatures.has(featureId) || !state.guildId || !state.permissions.administrator) return false;
  const previous = feature.enabled;
  if (previous === enabled) return true;
  state.pendingFeatures.add(featureId);
  delete state.featureErrors[featureId];
  feature.enabled = enabled;
  const button = featureButton(featureId);
  const row = button?.closest(".feature-row");
  button?.setAttribute("aria-busy", "true");
  row?.classList.add("is-pending");
  row?.querySelector(".feature-error")?.remove();
  syncFeatureIndicators(feature, enabled);
  try {
    const response = await api.feature(state.guildId, featureId, enabled);
    feature.enabled = response?.enabled ?? enabled;
    if (feature.enabled !== enabled) syncFeatureIndicators(feature, feature.enabled);
    announce(`${feature.label ?? featureId} ${feature.enabled ? "enabled" : "disabled"}.`);
    if (options.undo) {
      showToast(`${feature.label ?? featureId} ${feature.enabled ? "enabled" : "disabled"}.`, {
        key: `feature:${featureId}`,
        actionLabel: "Undo",
        onAction: async () => {
          const undone = await applyFeature(featureId, previous, {});
          if (undone) showToast("Change undone.", { key: `feature:${featureId}` });
        },
      });
    }
    return true;
  } catch (error) {
    feature.enabled = previous;
    state.featureErrors[featureId] = error instanceof Error ? error.message : "This feature could not be updated.";
    syncFeatureIndicators(feature, previous);
    renderFeatureError(featureId, state.featureErrors[featureId]);
    announce("The feature change failed.");
    return false;
  } finally {
    state.pendingFeatures.delete(featureId);
    row?.classList.remove("is-pending");
    button?.setAttribute("aria-busy", "false");
  }
}

async function toggleFeature(button) {
  const featureId = button.dataset.featureId;
  const feature = state.data?.features?.find((item) => item.id === featureId);
  if (!feature) return;
  await applyFeature(featureId, !feature.enabled, { undo: true });
}

function showToast(message, options = {}) {
  const stack = document.querySelector("#toast-stack");
  if (!stack) return;
  while (stack.children.length >= 3) stack.firstElementChild?.remove();
  if (options.key) {
    stack.querySelectorAll(`[data-toast-key="${CSS.escape(options.key)}"]`).forEach((existing) => existing.remove());
  }
  const toast = document.createElement("div");
  if (options.key) toast.dataset.toastKey = options.key;
  if (options.tone) toast.dataset.tone = options.tone;
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `<p>${escapeHtml(message)}</p><div class="toast-actions">${options.actionLabel ? `<button class="button button-quiet" type="button" data-toast-action>${escapeHtml(options.actionLabel)}</button>` : ""}<button class="icon-button toast-close" type="button" data-toast-close aria-label="Dismiss"><img src="/icons/x.svg" alt=""></button></div><span class="toast-progress" aria-hidden="true"></span>`;
  let timer;
  let leaving = false;
  const dismiss = () => {
    clearTimeout(timer);
    if (leaving) return;
    leaving = true;
    toast.classList.add("is-leaving");
    const remove = () => toast.remove();
    toast.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 220);
  };
  timer = setTimeout(dismiss, 7000);
  toast.querySelector("[data-toast-close]")?.addEventListener("click", dismiss);
  toast.querySelector("[data-toast-action]")?.addEventListener("click", async () => {
    dismiss();
    await options.onAction?.();
  });
  stack.append(toast);
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function startProgress() {
  stopProgress();
  if (state.view !== "music") return;
  const seek = document.querySelector("#track-seek");
  const output = document.querySelector("#track-position");
  if (!seek || seek.disabled || state.data?.playing !== true || state.data?.paused === true) return;
  const max = Number(seek.max) || 0;
  let position = Number(seek.value) || 0;
  progressTimer = setInterval(() => {
    if (document.hidden) return;
    if (state.view !== "music") { stopProgress(); return; }
    position = Math.min(max, position + 1000);
    seek.value = String(position);
    if (output) output.textContent = fmtTrackTime(position);
    seek.setAttribute("aria-valuetext", `${fmtTrackTime(position)} of ${fmtTrackTime(max)}`);
  }, 1000);
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Permission denied on an insecure origin; use the selection fallback.
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

async function refreshMusic() {
  if (!state.guildId) return;
  const data = await api.music(state.guildId);
  state.data = data;
  renderMain();
  stopProgress();
  startProgress();
}

const MUSIC_CHANNEL_ACTIONS = new Set(["join", "play"]);

function buildMusicBody(action, body = {}, voiceChannelId = "") {
  const payload = { ...body };
  if (MUSIC_CHANNEL_ACTIONS.has(action) && voiceChannelId) payload.voiceChannelId = voiceChannelId;
  else delete payload.voiceChannelId;
  return payload;
}

async function runMusicAction(action, body = {}, button = null) {
  if (!state.guildId) return;
  if (action === "play" && !body.query) {
    document.querySelector("#track-query")?.focus();
    return;
  }
  const field = document.querySelector("#voice-channel");
  const voiceSelf = button?.dataset.voiceSelf === "true";
  let voiceChannel = "";
  if (MUSIC_CHANNEL_ACTIONS.has(action) && !voiceSelf) {
    const raw = field?.value.trim() || state.voiceChannelId || "";
    if (raw) {
      const resolved = await resolveSingle("voice", raw);
      if (!resolved) {
        showToast("No unique voice channel matches that name. Pick one from the list.", { key: "music", tone: "error" });
        field?.focus();
        return;
      }
      voiceChannel = resolved.id;
      if (field && field.value.trim() !== voiceChannel) {
        field.value = voiceChannel;
        state.voiceChannelId = voiceChannel;
        localStorage.setItem(`siela.voice.${state.guildId}`, voiceChannel);
      }
    }
    if (action === "join" && !voiceChannel) {
      showToast("Enter a voice channel name, or use Join my voice channel.", { key: "music", tone: "error" });
      field?.focus();
      return;
    }
  }
  const trigger = button ?? document.querySelector(`[data-music-action="${CSS.escape(action)}"]`);
  if (trigger) trigger.disabled = true;
  try {
    await api.musicAction(state.guildId, action, buildMusicBody(action, body, voiceChannel));
    await refreshMusic();
    announce("Player updated.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "The music action failed.", { key: "music", tone: "error" });
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
  }
}

async function runCahAction(action, button) {
  if (!state.guildId) return;
  if (action === "end" && !window.confirm("End this CAH game for everyone?")) return;
  const guildId = state.guildId;
  const body = { gameId: button.dataset.gameId ?? "" };
  const roundIndex = button.dataset.roundIndex;
  if (roundIndex !== undefined) body.roundIndex = Number(roundIndex);
  button.disabled = true;
  stopGamePoll();
  try {
    const data = await api.cahAction(guildId, action, body);
    if (state.view !== "cah" || state.guildId !== guildId) return;
    state.data = data;
    renderMain();
    announce(`CAH ${action} sent.`);
    showToast(`CAH ${action} sent.`, { key: "cah" });
  } catch (error) {
    if (button.isConnected) button.disabled = false;
    const message = error instanceof Error ? error.message : "The CAH action failed.";
    showToast(message, { key: "cah", tone: "error" });
    announce("The CAH action failed.");
  } finally {
    startGamePoll();
  }
}

async function runTambolaAction(action, button) {
  if (!state.guildId) return;
  if (action === "end" && !window.confirm("End this Tambola game for everyone?")) return;
  const guildId = state.guildId;
  button.disabled = true;
  stopGamePoll();
  try {
    const data = await api.tambolaAction(guildId, action, { gameId: button.dataset.gameId ?? "" });
    if (state.view !== "tambola" || state.guildId !== guildId) return;
    state.data = data;
    renderMain();
    announce(`Tambola ${action} sent.`);
    showToast(`Tambola ${action} sent.`, { key: "tambola" });
  } catch (error) {
    if (button.isConnected) button.disabled = false;
    const message = error instanceof Error ? error.message : "The Tambola action failed.";
    showToast(message, { key: "tambola", tone: "error" });
    announce("The Tambola action failed.");
  } finally {
    startGamePoll();
  }
}

async function createCahLobby(form) {
  if (!state.guildId) return;
  const guildId = state.guildId;
  const data = new FormData(form);
  const channelId = String(data.get("channelId") ?? "").trim();
  const pointsGoal = Number(data.get("pointsGoal"));
  const maxPlayers = Number(data.get("maxPlayers"));
  if (!/^\d{17,20}$/.test(channelId)) {
    setInlineFeedback("cah-host", "Enter the text channel's Discord ID (17 to 20 digits).", true);
    return;
  }
  if (!Number.isInteger(pointsGoal) || pointsGoal < 1 || pointsGoal > 50) {
    setInlineFeedback("cah-host", "Points to win must be between 1 and 50.", true);
    return;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 3 || maxPlayers > 10) {
    setInlineFeedback("cah-host", "Maximum players must be between 3 and 10.", true);
    return;
  }
  const submit = form.querySelector("[type=submit]");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Creating…";
  }
  setInlineFeedback("cah-host", "Creating the lobby…");
  stopGamePoll();
  try {
    const result = await api.cahHost(guildId, { channelId, pointsGoal, maxPlayers });
    if (state.view !== "cah" || state.guildId !== guildId) return;
    state.data = result;
    renderMain();
    announce("CAH lobby created.");
    showToast("CAH lobby created.", { key: "cah" });
  } catch (error) {
    setInlineFeedback("cah-host", error instanceof Error ? error.message : "The lobby could not be created.", true);
    if (submit?.isConnected) {
      submit.disabled = false;
      submit.textContent = "Create lobby";
    }
  } finally {
    startGamePoll();
  }
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function playCasino(game, form) {
  if (!state.guildId || state.casinoBusy) return;
  const guildId = state.guildId;
  const data = new FormData(form);
  const bet = Number(data.get("bet"));
  const maxBet = Number(state.data?.maxBet) || 10_000;
  if (!Number.isInteger(bet) || bet <= 0) {
    setInlineFeedback("casino", "Bet must be a whole number of coins.", true);
    return;
  }
  if (bet > maxBet) {
    setInlineFeedback("casino", `The maximum bet is ${maxBet.toLocaleString()} SC.`, true);
    return;
  }
  const side = game === "coinflip" ? String(data.get("side") ?? "heads") : undefined;
  const pending = state.casinoPending;
  const retry = pending && pending.game === game && pending.bet === bet && pending.side === side;
  const requestId = retry ? pending.requestId : newRequestId();
  state.casinoPending = { game, requestId, bet, side };
  state.casinoBusy = true;
  const submit = form.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  setInlineFeedback("casino", game === "coinflip" ? "Flipping…" : "Spinning…");
  try {
    const body = game === "coinflip" ? { bet, side, requestId } : { bet, requestId };
    const result = await api.casinoPlay(guildId, game, body);
    if (state.view !== "casino" || state.guildId !== guildId) return;
    state.casinoResult = result;
    state.casinoPending = null;
    state.casinoBusy = false;
    state.data = { ...(state.data ?? {}), balance: result.balance, maxBet: result.maxBet ?? maxBet, enabled: true };
    renderMain();
    announce(result.payout > 0 ? `You won ${result.payout} SC.` : "No payout this time.");
  } catch (error) {
    state.casinoBusy = false;
    if (submit?.isConnected) submit.disabled = false;
    setInlineFeedback("casino", error instanceof Error ? error.message : "The play failed.", true);
    showToast(error instanceof Error ? error.message : "The play failed.", { key: "casino", tone: "error" });
  }
}

async function runEconomyAction(action, button) {
  if (!state.guildId || state.economyBusy) return;
  const guildId = state.guildId;
  state.economyBusy = true;
  button.disabled = true;
  setInlineFeedback("economy", action === "daily" ? "Claiming your daily reward…" : "Working a shift…");
  try {
    const result = await api.economyAction(guildId, action);
    if (state.view !== "economy" || state.guildId !== guildId) return;
    const fresh = await api.economy(guildId);
    state.economyBusy = false;
    state.data = fresh;
    renderMain();
    const message = action === "daily" ? `Daily reward claimed: ${result.amount} SC.` : `Shift complete: ${result.amount} SC.`;
    showToast(message, { key: "economy" });
    announce(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The economy action failed.";
    if (button.isConnected) button.disabled = false;
    setInlineFeedback("economy", message, true);
    showToast(message, { key: "economy", tone: "error" });
  } finally {
    state.economyBusy = false;
  }
}

async function tradeStock(form, submitter) {
  if (!state.guildId || state.stockBusy) return;
  const guildId = state.guildId;
  const side = submitter?.dataset.stockSide === "sell" ? "sell" : "buy";
  const data = new FormData(form);
  const symbol = String(data.get("symbol") ?? "").trim();
  const shares = Number(data.get("shares"));
  if (!/^[A-Za-z]{1,8}$/.test(symbol) || !Number.isSafeInteger(shares) || shares <= 0) {
    setInlineFeedback("stocks", "Choose a symbol and enter a whole number of shares.", true);
    return;
  }
  const buttons = [...form.querySelectorAll("[data-stock-side]")];
  state.stockBusy = true;
  buttons.forEach((button) => { button.disabled = true; });
  setInlineFeedback("stocks", side === "buy" ? "Buying shares…" : "Selling shares…");
  try {
    const payload = await api.stockTrade(guildId, side, { symbol, shares });
    if (state.view !== "stocks" || state.guildId !== guildId) return;
    state.stockBusy = false;
    state.data = { enabled: true, market: payload?.market ?? null, portfolio: payload?.portfolio ?? null };
    renderMain();
    const result = payload?.result ?? null;
    const filled = result?.shares ?? shares;
    const price = result?.price ? ` at ${Number(result.price).toLocaleString()} SC` : "";
    const message = side === "buy" ? `Bought ${filled} ${symbol}${price}.` : `Sold ${filled} ${symbol}${price}.`;
    showToast(message, { key: "stocks" });
    announce(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The trade failed.";
    buttons.forEach((button) => { if (button.isConnected) button.disabled = false; });
    setInlineFeedback("stocks", message, true);
    showToast(message, { key: "stocks", tone: "error" });
  } finally {
    state.stockBusy = false;
  }
}

function readConfigForm(form) {  const body = {};
  for (const button of form.querySelectorAll("[data-setting-toggle]")) {
    body[button.dataset.settingToggle] = button.getAttribute("aria-checked") === "true";
  }
  for (const field of form.querySelectorAll("[data-config-key]")) {
    const key = field.dataset.configKey;
    const value = field.value.trim();
    if (field.dataset.configType === "list") {
      body[key] = value ? value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean) : [];
    } else if (field.dataset.configType === "number") {
      body[key] = value === "" ? null : Number(value);
    } else if (value === "" && (key === "channelId" || key.endsWith("ChannelId") || key === "dmMessage" || key === "goodbyeMessage")) {
      body[key] = null;
    } else {
      body[key] = value;
    }
  }
  return body;
}

function markSettingsDirty(form) {
  if (!form || !state.permissions.administrator || form.classList.contains("is-dirty")) return;
  form.classList.add("is-dirty");
  const submit = form.querySelector("[data-save-section]");
  if (submit) submit.disabled = false;
}

async function saveSettings(form) {
  const section = form.dataset.configSection;
  if (!state.permissions.administrator) {
    setInlineFeedback(section, "Administrator permission required to change server settings.", true);
    return;
  }
  if (!form.classList.contains("is-dirty")) return;
  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  submit.textContent = "Saving…";
  setInlineFeedback(section, "Saving changes…");
  let body;
  try {
    body = readConfigForm(form);
  } catch {
    setInlineFeedback(section, "Enter valid JSON in the structured field.", true);
    submit.disabled = false;
    submit.textContent = "Save";
    return;
  }
  try {
    const updated = await api.patchConfig(state.guildId, section, body);
    if (state.data && typeof state.data === "object") state.data[section] = updated;
    form.classList.remove("is-dirty");
    submit.disabled = true;
    submit.textContent = "Save";
    setInlineFeedback(section, "Saved to this server.");
    announce(`${section} settings saved.`);
  } catch (error) {
    setInlineFeedback(section, error instanceof Error ? error.message : "Settings could not be saved.", true);
    submit.disabled = false;
    submit.textContent = "Save";
  }
}

async function saveBirthday(form) {
  if (!state.guildId) return;
  const month = Number(form.querySelector("#birthday-month")?.value);
  const day = Number(form.querySelector("#birthday-day")?.value);
  const yearField = form.querySelector("#birthday-year");
  const year = yearField?.value.trim() ?? "";
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) {
    setInlineFeedback("birthday", "Choose a month and enter a day.", true);
    return;
  }
  const body = { month, day };
  if (year) body.year = Number(year);
  const submit = form.querySelector("[data-birthday-save]");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Saving…";
  }
  setInlineFeedback("birthday", "Saving birthday…");
  try {
    const result = await api.setBirthday(state.guildId, body);
    state.data = { birthday: result?.birthday ?? null };
    renderMain();
    announce("Birthday saved.");
    showToast("Birthday saved to this server.", { key: "birthday" });
  } catch (error) {
    setInlineFeedback("birthday", error instanceof Error ? error.message : "Your birthday could not be saved.", true);
    if (submit?.isConnected) {
      submit.disabled = false;
      submit.textContent = "Save";
    }
  }
}

async function clearBirthday(button) {
  if (!state.guildId) return;
  button.disabled = true;
  try {
    await api.clearBirthday(state.guildId);
    state.data = { birthday: null };
    renderMain();
    announce("Birthday cleared.");
    showToast("Birthday cleared.", { key: "birthday" });
  } catch (error) {
    if (button.isConnected) button.disabled = false;
    showToast(error instanceof Error ? error.message : "Your birthday could not be cleared.", { key: "birthday", tone: "error" });
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "birthday-form") {
    event.preventDefault();
    await saveBirthday(form);
    return;
  }
  if (form.id === "login-form") {
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    submit.textContent = "Checking…";
    try {
      const result = await api.login(new FormData(form).get("password"));
      await enterDashboard(result.csrfToken, result.user ?? null);
    } catch (error) {
      showLogin(error instanceof Error ? error.message : "Sign-in failed. Try again.");
    }
    return;
  }
  if (form.id === "play-form") {
    event.preventDefault();
    const query = new FormData(form).get("query");
    await runMusicAction("play", { query });
    return;
  }
  if (form.id === "cah-host-form") {
    event.preventDefault();
    await createCahLobby(form);
    return;
  }
  if (form.id === "casino-coinflip-form" || form.id === "casino-slots-form") {
    event.preventDefault();
    await playCasino(form.id === "casino-coinflip-form" ? "coinflip" : "slots", form);
    return;
  }
  if (form.id === "stock-trade-form") {
    event.preventDefault();
    await tradeStock(form, event.submitter);
    return;
  }
  if (form.hasAttribute("data-config-section")) {
    event.preventDefault();
    await saveSettings(form);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#guild-picker-button")) {
    if (guildPickerMenu?.hidden) openGuildMenu();
    else closeGuildMenu();
    return;
  }
  const guildOption = target.closest("[data-guild-id]");
  if (guildOption) {
    await selectGuild(guildOption.dataset.guildId ?? "");
    return;
  }
  if (!target.closest("[data-guild-picker]")) closeGuildMenu();
  const action = target.closest("[data-action]");
  if (action?.dataset.action === "toggle-rail") {
    applyRailCollapsed(!railCollapsed);
  } else if (action?.dataset.action === "toggle-nav") {
    if (navDrawer?.open) closeNavDrawer();
    else openNavDrawer();
  } else if (action?.dataset.action === "close-nav") {
    closeNavDrawer();
  } else if (action?.dataset.action === "help") {
    dialog.showModal();
  } else if (action?.dataset.action === "close-help") {
    dialog.close();
  } else if (action?.dataset.action === "toggle-theme") {
    toggleTheme();
  } else if (action?.dataset.action === "logout") {
    try { await api.logout(); } catch { /* The server clears expired sessions on the next sign-in. */ }
    showLogin("", state.oauth);
  } else if (action?.dataset.action === "retry") {
    if (state.guilds.length === 0) {
      try { await refreshGuilds(); } catch { /* The view displays its own retry state. */ }
    }
    await loadData(currentRoute);
  } else if (action?.dataset.action === "toggle-feature") {
    await toggleFeature(action);
  } else if (action?.dataset.action === "clear-birthday") {
    await clearBirthday(action);
  } else if (action?.dataset.action === "music") {
    const body = action.dataset.musicAction === "loop"
      ? { mode: action.dataset.loopMode }
      : action.dataset.musicAction === "filters"
        ? { preset: action.dataset.filterPreset }
        : {};
    await runMusicAction(action.dataset.musicAction, body, action);
  } else if (action?.dataset.action === "refresh-games") {
    await pollGameView(true);
    announce("Game state refreshed.");
  } else if (action?.dataset.action === "cah") {
    await runCahAction(action.dataset.cahAction, action);
  } else if (action?.dataset.action === "tambola") {
    await runTambolaAction(action.dataset.tambolaAction, action);
  } else if (action?.dataset.action === "economy") {
    await runEconomyAction(action.dataset.economyAction, action);
  }

  const copy = target.closest("[data-copy]");
  if (copy) {
    await copyText(copy.dataset.copy ?? "");
    copy.classList.add("is-copied");
    const hint = copy.querySelector(".copy-hint");
    if (hint) hint.textContent = "Copied";
    setTimeout(() => {
      copy.classList.remove("is-copied");
      if (hint) hint.textContent = "Copy";
    }, 1400);
    showToast("Server ID copied.");
  }

  const settingToggle = target.closest("[data-setting-toggle]");
  if (settingToggle && state.permissions.administrator) {
    const checked = settingToggle.getAttribute("aria-checked") === "true";
    settingToggle.setAttribute("aria-checked", String(!checked));
    markSettingsDirty(settingToggle.closest("[data-config-section]"));
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target instanceof HTMLInputElement) {
    if (target.dataset.resolveKind) handleResolverInput(target);
    if (target.id === "view-search") {
      state.search = target.value;
      renderMain(true);
    }
    if (target.id === "voice-channel") {
      state.voiceChannelId = target.value.trim();
      if (state.guildId) localStorage.setItem(`siela.voice.${state.guildId}`, state.voiceChannelId);
    }
    if (target.id === "track-seek") {
      const duration = Number(target.max);
      const position = Number(target.value);
      const label = `${Math.floor(position / 1000)}s of ${Math.floor(duration / 1000)}s`;
      target.setAttribute("aria-valuetext", label);
      const output = document.querySelector("#track-position");
      if (output) output.value = formatPosition(position);
    }
  }
  markSettingsDirty(target.closest("[data-config-section]"));
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "track-seek") {
    await runMusicAction("seek", { positionMs: Number(target.value) });
  }
  if (target instanceof Element) markSettingsDirty(target.closest("[data-config-section]"));
});

window.addEventListener("hashchange", async () => {
  if (!state.authenticated) return;
  closeNavDrawer({ restoreFocus: false });
  const route = parseRoute(location.hash);
  const guildId = route.guildId && state.guilds.some((guild) => guild.id === route.guildId) ? route.guildId : state.guildId;
  if (guildId !== state.guildId) rememberGuild(guildId);
  if (route.guildId !== guildId) writeRoute(route.view, guildId, true);
  await loadData({ view: route.view, guildId });
  main.focus({ preventScroll: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopGamePoll();
  else startGamePoll();
});

installHotkeys({
  view: (view) => {
    if (!navDrawer?.open) {
      navigate(view, state.guildId);
      return;
    }
    const sameView = view === state.view;
    closeNavDrawer({ restoreFocus: false });
    navigate(view, state.guildId);
    if (sameView) main.focus({ preventScroll: true });
  },
  search: () => {
    closeNavDrawer({ restoreFocus: false });
    document.querySelector("#view-search")?.focus();
  },
  help: () => dialog.showModal(),
  save: () => {
    if (state.view !== "settings") return;
    for (const form of document.querySelectorAll("form.settings-section.is-dirty")) void saveSettings(form);
  },
  escape: () => {
    if (dialog.open) {
      dialog.close();
      return;
    }
    if (navDrawer?.open) {
      closeNavDrawer();
      return;
    }
    closeGuildMenu();
  },
});

applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
applyRailCollapsed();

document.addEventListener("error", (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.dataset.guildIcon !== undefined) target.remove();
}, true);

async function start() {
  try {
    const session = await api.session();
    state.oauth = Boolean(session.oauth);
    state.password = Boolean(session.password);
    if (!session.authenticated) {
      showLogin(oauthMessage(), state.oauth, state.password);
      return;
    }
    state.user = session.user ?? null;
    await enterDashboard(session.csrfToken, state.user);
  } catch (error) {
    showLogin(error instanceof Error ? error.message : "The dashboard could not connect.");
  }
}

start();
