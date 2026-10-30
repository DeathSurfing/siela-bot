import { state } from "./store.js";

const titles = {
  overview: "Overview",
  servers: "Servers",
  features: "Features",
  music: "Music",
  cah: "Cards Against Humanity",
  tambola: "Tambola",
  casino: "Casino",
  settings: "Server settings",
  user: "User settings",
  audit: "Audit",
  commands: "Commands",
};

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(Date.UTC(2024, index, 1))));

const editableFields = {
  prefix: ["prefix"],
  welcome: ["enabled", "channelId", "message", "embed", "card", "pingUser", "dmEnabled", "dmMessage", "goodbyeEnabled", "goodbyeChannelId", "goodbyeMessage"],
  autorole: ["enabled", "roleIds", "includeBots", "minAccountAgeDays", "delayMs"],
  tempvc: ["enabled", "hubChannelId", "categoryId", "nameTemplate", "defaultUserLimit", "defaultLocked", "autoDelete", "graceSeconds", "maxChannels", "maxPerUser"],
  music: ["djRoleIds", "defaultVolume", "maxQueueSize", "musicChannelId", "aloneTimeoutSeconds"],
};

const hints = {
  channelId: "Right-click a channel in Discord and copy its ID.",
  goodbyeChannelId: "Right-click a channel in Discord and copy its ID.",
  hubChannelId: "The voice channel members join to create their own room.",
  categoryId: "The category new temporary rooms are placed in.",
  musicChannelId: "Optional text channel for player prompts.",
  roleIds: "Comma-separated role IDs.",
  djRoleIds: "Comma-separated role IDs that can control music.",
  message: "Placeholders: {mention}, {user}, {server}.",
  dmMessage: "Sent only when direct messages are enabled.",
  goodbyeMessage: "Placeholders: {user}, {server}.",
  nameTemplate: "Use {user} for the owner's name.",
};

