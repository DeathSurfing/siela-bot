import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
import type { ControlClient, ScheduledEventPayload, ScheduledEventUpdatePayload } from "../src/control-client.js";
import { createDashboardServer } from "../src/server.js";
import { loadDashboardConfig } from "../src/config.js";

const guildId = "123456789012345678";
const userId = "234567890123456789";
const voiceChannelId = "345678901234567890";
const config = loadDashboardConfig({
  DASHBOARD_PASSWORD: "browser-check-password",
  DASHBOARD_SESSION_SECRET: "browser-check-session-secret-value-with-over-32-characters",
  MCP_TOKEN: "browser-check-control-token-value",
  NODE_ENV: "test",
});

interface EventRow {
  id: number;
  name: string;
  channelId: string;
  sourceUrl: string;
  repeat: "none" | "daily" | "weekly";
  enabled: boolean;
  startAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "running" | "success" | "failed" | "skipped" | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RunRow {
  id: number;
  eventName: string;
  status: "running" | "success" | "failed" | "skipped";
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

const events: EventRow[] = [];
const runs: RunRow[] = [];
const calls: Array<{ action: string; eventId?: number; body?: Record<string, unknown> }> = [];
let administrator = true;
let nextEventId = 1;
let nextRunId = 1;

function eventState() {
  return {
    enabled: true,
    schedulerEnabled: true,
    events: [...events],
    runs: [...runs],
    builtIn: [{ key: "azan", channelName: "masjid", source: "azan", youtube: false, offsetMs: 0 }],
  };
}

const control: ControlClient = {
  getStatus: async () => ({ ready: true, version: "browser-check" }),
  getGuilds: async () => ({ guilds: [{ id: guildId, name: "Browser Guild", iconUrl: null, memberCount: 4, available: true }] }),
  resolve: async (_guildId: string, query: string, kind?: string) => ({
    results: query.replace(/^[#@]/, "").toLowerCase() === "general" && kind === "voice"
      ? [{ id: voiceChannelId, name: "general", label: "#general", kind: "voice" }]
      : [],
  }),
  getFeatures: async () => ({ features: [] }),
  updateFeature: async () => ({ ok: true }),
  getAudit: async () => ({ entries: [] }),
  getMusic: async () => ({ queue: [] }),
  musicAction: async () => ({ ok: true }),
  getScheduledEvents: async () => eventState(),
  createScheduledEvent: async (_guild: string, body: ScheduledEventPayload, actor: string) => {
    calls.push({ action: "create", body: { ...body, actor } });
    const now = new Date().toISOString();
    const event: EventRow = {
      id: nextEventId++,
      name: String(body.name),
      channelId: String(body.channelId),
      sourceUrl: String(body.sourceUrl),
      repeat: body.repeat as EventRow["repeat"],
      enabled: body.enabled === true,
      startAt: String(body.startAt),
      nextRunAt: String(body.startAt),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    events.push(event);
    return eventState();
  },
  updateScheduledEvent: async (_guild: string, eventId: number, body: ScheduledEventUpdatePayload, actor: string) => {
    calls.push({ action: "update", eventId, body: { ...body, actor } });
    const event = events.find((row) => row.id === eventId);
    if (event) {
      Object.assign(event, body, { updatedAt: new Date().toISOString() });
      if (typeof body.startAt === "string") event.nextRunAt = body.startAt;
    }
    return eventState();
  },
  deleteScheduledEvent: async (_guild: string, eventId: number, actor: string) => {
    calls.push({ action: "delete", eventId, body: { actor } });
    const index = events.findIndex((row) => row.id === eventId);
    const name = events[index]?.name;
    if (index >= 0) events.splice(index, 1);
    for (let i = runs.length - 1; i >= 0; i -= 1) if (runs[i]?.eventName === name) runs.splice(i, 1);
    return eventState();
  },
  runScheduledEvent: async (_guild: string, eventId: number, actor: string) => {
    calls.push({ action: "run", eventId, body: { actor } });
    const event = events.find((row) => row.id === eventId);
    if (event) {
      const now = new Date().toISOString();
      event.lastRunAt = now;
      event.lastStatus = "running";
      runs.unshift({ id: nextRunId++, eventName: event.name, status: "running", triggeredBy: actor, startedAt: now, finishedAt: null, error: null });
    }
    return eventState();
  },
  getConfig: async () => ({}),
  patchConfig: async () => ({}),
  getCommands: async () => ({ commands: [] }),
  authorize: async () => ({ administrator, user: { id: userId, name: "Operator" } }),
  getBirthday: async () => ({ birthday: null }),
  setBirthday: async () => ({ birthday: null }),
  clearBirthday: async () => ({ ok: true }),
  cahState: async () => ({ enabled: true, game: null }),
  cahHost: async () => ({ enabled: true, game: null }),
  cahAction: async () => ({ enabled: true, game: null }),
  tambolaState: async () => ({ enabled: true, game: null }),
  tambolaAction: async () => ({ enabled: true, game: null }),
  casinoState: async () => ({ enabled: true }),
  casinoPlay: async () => ({ enabled: true }),
  economyState: async () => ({ enabled: true }),
  economyAction: async () => ({ enabled: true }),
  economyLeaderboard: async () => ({ enabled: true, entries: [] }),
  stockState: async () => ({ enabled: true }),
  stockTrade: async () => ({ enabled: true }),
};

const app = createDashboardServer({
  config,
  publicDir: path.resolve(import.meta.dir, "../public"),
  control,
});
const origin = await app.listen({ host: "127.0.0.1", port: 0 });
if (process.argv.includes("--serve-only")) {
  console.log(origin);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await app.close();
  process.exit(0);
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${origin}/#/g/${guildId}/events`);
  await page.getByLabel("Dashboard password").fill("browser-check-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Scheduled Events", exact: true }).waitFor();
  await page.getByLabel("Name", { exact: true }).waitFor();

  const startAt = new Date(Date.now() + 60 * 60_000);
  const localStart = new Date(startAt.getTime() - startAt.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.locator("#scheduled-event-name").fill("Morning music");
  await page.locator("#scheduled-event-channel").fill("#general");
  await page.locator("#scheduled-event-url").fill("https://youtu.be/abcdefghijk");
  await page.locator("#scheduled-event-start").fill(localStart);
  await page.locator("#scheduled-event-repeat").selectOption("daily");
  await page.locator("#scheduled-event-form button[type=submit]").click();
  await page.getByText("Morning music", { exact: true }).waitFor();
  assert.equal(calls[0]?.action, "create");
  assert.equal(calls[0]?.body?.channelId, voiceChannelId, "the voice resolver stores the selected channel ID");
  assert.equal(calls[0]?.body?.startAt, new Date(localStart).toISOString(), "the local datetime becomes an ISO timestamp");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.locator("#scheduled-event-name").inputValue(), "Morning music");
  await page.locator("#scheduled-event-name").fill("Morning music revised");
  await page.locator("#scheduled-event-form button[type=submit]").click();
  await page.getByText("Morning music revised", { exact: true }).waitFor();
  assert.equal(calls.at(-1)?.body?.startAt, undefined, "editing an unchanged start time omits it from the PATCH body");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const changedStart = new Date(Date.now() + 2 * 60 * 60_000);
  const changedLocalStart = new Date(changedStart.getTime() - changedStart.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.locator("#scheduled-event-start").fill(changedLocalStart);
  await page.locator("#scheduled-event-form button[type=submit]").click();
  await page.getByText("Morning music revised", { exact: true }).waitFor();
  assert.equal(calls.at(-1)?.body?.startAt, new Date(changedLocalStart).toISOString(), "a changed start time is sent as ISO");

  await page.getByRole("switch", { name: "Disable Morning music revised" }).click();
  await page.waitForFunction(() => document.querySelector('[data-action="event-toggle"]')?.getAttribute("aria-checked") === "false");
  assert.equal(calls.at(-1)?.action, "update");
  assert.equal(calls.at(-1)?.body?.enabled, false, "the event switch saves its enabled state");

  await page.evaluate(() => {
    const confirmations: string[] = [];
    window.confirm = (message) => { confirmations.push(message ?? ""); return true; };
    Object.assign(window, { __eventConfirmations: confirmations });
  });
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await page.getByText("Running", { exact: true }).first().waitFor();
  assert.match(String(await page.evaluate(() => (window as unknown as Window & { __eventConfirmations: string[] }).__eventConfirmations[0])), /Run “Morning music revised” now/);
  assert.equal(calls.at(-1)?.action, "run");

  const runningEvent = events.find((event) => event.lastStatus === "running");
  const runningRun = runs.find((run) => run.status === "running");
  assert.ok(runningEvent && runningRun, "manual run returns while its status is running");
  runningEvent.lastStatus = "success";
  runningEvent.runCount += 1;
  runningRun.status = "success";
  runningRun.finishedAt = new Date().toISOString();
  await page.reload();
  await page.getByRole("heading", { name: "Scheduled Events", exact: true }).waitFor();
  await page.getByText("Success", { exact: true }).first().waitFor();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("No scheduled events", { exact: true }).waitFor();
  assert.match(String(await page.evaluate(() => (window as unknown as Window & { __eventConfirmations: string[] }).__eventConfirmations[1])), /Delete “Morning music revised”/);
  assert.equal(calls.at(-1)?.action, "delete");

  administrator = false;
  await page.reload();
  await page.getByRole("heading", { name: "Scheduled Events", exact: true }).waitFor();
  assert.equal(await page.locator("#scheduled-event-form").count(), 0);
  assert.equal(await page.locator("[data-action^='event-']").count(), 0, "non-administrators do not see event controls");

  await page.setViewportSize({ width: 1200, height: 900 });
  assert.equal(await page.locator("h1").textContent(), "Scheduled Events");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "the desktop view has no horizontal overflow");
  await page.setViewportSize({ width: 380, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "the mobile view has no horizontal overflow");
  assert.deepEqual(consoleErrors, []);
  console.log("Scheduled Events browser check passed at 1200px and 380px.");
} finally {
  await browser?.close();
  await app.close();
}
