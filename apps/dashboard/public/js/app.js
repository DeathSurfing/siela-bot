import { api, ApiError, setCsrfToken } from "./api.js";
import { navigate, parseRoute, writeRoute, installKeyboardShortcuts } from "./router.js";
import { rememberGuild, state } from "./store.js";
import { escapeHtml, fmtTrackTime, renderLogin, renderStatusPill, renderView, viewTitle } from "./views.js";

const boot = document.querySelector("#boot-state");
const loginScreen = document.querySelector("#login-screen");
const shell = document.querySelector("#app-shell");
const main = document.querySelector("#main-content");
const guildPicker = document.querySelector("#guild-picker");
const dialog = document.querySelector("#help-dialog");
let loadSequence = 0;
let currentRoute = { view: "overview", guildId: null };
let progressTimer = null;

function showLogin(error = "") {
  state.authenticated = false;
  state.csrfToken = null;
  setCsrfToken(null);
  boot.hidden = true;
  shell.hidden = true;
  loginScreen.hidden = false;
  loginScreen.innerHTML = renderLogin(error);
  loginScreen.querySelector("#login-password")?.focus();
}

function updateGuildPicker() {
  guildPicker.innerHTML = state.guilds.length
    ? state.guilds.map((guild) => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name ?? guild.id)}</option>`).join("")
    : `<option value="">No servers available</option>`;
  guildPicker.disabled = state.guilds.length === 0;
  guildPicker.value = state.guildId ?? "";
}

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
  state.view = route.view;
  state.featureErrors = {};
  state.voiceChannelId = route.guildId ? (localStorage.getItem(`siela.voice.${route.guildId}`) ?? "") : "";
  state.error = null;
  state.loading = true;
  state.search = "";
  currentRoute = route;
  updateGuildPicker();
  renderMain();
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
    } else if (route.view === "servers") {
      state.data = { guilds: state.guilds };
      statusRequest = api.status();
    } else if (!route.guildId) {
      state.data = null;
      statusRequest = api.status();
    } else {
      const loaders = {
        features: () => api.features(route.guildId),
        music: () => api.music(route.guildId),
        settings: () => api.config(route.guildId),
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
    if (sequence !== loadSequence) return;
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
    }
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

async function enterDashboard(csrf) {
  state.authenticated = true;
  state.csrfToken = csrf;
  setCsrfToken(csrf);
  activateShell();
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
  if (!feature || state.pendingFeatures.has(featureId) || !state.guildId) return false;
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
  toast.innerHTML = `<p>${escapeHtml(message)}</p><div class="toast-actions">${options.actionLabel ? `<button class="button button-quiet" type="button" data-toast-action>${escapeHtml(options.actionLabel)}</button>` : ""}<button class="icon-button toast-close" type="button" data-toast-close aria-label="Dismiss">×</button></div><span class="toast-progress" aria-hidden="true"></span>`;
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

async function runMusicAction(action, body = {}) {
  if (!state.guildId) return;
  if (action === "play" && !body.query) {
    document.querySelector("#track-query")?.focus();
    return;
  }
  const voiceChannel = document.querySelector("#voice-channel")?.value.trim() ?? state.voiceChannelId ?? "";
  if (action === "join" && !voiceChannel) {
    showToast("Paste a voice channel ID before joining.", { key: "music", tone: "error" });
    document.querySelector("#voice-channel")?.focus();
    return;
  }
  if (voiceChannel) body.voiceChannelId = voiceChannel;
  const button = document.querySelector(`[data-music-action="${CSS.escape(action)}"]`);
  if (button) button.disabled = true;
  try {
    await api.musicAction(state.guildId, action, body);
    await loadData(currentRoute);
    announce("Player updated.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "The music action failed.", { key: "music", tone: "error" });
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function readConfigForm(form) {
  const body = {};
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
  if (!form || form.classList.contains("is-dirty")) return;
  form.classList.add("is-dirty");
  const submit = form.querySelector("[data-save-section]");
  if (submit) submit.disabled = false;
}

async function saveSettings(form) {
  if (!form.classList.contains("is-dirty")) return;
  const section = form.dataset.configSection;
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

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
  if (state.view !== "settings") return;
  const dirty = [...document.querySelectorAll("form.settings-section.is-dirty")];
  if (!dirty.length) return;
  event.preventDefault();
  for (const form of dirty) void saveSettings(form);
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "login-form") {
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    submit.textContent = "Checking…";
    try {
      const result = await api.login(new FormData(form).get("password"));
      await enterDashboard(result.csrfToken);
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
  if (form.hasAttribute("data-config-section")) {
    event.preventDefault();
    await saveSettings(form);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest("[data-action]");
  if (action?.dataset.action === "help") {
    dialog.showModal();
  } else if (action?.dataset.action === "close-help") {
    dialog.close();
  } else if (action?.dataset.action === "logout") {
    try { await api.logout(); } catch { /* The server clears expired sessions on the next sign-in. */ }
    showLogin();
  } else if (action?.dataset.action === "retry") {
    if (currentRoute.view === "servers" || state.guilds.length === 0) {
      try { await refreshGuilds(); } catch { /* The view displays its own retry state. */ }
    }
    await loadData(currentRoute);
  } else if (action?.dataset.action === "toggle-feature") {
    await toggleFeature(action);
  } else if (action?.dataset.action === "music") {
    const body = action.dataset.musicAction === "loop" ? { mode: action.dataset.loopMode } : {};
    await runMusicAction(action.dataset.musicAction, body);
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
  if (settingToggle) {
    const checked = settingToggle.getAttribute("aria-checked") === "true";
    settingToggle.setAttribute("aria-checked", String(!checked));
    markSettingsDirty(settingToggle.closest("[data-config-section]"));
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target instanceof HTMLInputElement) {
    if (target.id === "view-search") {
      state.search = target.value;
      renderMain(true);
    }
    if (target.id === "volume-control") {
      const output = document.querySelector('output[for="volume-control"]');
      if (output) output.value = `${target.value}%`;
      target.setAttribute("aria-valuetext", `${target.value} percent`);
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
  if (target === guildPicker) {
    const guildId = guildPicker.value || null;
    rememberGuild(guildId);
    writeRoute(currentRoute.view, guildId);
    await loadData({ view: currentRoute.view, guildId });
  }
  if (target instanceof HTMLInputElement && target.id === "volume-control") {
    await runMusicAction("volume", { volume: Number(target.value) });
  }
  if (target instanceof HTMLInputElement && target.id === "track-seek") {
    await runMusicAction("seek", { positionMs: Number(target.value) });
  }
  if (target instanceof Element) markSettingsDirty(target.closest("[data-config-section]"));
});

window.addEventListener("hashchange", async () => {
  if (!state.authenticated) return;
  const route = parseRoute(location.hash);
  const guildId = route.guildId && state.guilds.some((guild) => guild.id === route.guildId) ? route.guildId : state.guildId;
  if (guildId !== state.guildId) rememberGuild(guildId);
  if (route.guildId !== guildId) writeRoute(route.view, guildId, true);
  await loadData({ view: route.view, guildId });
  main.focus({ preventScroll: true });
});

installKeyboardShortcuts(
  (view) => navigate(view, state.guildId),
  () => document.querySelector("#view-search")?.focus(),
  () => dialog.showModal(),
);

async function start() {
  try {
    const session = await api.session();
    if (!session.authenticated) {
      showLogin();
      return;
    }
    await enterDashboard(session.csrfToken);
  } catch (error) {
    showLogin(error instanceof Error ? error.message : "The dashboard could not connect.");
  }
}

start();