const labels = {
  prefix: "Prefix",
  enabled: "Enabled",
  channelId: "Welcome channel ID",
  message: "Welcome message",
  embed: "Use an embed",
  card: "Use a welcome card",
  pingUser: "Mention the member",
  dmEnabled: "Send a direct message",
  dmMessage: "Direct message",
  goodbyeEnabled: "Send a goodbye message",
  goodbyeChannelId: "Goodbye channel ID",
  goodbyeMessage: "Goodbye message",
  roleIds: "Role IDs",
  includeBots: "Include bots",
  minAccountAgeDays: "Minimum account age in days",
  delayMs: "Role assignment delay in milliseconds",
  hubChannelId: "Hub channel ID",
  categoryId: "Category ID",
  nameTemplate: "Channel name template",
  defaultUserLimit: "Default user limit",
  defaultLocked: "Lock new channels by default",
  autoDelete: "Delete empty channels",
  graceSeconds: "Empty-channel grace period in seconds",
  maxChannels: "Maximum active channels",
  maxPerUser: "Maximum channels per member",
  djRoleIds: "DJ role IDs",
  defaultVolume: "Default volume",
  maxQueueSize: "Maximum queue size",
  musicChannelId: "Music text channel ID",
  aloneTimeoutSeconds: "Disconnect after alone for seconds",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function initialOf(value) {
  const text = String(value ?? "").trim();
  if (!text) return "?";
  const Segmenter = Intl.Segmenter;
  const first = Segmenter
    ? new Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value?.segment
    : Array.from(text)[0];
  return String(first ?? "?").toLocaleUpperCase();
}

function icon(name, className = "") {
  return `<img class="icon ${className}" src="/icons/${escapeHtml(name)}.svg" width="18" height="18" alt="" aria-hidden="true">`;
}

function list(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function fmtNumber(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "N/A";
}

function fmtDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "Not reported";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function fmtTrackTime(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
}

function fmtDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusClass(value) {
  if ([true, "up", "ready", "ok", "connected"].includes(value)) return "ok";
  if (["unknown", "degraded", "limited"].includes(value)) return "warn";
  return "danger";
}

function statusLabel(value) {
  if (value === true || value === "up" || value === "ready" || value === "ok" || value === "connected") return "Operational";
  if (value === "unknown") return "Unknown";
  if (value === "degraded" || value === "limited") return "Degraded";
  if (value === false || value === "down") return "Unavailable";
  return "Not reported";
}

function searchBox(placeholder = "Filter this view") {
  return `<label class="search-box">${icon("search")}<span class="sr-only">Search ${escapeHtml(titles[state.view].toLowerCase())}</span><input id="view-search" type="search" name="search" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.search)}" autocomplete="off"><kbd>/</kbd></label>`;
}

function pageHeader(title, summary, tools = "") {
  return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p class="page-summary">${escapeHtml(summary)}</p></div>${tools ? `<div class="heading-tools">${tools}</div>` : ""}</div>`;
}

function skeletonBlock() {
  return `<div class="page-heading"><div><span class="skeleton skeleton-heading"></span><span class="skeleton skeleton-line"></span></div></div><div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><span class="skeleton skeleton-table"></span>`;
}

function emptyState(title, detail, action = "") {
  return `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>${action}</div>`;
}

function permissionNotice(message) {
  return `<div class="permission-notice" role="status">${icon("warning")}<p>${escapeHtml(message)}</p></div>`;
}

function actorMarkup(entry) {
  const id = entry?.actorId ?? entry?.actor ?? null;
  const name = entry?.actorName ?? id;
  if (!name) return "Unknown";
  const discordId = typeof id === "string" && /^\d{17,20}$/.test(id) ? id : null;
  if (!discordId) return escapeHtml(name);
  const text = name === id ? "Discord member" : name;
  return `<span class="actor-name" tabindex="0" title="Discord ID ${escapeHtml(discordId)}" aria-label="${escapeHtml(`${text}, Discord ID ${discordId}`)}">${escapeHtml(text)}</span>`;
}

function inlineError(message, retryAction = "retry") {
  return `<div class="inline-error" role="alert"><div class="error-copy">${icon("warning")}<div><strong>Could not load this view</strong><p>${escapeHtml(message)}</p></div></div><button class="button button-secondary" type="button" data-action="${retryAction}">Retry</button></div>`;
}

export function renderLogin(error = "", oauth = false, password = false) {
  const errorBlock = error
    ? `<div id="login-error" class="form-error login-error" role="alert">${escapeHtml(error)}</div>`
    : "";
  const discord = oauth
    ? `<a class="button button-primary login-discord" href="/auth/discord"><img src="/icons/discord.svg" alt="">Continue with Discord</a>`
    : "";
  const divider = oauth && password ? `<p class="login-divider"><span>or use the password</span></p>` : "";
  const passwordForm = password
    ? `<form id="login-form"><label for="login-password">Dashboard password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required minlength="1" ${error ? 'aria-describedby="login-error" aria-invalid="true"' : ""}><button class="${oauth ? "button button-secondary" : "button button-primary"} login-submit" type="submit">Continue</button></form>`
    : "";
  const unconfigured = !oauth && !password
    ? `<p class="login-error" role="alert">Sign-in is not configured. Set DASHBOARD_PASSWORD or the four Discord OAuth values, then restart the dashboard.</p>`
    : "";
  const copy = oauth
    ? password
      ? "Use Discord, or the dashboard password configured on this host."
      : "Sign in with a Discord account on this dashboard's owner list."
    : password
      ? "Use the dashboard password configured on this host."
      : "This dashboard has no sign-in method configured.";
  return `<main class="login-wrap"><section class="login-panel" aria-labelledby="login-title"><div class="login-brand"><img src="/mark.svg" width="36" height="36" alt=""><span><strong>Siela</strong></span></div><div class="login-copy"><h1 id="login-title">Sign in to your bot.</h1><p>${copy}</p></div>${errorBlock}${discord}${divider}${passwordForm}${unconfigured}<p class="login-foot">Private by design. Your control token stays on this server.</p></section></main>`;
}

export function renderView(view) {
  if (state.loading) return skeletonBlock();
  if (state.error) return `${pageHeader(titles[view], "A live view of your bot.")}${inlineError(state.error)}`;
  if (!["overview", "servers"].includes(view) && !state.guildId) {
    const detail = state.guilds.length
      ? "Select a server from the header to load this view."
      : "Invite the bot to a Discord server, then refresh the server list.";
    const action = state.guilds.length ? "" : `<button class="button button-secondary" type="button" data-action="retry">Refresh servers</button>`;
    return `${pageHeader(titles[view], "Choose a server to view its settings.")}${emptyState("No server selected", detail, action)}`;
  }
  const data = state.data;
  switch (view) {
    case "overview": return renderOverview(data);
    case "servers": return renderServers(data);
    case "features": return renderFeatures(data);
    case "music": return renderMusic(data);
    case "cah": return renderCah(data);
    case "tambola": return renderTambola(data);
    case "casino": return renderCasino(data);
    case "settings": return renderSettings(data);
    case "user": return renderUserSettings(data);
    case "audit": return renderAudit(data);
    case "commands": return renderCommands(data);
    default: return emptyState("View not found", "Choose a view from the navigation rail.");
  }
}

function renderOverview(data) {
  const status = data?.status ?? null;
  const guilds = state.guilds;
  const audits = list(data?.audit, "entries").slice(0, 6);
  const ready = status?.ready === true;
  const gateway = status?.gatewayPing == null ? "Not reported" : `${fmtNumber(status.gatewayPing)} ms`;
  const systemRows = [
    ["Database", status?.database],
    ["Music engine", status?.music],
  ];
  const auditHref = state.guildId ? `#/g/${encodeURIComponent(state.guildId)}/audit` : "#/audit";
  const auditPanel = data?.audit?.error
    ? `<div class="inline-error compact-error" role="alert"><div class="error-copy">${icon("warning")}<div><strong>Recent actions could not load</strong><p>${escapeHtml(data.audit.error)}</p></div></div><button class="button button-secondary" type="button" data-action="retry">Retry</button></div>`
    : audits.length
      ? `<ol class="activity-list">${audits.map((entry) => `<li><div class="activity-detail"><strong>${escapeHtml(entry.action ?? entry.type ?? "Control action")}</strong><span>${actorMarkup(entry)}</span></div><time datetime="${escapeHtml(entry.createdAt ?? "")}">${escapeHtml(fmtDate(entry.createdAt))}</time></li>`).join("")}</ol>`
      : emptyState("No recent actions", state.guildId ? "Control changes for this server will appear here." : "Select a server to view its control history.");
  const overallClass = status ? (ready ? "ok" : "danger") : "unknown";
  const overallLabel = status ? (ready ? "Operational" : "Attention required") : "Status loading";
  return `${pageHeader("Overview", "Bot health and recent activity across your servers.")}
    <section class="status-line" aria-label="Bot status">
      <span class="status-inline status-${overallClass}"><i class="status-dot"></i>${overallLabel}</span>
      <span class="status-fact"><span>Uptime</span><strong class="tabular">${escapeHtml(fmtDuration(status?.uptimeSeconds))}</strong></span>
      <span class="status-fact"><span>Gateway</span><strong class="tabular">${escapeHtml(gateway)}</strong></span>
    </section>
    <section class="metric-row" aria-label="Bot metrics">
      <div class="metric"><span class="metric-label">Servers</span><strong class="metric-value tabular">${fmtNumber(guilds.length)}</strong></div>
      <div class="metric"><span class="metric-label">Active players</span><strong class="metric-value tabular">${fmtNumber(status?.activePlayers)}</strong></div>
      <div class="metric"><span class="metric-label">Temp voice</span><strong class="metric-value tabular">${fmtNumber(status?.activeTempVcs)}</strong></div>
    </section>
    <div class="overview-columns">
      <section class="section-block"><h2>Service health</h2><div class="health-list">${systemRows.map(([label, value]) => `<div class="health-row"><span class="health-name">${escapeHtml(label)}</span><span class="health-value status-inline status-${statusClass(value)}"><i class="status-dot"></i>${escapeHtml(statusLabel(value))}</span></div>`).join("")}</div></section>
      <section class="section-block"><div class="section-heading"><h2>Recent actions</h2><a class="text-link" href="${auditHref}" data-view="audit">Audit</a></div>${auditPanel}</section>
    </div>`;
}

function renderServers(data) {
  const guilds = list(data, "guilds");
  const rows = guilds.map((guild) => {
    const iconImage = guild.iconUrl ? `<img class="guild-avatar" src="${escapeHtml(guild.iconUrl)}" alt="" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="guild-avatar guild-avatar-fallback">${escapeHtml(initialOf(guild.name))}</span>`;
    return `<tr><td><div class="guild-cell">${iconImage}<span class="guild-copy"><a class="guild-name" href="#/g/${encodeURIComponent(guild.id)}/overview" data-server="${escapeHtml(guild.id)}">${escapeHtml(guild.name ?? "Unnamed server")}</a><button class="copy-id" type="button" data-copy="${escapeHtml(guild.id)}" aria-label="Copy server ID ${escapeHtml(guild.id)}"><small>${escapeHtml(guild.id)}</small><span class="copy-hint" aria-hidden="true">Copy</span></button></span></div></td><td class="numeric-cell" data-label="Members">${fmtNumber(guild.memberCount)}</td><td data-label="Owner"><span class="owner-id">${escapeHtml(guild.ownerId ?? "Not reported")}</span></td><td data-label="Connection"><span class="status-inline status-${guild.available ? "ok" : "danger"}"><i class="status-dot"></i>${guild.available ? "Available" : "Unavailable"}</span></td></tr>`;
  }).join("");
  return `${pageHeader("Servers", `${fmtNumber(guilds.length)} Discord ${guilds.length === 1 ? "server" : "servers"} connected to this bot.`)}<section class="table-panel">${guilds.length ? `<div class="table-scroll"><table><thead><tr><th scope="col">Server</th><th scope="col" class="numeric-cell">Members</th><th scope="col">Owner</th><th scope="col">Connection</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No servers connected", "Invite the bot to a Discord server, then refresh this view.", `<button class="button button-secondary" type="button" data-action="retry">Refresh servers</button>`)}</section>`;
}

function renderFeatures(data) {
  const features = list(data, "features");
  const canManage = state.permissions.administrator;
  const enabled = features.filter((feature) => feature.enabled).length;
  const search = state.search.toLowerCase().trim();
  const visible = features.filter((feature) => [feature.label, feature.description, feature.category, feature.id].join(" ").toLowerCase().includes(search));
  const groups = new Map();
  for (const feature of visible) {
    const category = feature.category || "Other";
    groups.set(category, [...(groups.get(category) ?? []), feature]);
  }
  const groupHtml = Array.from(groups, ([category, entries]) => `<section class="feature-group"><div class="group-heading"><h2>${escapeHtml(category)}</h2></div><div class="feature-list">${entries.map((feature) => renderFeature(feature, features, canManage)).join("")}</div></section>`).join("");
  const countText = `${enabled} of ${features.length} enabled`;
  const banner = canManage ? "" : permissionNotice("Administrator permission required to change features.");
  return `${pageHeader("Features", "Control which bot capabilities are available in this server.", `<span class="enabled-count" data-feature-summary><strong class="tabular" data-enabled-count>${enabled}</strong><span>of <span data-total-count>${features.length}</span> enabled</span></span>`)}${banner}<div class="toolbar-row">${searchBox("Search features")}${state.search ? `<span class="result-count" role="status">${renderSearchResultsCount(visible.length, features.length)}</span>` : ""}</div>${features.length ? (visible.length ? `<div class="feature-categories">${groupHtml}</div>` : emptyState("No matching features", `No results for “${state.search}”. Clear the search to see all features.`)) : emptyState("Features are unavailable", "The control API has not returned a feature list for this server yet.", `<button class="button button-secondary" type="button" data-action="retry">Retry</button>`)}<p class="sr-only" role="status" data-feature-count-text>${escapeHtml(countText)}</p>`;
}

function renderFeature(feature, features, canManage) {
  const pending = state.pendingFeatures.has(feature.id);
  const error = state.featureErrors[feature.id];
  const unmet = (Array.isArray(feature.dependsOn) ? feature.dependsOn : []).filter((dependency) => {
    const match = features.find((item) => item.id === dependency);
    return !match || !match.enabled;
  });
  const dependencies = unmet.length
    ? `<p class="feature-deps">Needs ${unmet.map((dependency) => escapeHtml(features.find((item) => item.id === dependency)?.label ?? dependency)).join(", ")}</p>`
    : "";
  const commandHint = Array.isArray(feature.commands) && feature.commands.length
    ? ` title="Commands: ${escapeHtml(feature.commands.map((command) => `/${command}`).join(", "))}"`
    : "";
  return `<article class="feature-row ${pending ? "is-pending" : ""}"${commandHint}><div class="feature-copy"><h3>${escapeHtml(feature.label ?? feature.id)}</h3><p>${escapeHtml(feature.description ?? "")}</p>${dependencies}${error ? `<p class="feature-error" role="alert">${escapeHtml(error)}</p>` : ""}</div><button type="button" class="switch" role="switch" aria-checked="${Boolean(feature.enabled)}" aria-label="${escapeHtml(feature.enabled ? `Disable ${feature.label}` : `Enable ${feature.label}`)}" aria-busy="${pending}" data-action="toggle-feature" data-feature-id="${escapeHtml(feature.id)}" ${pending || !canManage ? "disabled" : ""}><span></span></button></article>`;
}

function renderMusic(data) {
  const current = data?.current;
  const queue = list(data, "upcoming");
  const playing = data?.playing === true;
  const paused = data?.paused === true;
  const title = current?.title ?? current?.name ?? "Nothing is playing";
  const artist = current?.artist ?? current?.author ?? "The player is idle";
  const volume = Math.max(0, Math.min(150, Number(data?.volume ?? 50)));
  const duration = Number(current?.length) || 0;
  const position = Math.max(0, Math.min(duration, Number(data?.position) || 0));
  const durationLabel = current?.isStream ? "LIVE" : fmtTrackTime(duration);
  const positionLabel = current?.isStream ? "LIVE" : fmtTrackTime(position);
  const loop = ["off", "track", "queue"].includes(data?.loop) ? data.loop : "off";
  const loopNext = { off: "track", track: "queue", queue: "off" }[loop];
  const queueHtml = queue.length ? queue.map((track, index) => `<li><span class="queue-index tabular">${String(index + 1).padStart(2, "0")}</span><span class="queue-track"><strong>${escapeHtml(track.title ?? track.name ?? "Untitled track")}</strong><small>${escapeHtml(track.artist ?? track.author ?? "Unknown artist")}</small></span><span class="queue-length tabular">${escapeHtml(track.isStream ? "LIVE" : fmtTrackTime(track.length))}</span></li>`).join("") : `<li class="queue-empty">Queue is clear. Add a track to get started.</li>`;
  const currentGuildName = state.guilds.find((guild) => guild.id === state.guildId)?.name ?? "the selected server";
  const playAction = paused ? "resume" : playing ? "pause" : "play";
  const playLabel = paused ? "Resume playback" : playing ? "Pause playback" : "Choose a track to play";
  const seekDisabled = !current || current.isStream || duration <= 0;

  return `${pageHeader("Music", `Playback and queue for ${currentGuildName}.`)}
    <div class="music-layout">
      <section class="player">
        <div class="player-topline"><span class="table-meta">Now playing</span><span class="status-inline status-${paused ? "warn" : playing ? "ok" : "unknown"}"><i class="status-dot"></i>${paused ? "Paused" : playing ? "Playing" : "Idle"}</span></div>
        <div class="track-info"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(artist)}</p></div>
        <div class="player-progress"><output id="track-position" class="tabular">${escapeHtml(positionLabel)}</output><label class="sr-only" for="track-seek">Seek within current track</label><input id="track-seek" class="progress-line" type="range" min="0" max="${Math.max(duration, 1)}" value="${position}" aria-valuetext="${escapeHtml(`${positionLabel} of ${durationLabel}`)}" ${seekDisabled ? "disabled" : ""}><span class="tabular">${escapeHtml(durationLabel)}</span></div>
        <div class="transport">
          <button type="button" class="icon-button transport-secondary" data-action="music" data-music-action="shuffle" aria-label="Shuffle queue" ${queue.length < 2 ? "disabled" : ""}>${icon("shuffle")}</button>
          <button type="button" class="play-button" data-action="music" data-music-action="${playAction}" aria-label="${playLabel}">${icon(paused || !playing ? "play" : "pause")}</button>
          <button type="button" class="icon-button transport-secondary" data-action="music" data-music-action="skip" aria-label="Skip track" ${current || queue.length ? "" : "disabled"}>${icon("skip-forward")}</button>
          <button type="button" class="loop-button" data-action="music" data-music-action="loop" data-loop-mode="${loopNext}" aria-label="Change repeat mode. Currently ${escapeHtml(loop)}.">${icon("repeat")}<span>${escapeHtml(loop)} repeat</span></button>
        </div>
        <div class="volume-row">${icon("volume-up")}<label for="volume-control">Volume</label><input id="volume-control" type="range" min="0" max="150" value="${volume}" aria-valuetext="${volume} percent"><output for="volume-control" class="tabular">${volume}%</output></div>
        <form class="play-form" id="play-form"><label for="voice-channel">Voice channel ID</label><input id="voice-channel" name="voiceChannelId" type="text" inputmode="numeric" placeholder="Right-click a voice channel in Discord, then Copy ID" autocomplete="off" value="${escapeHtml(state.voiceChannelId ?? "")}"><label for="track-query">Add to queue</label><div class="input-action"><input id="track-query" name="query" type="search" placeholder="Song or artist…" autocomplete="off" required><button class="button button-primary" type="submit">Add track</button></div></form>
        <div class="player-actions"><button type="button" class="button button-secondary" data-action="music" data-music-action="join">Join voice</button><button type="button" class="button button-quiet" data-action="music" data-music-action="disconnect">Disconnect</button><button type="button" class="button button-quiet danger-text" data-action="music" data-music-action="stop" ${playing || paused ? "" : "disabled"}>Stop playback</button></div>
      </section>
      <section class="queue-panel"><div class="section-heading"><h2>Queue <span class="queue-count">${String(queue.length).padStart(2, "0")}</span></h2><button type="button" class="button button-quiet" data-action="music" data-music-action="clear" ${queue.length ? "" : "disabled"}>Clear queue</button></div><ol class="queue-list">${queueHtml}</ol></section>
    </div>`;
}

function currentGuildName() {
  return state.guilds.find((guild) => guild.id === state.guildId)?.name ?? "the selected server";
}

function discordLink(channelId, label = "Open in Discord") {
  if (!state.guildId || !channelId) return "";
  return `<a class="button button-secondary" href="https://discord.com/channels/${encodeURIComponent(state.guildId)}/${encodeURIComponent(channelId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function gameStatus(game) {
  if (game.status === "lobby") return { tone: "warn", label: "Lobby" };
  if (game.status === "paused") return { tone: "warn", label: "Paused" };
  if (game.status === "cancelled") return { tone: "danger", label: "Cancelled" };
  if (game.status === "finished") return { tone: "ok", label: "Finished" };
  if (game.status === "active") {
    const phase = game.phase === "submit" ? "Collecting cards" : game.phase === "judge" ? "Judging" : "Reveal";
    return { tone: "ok", label: phase };
  }
  return { tone: "unknown", label: "Unknown" };
}

function gameMetrics(entries) {
  return `<section class="metric-row" aria-label="Game metrics">${entries.map(([label, value]) => `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value tabular">${escapeHtml(value)}</strong></div>`).join("")}</section>`;
}

function refreshButton() {
  return `<button class="button button-secondary" type="button" data-action="refresh-games">Refresh</button>`;
}

function renderCah(data) {
  const enabled = data?.enabled !== false;
  const notice = enabled ? "" : permissionNotice("Cards Against Humanity is turned off for this server. Enable it in Features to host a game.");
  return `${pageHeader("Cards Against Humanity", `Live lobby and round state for ${currentGuildName()}.`, refreshButton())}${notice}<div data-live-panel="cah">${renderCahLive(data)}</div>`;
}

function renderCahLive(data) {
  const enabled = data?.enabled !== false;
  const game = data?.game ?? null;
  if (!game) {
    return enabled
      ? emptyState("No CAH game is running", "Create a lobby here, or start one in Discord with /cah host. Players join and play their hands in Discord.") + renderCahHostForm()
      : emptyState("Cards Against Humanity is off", "Enable the games-cah feature before hosting a lobby.");
  }

  const status = gameStatus(game);
  const players = Array.isArray(game.players) ? game.players : [];
  const slots = Array.isArray(game.slots) ? game.slots : [];
  const me = state.user?.id;
  const isHost = me === game.hostId;
  const isJudge = me === game.judgeId;
  const isAdmin = state.permissions.administrator;
  const round = Number.isInteger(game.roundIndex) ? `Round ${game.roundIndex + 1}` : "Lobby";
  const judgeText = game.judgeName ? escapeHtml(game.judgeName) : "Not selected";
  const roundText = game.roundIndex === null || game.roundIndex === undefined ? "" : `<span class="table-meta">${escapeHtml(round)} · ${fmtNumber(game.submissionCount)}/${fmtNumber(game.submissionExpected)} submitted</span>`;
  const slotsHtml = slots.length
    ? `<ol class="card-slots">${slots.map((slot) => `<li class="${slot.slot === game.winnerSlot ? "is-winner" : ""}"><span class="slot-label">Slot ${escapeHtml(slot.slot)}${slot.slot === game.winnerSlot ? " · winner" : ""}</span><p>${escapeHtml(slot.card)}</p></li>`).join("")}</ol>`
    : "";
  const winnerHtml = game.winnerSlot
    ? `<p class="game-note game-winner">Slot ${escapeHtml(game.winnerSlot)} wins for ${escapeHtml(game.winnerName ?? "an unknown player")}.</p>`
    : "";
  const judgeNote = game.phase === "judge"
    ? `<p class="game-note">The judge picks the winning slot in Discord. Slots are anonymized here.</p>`
    : "";

  const canStart = enabled && game.status === "lobby" && isHost;
  const canReveal = enabled && game.status === "active" && game.phase === "submit" && (isHost || isJudge);
  const canNext = enabled && game.status === "active" && game.phase === "reveal" && (isHost || isJudge);
  const canEnd = !["finished", "cancelled"].includes(game.status) && (isHost || isAdmin);
  const controls = [];
  if (canStart) {
    controls.push(`<button class="button button-primary" type="button" data-action="cah" data-cah-action="start" data-game-id="${escapeHtml(game.id)}">Start game</button>`);
  }
  if (canReveal) {
    controls.push(`<button class="button button-secondary" type="button" data-action="cah" data-cah-action="reveal" data-game-id="${escapeHtml(game.id)}" data-round-index="${escapeHtml(game.roundIndex ?? 0)}">Force reveal</button>`);
  }
  if (canNext) {
    controls.push(`<button class="button button-primary" type="button" data-action="cah" data-cah-action="next" data-game-id="${escapeHtml(game.id)}" data-round-index="${escapeHtml(game.roundIndex ?? 0)}">Next round</button>`);
  }
  if (canEnd) {
    controls.push(`<button class="button button-quiet danger-text" type="button" data-action="cah" data-cah-action="end" data-game-id="${escapeHtml(game.id)}">End game</button>`);
  }
  const hint = game.status === "lobby" && !isHost
    ? "Only the host can start this lobby. Players join in Discord."
    : game.status === "active" && game.phase === "judge"
      ? "Waiting for the judge in Discord."
      : game.status === "active" && game.phase === "submit" && !isHost && !isJudge
        ? "Only the host or judge can force a reveal."
        : "";
  const controlBlock = `<div class="game-controls">${controls.join("")}${discordLink(game.channelId)}</div>${hint ? `<p class="game-note">${escapeHtml(hint)}</p>` : ""}`;

  const scoreRows = players.map((player) => `<tr><td><strong>${escapeHtml(player.displayName)}</strong></td><td data-label="Role">${player.host ? `<span class="game-tag">Host</span>` : ""}${player.judge ? `<span class="game-tag">Judge</span>` : ""}</td><td class="numeric-cell" data-label="Score">${fmtNumber(player.score)}</td></tr>`).join("");
  const scores = players.length
    ? `<section class="table-panel"><div class="section-heading"><h2>Scores</h2><span class="table-meta">Goal ${fmtNumber(game.pointsGoal)}</span></div><div class="table-scroll"><table><thead><tr><th scope="col">Player</th><th scope="col">Role</th><th scope="col" class="numeric-cell">Score</th></tr></thead><tbody>${scoreRows}</tbody></table></div></section>`
    : `<p class="game-note">No players yet.</p>`;
  const restart = enabled && ["finished", "cancelled"].includes(game.status) ? renderCahHostForm() : "";

  return `<section class="game-layout">
    <div class="game-main">
      <div class="game-topline"><span class="status-inline status-${status.tone}"><i class="status-dot"></i>${escapeHtml(status.label)}</span>${roundText}</div>
      <p class="game-subline">Host ${escapeHtml(game.hostName)} · Judge ${judgeText} · Goal ${fmtNumber(game.pointsGoal)} points</p>
      ${gameMetrics([
        ["Players", `${fmtNumber(players.length)}/${fmtNumber(game.maxPlayers)}`],
        ["Submissions", `${fmtNumber(game.submissionCount)}/${fmtNumber(game.submissionExpected)}`],
        ["Black card", round],
      ])}
      ${game.blackCard ? `<section class="card-prompt"><span class="table-meta">Black card</span><p>${escapeHtml(game.blackCard)}</p></section>` : `<p class="game-note">The black card appears when the game starts.</p>`}
      ${slotsHtml}
      ${winnerHtml}
      ${judgeNote}
    </div>
    <aside class="game-side">
      ${controlBlock}
      ${scores}
    </aside>
  </section>${restart}`;
}

function renderCahHostForm() {
  return `<form class="settings-section" id="cah-host-form">
    <div class="settings-heading"><div><h2>Create a lobby</h2><p>The bot posts the lobby card in the channel. Members join, play hands, and judge rounds in Discord.</p></div><div class="settings-save"><button class="button button-primary" type="submit">Create lobby</button></div></div>
    <div class="settings-fields">
      <label class="setting-field" for="cah-channel"><span><strong>Text channel ID</strong><small>Right-click a text channel in Discord, then Copy ID.</small></span><input id="cah-channel" name="channelId" type="text" inputmode="numeric" autocomplete="off" required placeholder="123456789012345678"></label>
      <label class="setting-field" for="cah-points"><span><strong>Points to win</strong><small>1 to 50. Default 7.</small></span><input id="cah-points" name="pointsGoal" type="number" min="1" max="50" step="1" value="7" required></label>
      <label class="setting-field" for="cah-players"><span><strong>Maximum players</strong><small>3 to 10.</small></span><input id="cah-players" name="maxPlayers" type="number" min="3" max="10" step="1" value="10" required></label>
    </div>
    <div class="settings-feedback" data-feedback="cah-host" role="status" aria-live="polite"></div>
  </form>`;
}

function renderTambola(data) {
  const enabled = data?.enabled !== false;
  const notice = enabled ? "" : permissionNotice("Tambola is turned off for this server. Enable it in Features before starting a game.");
  return `${pageHeader("Tambola", `Live table for ${currentGuildName()}. Players join, buy tickets, and mark numbers in Discord.`, refreshButton())}${notice}<div data-live-panel="tambola">${renderTambolaLive(data)}</div>`;
}

function renderTambolaLive(data) {
  const enabled = data?.enabled !== false;
  const game = data?.game ?? null;
  if (!game) {
    return enabled
      ? emptyState("No Tambola game is running", "Start a lobby in Discord with /tambola host. This view follows the live table and can pause, resume, or end it.")
      : emptyState("Tambola is off", "Enable the games-tambola feature before starting a game.");
  }

  const status = gameStatus(game);
  const me = state.user?.id;
  const canControl = me === game.hostId || state.permissions.administrator;
  const lastCall = game.lastCall === null || game.lastCall === undefined ? "None" : String(game.lastCall);
  const claims = Array.isArray(game.claims) && game.claims.length
    ? `<ul class="claim-list">${game.claims.map((claim) => `<li><strong>${escapeHtml(claim.label)}</strong><span>${escapeHtml(claim.displayName)}</span><small>after ${fmtNumber(claim.atCall)} calls</small></li>`).join("")}</ul>`
    : `<p class="game-note">No claims yet.</p>`;
  const players = Array.isArray(game.players) ? game.players : [];
  const playerList = players.length
    ? `<ul class="player-chips">${players.map((player) => `<li>${escapeHtml(player.displayName)}</li>`).join("")}</ul>`
    : `<p class="game-note">No players yet.</p>`;
  const voice = game.voiceChannelId
    ? `${game.voiceConnected ? "Connected" : "Not connected"} · channel ${game.voiceChannelId}`
    : "Text only";
  const controls = [];
  if (canControl && game.status === "active") {
    controls.push(`<button class="button button-secondary" type="button" data-action="tambola" data-tambola-action="pause" data-game-id="${escapeHtml(game.id)}">Pause</button>`);
  }
  if (canControl && game.status === "paused") {
    controls.push(`<button class="button button-primary" type="button" data-action="tambola" data-tambola-action="resume" data-game-id="${escapeHtml(game.id)}">Resume</button>`);
  }
  if (canControl && !["finished", "cancelled"].includes(game.status)) {
    controls.push(`<button class="button button-quiet danger-text" type="button" data-action="tambola" data-tambola-action="end" data-game-id="${escapeHtml(game.id)}">End game</button>`);
  }
  const controlBlock = `<div class="game-controls">${controls.join("")}${discordLink(game.channelId)}</div>${canControl ? "" : `<p class="game-note">Only the host or an administrator can pause, resume, or end this game.</p>`}`;

  return `<section class="game-layout">
    <div class="game-main">
      <div class="game-topline"><span class="status-inline status-${status.tone}"><i class="status-dot"></i>${escapeHtml(status.label)}</span><span class="table-meta">Every ${fmtNumber(game.intervalSeconds)}s · auto-mark ${game.autoMark ? "on" : "off"}</span></div>
      <p class="game-subline">Host ${escapeHtml(game.hostName)} · ${escapeHtml(voice)}</p>
      ${gameMetrics([
        ["Players", `${fmtNumber(game.playerCount)}/${fmtNumber(game.maxPlayers)}`],
        ["Called", `${fmtNumber(game.calledCount)}/90`],
        ["Remaining", fmtNumber(game.remainingCalls)],
      ])}
      <section class="tambola-call"><span class="table-meta">Last call</span><strong class="tabular">${escapeHtml(lastCall)}</strong></section>
      <section class="section-block"><div class="section-heading"><h2>Claims</h2></div>${claims}</section>
    </div>
    <aside class="game-side">
      ${controlBlock}
      <section class="section-block"><div class="section-heading"><h2>Players</h2><span class="table-meta">${fmtNumber(game.playerCount)} joined</span></div>${playerList}</section>
    </aside>
  </section>`;
}

function renderCasino(data) {
  if (data?.discordRequired) {
    return `${pageHeader("Casino", "Play coinflip and slots for yourself.")}${permissionNotice("Sign in with Discord to play the casino. The dashboard needs your Discord user ID for the balance and bets.")}`;
  }
  const enabled = data?.enabled !== false;
  if (!enabled) {
    return `${pageHeader("Casino", "Play coinflip and slots for yourself.")}${permissionNotice("The economy is turned off for this server. Enable economy-core in Features to play.")}`;
  }
  const maxBet = Number(data?.maxBet) || 10_000;
  const busy = state.casinoBusy === true;
  const result = state.casinoResult;
  return `${pageHeader("Casino", "Play coinflip and slots for yourself. No administrator permission is required.")}
    ${gameMetrics([
      ["Balance", `${fmtNumber(data?.balance)} SC`],
      ["Maximum bet", `${fmtNumber(maxBet)} SC`],
      ["Games", "2"],
    ])}
    ${renderCasinoResult(result)}
    <div class="casino-forms">
      <form id="casino-coinflip-form" class="settings-section">
        <div class="settings-heading"><div><h2>Coinflip</h2><p>A win pays 2x the bet. The win chance is 48%.</p></div><div class="settings-save"><button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>Flip</button></div></div>
        <div class="settings-fields casino-fields">
          <label class="setting-field" for="casino-coinflip-bet"><span><strong>Bet</strong><small>Whole coins, up to ${fmtNumber(maxBet)}.</small></span><input id="casino-coinflip-bet" name="bet" type="number" min="1" max="${maxBet}" step="1" value="100" required ${busy ? "disabled" : ""}></label>
          <label class="setting-field" for="casino-coinflip-side"><span><strong>Side</strong></span><select id="casino-coinflip-side" name="side" ${busy ? "disabled" : ""}><option value="heads">Heads</option><option value="tails">Tails</option></select></label>
        </div>
      </form>
      <form id="casino-slots-form" class="settings-section">
        <div class="settings-heading"><div><h2>Slots</h2><p>Three of a kind pays 5x. A pair pays 1.6x, rounded down.</p></div><div class="settings-save"><button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>Spin</button></div></div>
        <div class="settings-fields casino-fields">
          <label class="setting-field" for="casino-slots-bet"><span><strong>Bet</strong><small>Whole coins, up to ${fmtNumber(maxBet)}.</small></span><input id="casino-slots-bet" name="bet" type="number" min="1" max="${maxBet}" step="1" value="100" required ${busy ? "disabled" : ""}></label>
        </div>
      </form>
    </div>
    <p class="game-note">The maximum bet is ${fmtNumber(maxBet)} SC per play. A bet is taken once per request even if the browser retries.</p>
    <div class="settings-feedback" data-feedback="casino" role="status" aria-live="polite"></div>`;
}

function renderCasinoResult(result) {
  if (!result) return "";
  if (result.game === "coinflip") {
    const won = result.win === true;
    return `<section class="casino-result ${won ? "is-win" : "is-loss"}" role="status"><span class="table-meta">Last flip</span><h2>${won ? "You won" : "You lost"}</h2><p>The coin landed ${escapeHtml(result.result)}. ${won ? `Payout ${fmtNumber(result.payout)} SC` : `Lost ${fmtNumber(result.bet)} SC`}.</p></section>`;
  }
  const reels = Array.isArray(result.reels) ? result.reels : [];
  const label = result.multiplier === 5 ? "Three of a kind, 5x." : result.multiplier === 1.6 ? "A pair, 1.6x." : "No match.";
  return `<section class="casino-result ${result.payout > 0 ? "is-win" : "is-loss"}" role="status"><span class="table-meta">Last spin</span><div class="reel-row">${reels.map((reel) => `<span class="reel">${escapeHtml(reel)}</span>`).join("")}</div><p>${escapeHtml(label)} ${result.payout > 0 ? `Payout ${fmtNumber(result.payout)} SC` : `Lost ${fmtNumber(result.bet)} SC`}.</p></section>`;
}

export function renderLivePanel(view, data) {
  if (view === "cah") return renderCahLive(data);
  if (view === "tambola") return renderTambolaLive(data);
  return "";
}

function getSectionValue(data, section) {
  const value = data?.[section];
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function renderSettings(data) {
  const canManage = state.permissions.administrator;
  const sections = [
    ["prefix", "Command prefix", "How members call text commands."],
    ["welcome", "Welcome messages", "Member join and leave messages."],
    ["autorole", "Auto role", "Roles assigned when a member joins."],
    ["tempvc", "Temporary voice", "Rooms created from a voice channel hub."],
    ["music", "Music defaults", "Queue and player defaults for this server."],
  ];
  const banner = canManage ? "" : permissionNotice("Administrator permission required to change server settings.");
  return `${pageHeader("Server settings", "Changes save to the selected server when you submit each section.")}${banner}<div class="settings-list">${sections.map(([key, title, description]) => {
    const value = getSectionValue(data, key);
    const fields = editableFields[key].filter((field) => Object.prototype.hasOwnProperty.call(value, field));
    const fieldHtml = fields.length ? fields.map((field) => renderConfigField(field, value[field], !canManage)).join("") : `<p class="settings-empty">This setting is not configured yet.</p>`;
    return `<form class="settings-section" data-config-section="${key}"><div class="settings-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="settings-save"><span class="settings-dirty" aria-hidden="true"></span><button class="button button-secondary" type="submit" data-save-section="${key}" disabled>Save</button></div></div><div class="settings-fields">${fieldHtml}</div><div class="settings-feedback" data-feedback="${key}" role="status" aria-live="polite"></div></form>`;
  }).join("")}</div>`;
}

function renderConfigField(field, value, disabled = false) {
  const label = labels[field] ?? field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/^./, (letter) => letter.toUpperCase());
  const hint = hints[field] ? `<small>${escapeHtml(hints[field])}</small>` : "";
  const off = disabled ? "disabled" : "";
  if (typeof value === "boolean") {
    return `<div class="setting-field setting-switch-field"><div><strong>${escapeHtml(label)}</strong>${hint}</div><button type="button" class="switch" role="switch" aria-checked="${value}" aria-label="${escapeHtml(label)}" data-setting-toggle="${escapeHtml(field)}" ${off}><span></span></button></div>`;
  }
  const isList = Array.isArray(value);
  const longText = field === "message" || field === "dmMessage" || field === "goodbyeMessage";
  const type = typeof value === "number" ? "number" : "text";
  const valueString = isList ? value.join(", ") : value == null ? "" : String(value);
  const control = isList
    ? `<input id="setting-${escapeHtml(field)}" name="${escapeHtml(field)}" data-config-key="${escapeHtml(field)}" data-config-type="list" type="text" value="${escapeHtml(valueString)}" placeholder="Comma-separated IDs" autocomplete="off" inputmode="numeric" ${off}>`
    : longText
      ? `<textarea id="setting-${escapeHtml(field)}" name="${escapeHtml(field)}" data-config-key="${escapeHtml(field)}" data-config-type="text" rows="3" ${off}>${escapeHtml(valueString)}</textarea>`
    : `<input id="setting-${escapeHtml(field)}" name="${escapeHtml(field)}" data-config-key="${escapeHtml(field)}" data-config-type="${type}" type="${type}" value="${escapeHtml(valueString)}" ${type === "number" ? "step=1" : "autocomplete=off"} ${off}>`;
  return `<label class="setting-field" for="setting-${escapeHtml(field)}"><span><strong>${escapeHtml(label)}</strong>${hint}</span>${control}</label>`;
}

function renderUserSettings(data) {
  const user = state.user;
  const name = user?.name || "Operator";
  const discordUser = typeof user?.id === "string" && /^\d{17,20}$/.test(user.id);
  const birthday = data?.birthday ?? null;
  const avatar = user?.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : "";
  const profile = `<section class="profile-card" aria-label="Signed-in profile"><span class="profile-avatar" data-initial="${escapeHtml(initialOf(name))}">${avatar}</span><div class="profile-copy"><h2>${escapeHtml(name)}</h2><p>${discordUser ? `Discord ID ${escapeHtml(user.id)}` : "Dashboard operator"}</p></div></section>`;
  if (!discordUser) {
    return `${pageHeader("User settings", "Your profile and birthday for this server.")}${profile}${permissionNotice("Sign in with Discord to manage your birthday.")}`;
  }
  const month = birthday?.month ? String(birthday.month) : "";
  const day = birthday?.day ? String(birthday.day) : "";
  const year = birthday?.birthYear ? String(birthday.birthYear) : "";
  const currentYear = new Date().getFullYear();
  const monthOptions = MONTHS.map((label, index) => `<option value="${index + 1}" ${String(index + 1) === month ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const clearDisabled = birthday ? "" : "disabled";
  return `${pageHeader("User settings", "Your profile and birthday for this server.")}${profile}
    <form id="birthday-form" class="settings-section" data-birthday-form>
      <div class="settings-heading"><div><h2>Birthday</h2><p>The bot reads this to post a birthday message in the selected server.</p></div><div class="settings-save"><button class="button button-secondary" type="submit" data-birthday-save>Save</button></div></div>
      <div class="settings-fields birthday-fields">
        <label class="setting-field" for="birthday-month"><span><strong>Month</strong></span><select id="birthday-month" name="month" required><option value="" ${month ? "" : "selected"} disabled>Select a month</option>${monthOptions}</select></label>
        <label class="setting-field" for="birthday-day"><span><strong>Day</strong></span><input id="birthday-day" name="day" type="number" min="1" max="31" step="1" value="${escapeHtml(day)}" required></label>
        <label class="setting-field" for="birthday-year"><span><strong>Year</strong><small>Optional. Leave blank to hide your age.</small></span><input id="birthday-year" name="year" type="number" min="1900" max="${currentYear}" step="1" value="${escapeHtml(year)}"></label>
      </div>
      <div class="settings-feedback" data-feedback="birthday" role="status" aria-live="polite"></div>
    </form>
    <section class="settings-section birthday-clear"><div class="settings-heading"><div><h2>Clear birthday</h2><p>Remove your birthday from this server. The bot stops posting a message.</p></div><button class="button button-secondary danger-text" type="button" data-action="clear-birthday" ${clearDisabled}>Clear</button></div></section>`;
}

function renderAudit(data) {
  const entries = list(data, "entries");
  const rows = entries.map((entry) => `<tr><td><strong>${escapeHtml(entry.action ?? entry.type ?? "Control action")}</strong></td><td data-label="Actor">${actorMarkup(entry)}</td><td data-label="Source"><span class="source-tag">${escapeHtml(entry.source ?? "system")}</span></td><td data-label="Target">${escapeHtml(entry.targetId ?? entry.target ?? "Not reported")}</td><td data-label="Time"><time datetime="${escapeHtml(entry.createdAt ?? "")}">${escapeHtml(fmtDate(entry.createdAt))}</time></td></tr>`).join("");
  return `${pageHeader("Audit", `Recent control actions for ${state.guildId ? (state.guilds.find((guild) => guild.id === state.guildId)?.name ?? "the selected server") : "the selected server"}.`)}<section class="table-panel">${entries.length ? `<div class="table-scroll"><table><thead><tr><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Source</th><th scope="col">Target</th><th scope="col">Time</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No audit entries", "Changes made through the dashboard will appear here.", `<button class="button button-secondary" type="button" data-action="retry">Refresh audit</button>`)}</section>`;
}

function renderCommands(data) {
  const commands = list(data, "commands");
  const search = state.search.toLowerCase().trim();
  const visible = commands.filter((command) => [command.name, command.category, command.description, command.usage].join(" ").toLowerCase().includes(search));
  const hasUsage = visible.some((command) => String(command.usage ?? "").trim());
  const rows = visible.map((command) => `<tr><td><code class="command-name">/${escapeHtml(command.name)}</code>${Array.isArray(command.aliases) && command.aliases.length ? `<small class="table-subline">Also ${command.aliases.map((alias) => `/${escapeHtml(alias)}`).join(", ")}</small>` : ""}</td><td data-label="Category"><span class="category-tag">${escapeHtml(command.category ?? "General")}</span></td><td>${escapeHtml(command.description ?? "")}</td>${hasUsage ? `<td data-label="Usage">${String(command.usage ?? "").trim() ? `<code class="usage-code">${escapeHtml(command.usage)}</code>` : `<span class="usage-empty">Not set</span>`}</td>` : ""}</tr>`).join("");
  const usageHead = hasUsage ? `<th scope="col">Usage</th>` : "";
  const message = commands.length ? (visible.length ? `<div class="table-scroll"><table class="command-table"><thead><tr><th scope="col">Command</th><th scope="col">Category</th><th scope="col">Description</th>${usageHead}</tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No matching commands", `No results for “${state.search}”.`)) : emptyState("No commands returned", "The command registry is empty or unavailable.", `<button class="button button-secondary" type="button" data-action="retry">Reload commands</button>`);
  return `${pageHeader("Commands", `${fmtNumber(commands.length)} registered commands and aliases.`)}<div class="toolbar-row">${searchBox("Search commands")}${state.search ? `<span class="result-count" role="status">${renderSearchResultsCount(visible.length, commands.length)}</span>` : ""}</div><section class="table-panel">${message}</section>`;
}

export function renderStatusPill(status) {
  const ready = status?.ready === true;
  const text = ready ? "Ready" : status ? "Offline" : "Loading";
  return `<span class="status-pill status-${status ? (ready ? "ok" : "danger") : "unknown"}"><span class="status-dot"></span>${text}</span>`;
}

export function viewTitle(view) {
  return titles[view] ?? "Overview";
}

export function renderSearchResultsCount(count, total) {
  return `${fmtNumber(count)} of ${fmtNumber(total)} results`;
}
