let csrfToken = null;

export function setCsrfToken(value) {
  csrfToken = value;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers["x-csrf-token"] = csrfToken ?? "";
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("The dashboard could not reach its server. Check your connection and retry.", 0, "dashboard_unreachable");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(error?.message ?? `Request failed with status ${response.status}.`, response.status, error?.code ?? "request_failed");
  }
  return payload;
}

export const api = {
  session: () => request("/api/session"),
  login: (password) => request("/api/login", { method: "POST", body: { password } }),
  logout: () => request("/api/logout", { method: "POST", body: {} }),
  status: () => request("/api/status"),
  guilds: () => request("/api/guilds"),
  features: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/features`),
  feature: (guildId, featureId, enabled) => request(`/api/guilds/${encodeURIComponent(guildId)}/features/${encodeURIComponent(featureId)}`, { method: "PATCH", body: { enabled } }),
  audit: (guildId, limit = 50) => request(`/api/guilds/${encodeURIComponent(guildId)}/audit?limit=${limit}`),
  music: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/music`),
  musicAction: (guildId, action, body = {}) => request(`/api/guilds/${encodeURIComponent(guildId)}/music/${encodeURIComponent(action)}`, { method: "POST", body }),
  cah: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/cah`),
  cahHost: (guildId, body) => request(`/api/guilds/${encodeURIComponent(guildId)}/cah/host`, { method: "POST", body }),
  cahAction: (guildId, action, body = {}) => request(`/api/guilds/${encodeURIComponent(guildId)}/cah/${encodeURIComponent(action)}`, { method: "POST", body }),
  tambola: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/tambola`),
  tambolaAction: (guildId, action, body = {}) => request(`/api/guilds/${encodeURIComponent(guildId)}/tambola/${encodeURIComponent(action)}`, { method: "POST", body }),
  casino: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/casino`),
  casinoPlay: (guildId, game, body = {}) => request(`/api/guilds/${encodeURIComponent(guildId)}/casino/${encodeURIComponent(game)}`, { method: "POST", body }),
  config: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/config`),
  patchConfig: (guildId, section, body) => request(`/api/guilds/${encodeURIComponent(guildId)}/config/${encodeURIComponent(section)}`, { method: "PATCH", body }),
  commands: () => request("/api/commands"),
  permissions: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/permissions`),
  birthday: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/me/birthday`),
  setBirthday: (guildId, body) => request(`/api/guilds/${encodeURIComponent(guildId)}/me/birthday`, { method: "PUT", body }),
  clearBirthday: (guildId) => request(`/api/guilds/${encodeURIComponent(guildId)}/me/birthday`, { method: "DELETE" }),
};
