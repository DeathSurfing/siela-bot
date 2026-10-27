/** Render real Discord payloads into an offline visual review sheet. No Discord posts. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { GuildMember } from "discord.js";
import type { BotConfig } from "@siela/config";
import type { ReplyPayload } from "../framework/types.js";
import { CommandRegistry } from "../framework/registry.js";
import { commands } from "../commands/index.js";
import { buildDeluluPayload } from "../features/delulu-ui.js";
import { buildMusicPayload } from "../features/music-ui.js";
import { buildHelpPayload } from "../features/help.js";
import { buildTambolaLobbyPayload } from "../features/tambola-ui.js";
import { TambolaGame } from "../features/tambola/game.js";
import { card, confirmCard } from "../features/ui.js";

const out = resolve(process.argv[2] ?? "outputs/discord-ui-preview");
await mkdir(out, { recursive: true });
const registry = new CommandRegistry().register(...commands);
const member = { id: "preview", guild: { ownerId: "preview" }, permissions: { has: () => true } } as unknown as GuildMember;
const config = { botOwnerId: null, adminRoleIds: [] } as unknown as BotConfig;
const game = new TambolaGame({ id: "PREVIEW", guildId: "preview", channelId: "preview", hostId: "preview", autoMark: true });
game.addPlayer("preview", "You"); game.addPlayer("preview-2", "A friend");
const examples: Array<[string, ReplyPayload]> = [
  ["Delulu / story card", buildDeluluPayload({
    bias: "RM", nsfw: false, cost: 5, use: 1,
    scenario: 'You are at the rooftop pool after hours, with a lighthouse sweeping the bay. RM pockets your attention and your drink sweats through the napkin. Suddenly a second dessert arrives with your name written in chocolate. RM says, "I planned zero of this and all of it for you."',
  })],
  ["Music / listening room", buildMusicPayload("preview", {
    playing: true, paused: false, volume: 72, loop: "off", position: 47000,
    current: { title: "snowfall", author: "Øneheart, reidenshi", length: 124000, uri: "https://example.invalid/preview", artworkUrl: null, isStream: false },
    upcoming: [{ title: "a walk in the clouds", author: "idealism", length: 168000, uri: "https://example.invalid/next", artworkUrl: null, isStream: false }],
  }, "A soundtrack worth staying up for.")],
  ["Economy / your wallet", card({ theme: "economy", eyebrow: "THE WALLET / SIELA COINS", title: "Your balance", subtitle: "Good things add up.", fields: [{ label: "AVAILABLE BALANCE", value: "2,450 SC" }, { label: "DAILY STREAK", value: "7 days" }], body: "**Last daily** · 2 hours ago", footer: "Earn a little more with /economy daily or /economy work." })],
  ["Help / command guide", await buildHelpPayload({ registry, member, config, prefix: "!" })],
  ["Games / Tambola lobby", buildTambolaLobbyPayload(game, null)],
  ["Admin / confirmation", confirmCard({ title: "Clear the music queue?", body: "This removes the upcoming tracks from this room. Your currently playing track will continue.", confirmId: "preview:confirm", cancelId: "preview:cancel", confirmLabel: "Clear queue" })],
];

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function inline(value: string): string {
  return esc(value.replace(/\\([\s\S])/g, "$1"))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/&lt;@[^&]+&gt;/g, "@You");
}
function markdown(value: string): string {
  return value.split("\n").map(line => {
    if (line.startsWith("-# ")) return `<div class="subtext">${inline(line.slice(3))}</div>`;
    if (line.startsWith("### ")) return `<h3>${inline(line.slice(4))}</h3>`;
    if (line.startsWith("## ")) return `<h2>${inline(line.slice(3))}</h2>`;
    if (line.startsWith("> ")) return `<blockquote>${inline(line.slice(2))}</blockquote>`;
    return line ? `<div class="line">${inline(line)}</div>` : '<div class="spacer"></div>';
  }).join("");
}
function render(node: any, prefix: string): string {
  if (node.type === 17) return `<div class="discord-container" style="--accent:#${node.accent_color.toString(16).padStart(6, "0")}">${node.components.map((n: unknown) => render(n, prefix)).join("")}</div>`;
  if (node.type === 10) return `<div class="text-display">${markdown(node.content)}</div>`;
  if (node.type === 14) return node.divider ? '<hr>' : '<div class="soft-space"></div>';
  if (node.type === 12) return node.items.map((n: any) => `<img class="hero-image" alt="${esc(n.description)}" src="${prefix}-${esc(n.media.url.replace('attachment://', ''))}">`).join("");
  if (node.type === 9) return `<div class="section">${node.components.map((n: unknown) => render(n, prefix)).join("")}</div>`;
  if (node.type === 1) return `<div class="action-row">${node.components.map((n: unknown) => render(n, prefix)).join("")}</div>`;
  if (node.type === 2) return `<button disabled class="discord-button style-${node.style}">${esc(node.emoji?.name ?? "")} ${esc(node.label ?? "")}</button>`;
  if (node.type === 3 || node.type === 8) return `<div class="discord-select">${esc(node.placeholder ?? 'Choose an option')}<span>⌄</span></div>`;
  return "";
}
const snapshots = [];
const sheets = [];
for (let i = 0; i < examples.length; i += 1) {
  const [title, payload] = examples[i]!;
  const prefix = `preview-${i}`;
  for (const file of payload.files ?? []) {
    if (Buffer.isBuffer(file.attachment)) await writeFile(join(out, `${prefix}-${file.name}`), file.attachment);
  }
  const components = (payload.components ?? []).map((n: any) => n.toJSON());
  snapshots.push({ title, flags: payload.flags, components });
  sheets.push(`<article><div class="example-title">${esc(title)}</div><div class="message"><div class="bot-avatar">s.</div><div class="message-content"><div class="message-author">Siela <span>APP</span><time>Today at 8:26 AM</time></div>${components.map((n: unknown) => render(n, prefix)).join("")}</div></div></article>`);
}
await writeFile(join(out, "payloads.json"), JSON.stringify(snapshots, null, 2));
await writeFile(join(out, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Siela / Discord UI redesign</title><style>
*{box-sizing:border-box}body{margin:0;background:#1e1f22;color:#e8e7ee;font:15px 'Segoe UI',Arial,sans-serif;padding:35px 28px}header{max-width:1400px;margin:0 auto 28px}header p{color:#a7a0b3;font-size:12px;line-height:1.7}header h1{font-size:28px;letter-spacing:-1px;margin:8px 0}.eyebrow{font-size:10px;letter-spacing:2px;color:#bda8eb}.gallery{max-width:1400px;margin:auto;display:grid;grid-template-columns:1fr 1fr;gap:30px 25px;align-items:start}article{min-width:0}.example-title{font-size:11px;letter-spacing:.5px;color:#9c91ad;margin:0 0 12px}.message{display:flex;gap:12px;background:#29292f;padding:20px 15px 20px 12px;border:1px solid #34323b;border-radius:12px}.bot-avatar{height:35px;width:35px;flex-shrink:0;background:linear-gradient(135deg,#b39be4,#6b4f9b);border-radius:50%;color:#f6eeff;font-size:22px;font-weight:750;display:grid;place-items:center;letter-spacing:-2px}.message-content{flex:1;min-width:0}.message-author{font-size:13px;font-weight:650;margin-bottom:9px}.message-author>span{font-size:8px;background:#7760ae;color:white;border-radius:3px;padding:2px 4px;margin-left:4px;vertical-align:middle}.message-author time{color:#8f8998;font-size:9px;margin-left:8px;font-weight:400}.discord-container{border:1px solid #38323f;border-left:4px solid var(--accent);background:#111216;border-radius:9px;padding:15px 16px;overflow:hidden}.text-display{margin:0 0 10px;line-height:1.65;color:#d4d0dc}.text-display:last-child{margin-bottom:0}.text-display>.subtext:first-child{margin-top:0}.subtext{font-size:10px;color:#9d91aa;line-height:1.7}h2{font-size:21px;color:#f4eef9;margin:0 0 4px;letter-spacing:-.4px;line-height:1.3}h3{font-size:18px;margin:4px 0 2px;line-height:1.4;color:#f4eafa}.hero-image{width:100%;border-radius:7px;display:block;margin:13px 0 18px}hr{border:0;border-top:1px solid #36303d;margin:13px 0}.line{font-size:13px;line-height:1.85}strong{font-weight:650;color:#ece3f4}.spacer{height:11px}.soft-space{height:5px}blockquote{border-left:3px solid var(--accent);padding-left:12px;margin:0;color:#e4c7e5;font-size:14px;line-height:1.8;background:#ffffff03}blockquote strong{color:#d6b0d7}code{font:11px Consolas,monospace;padding:2px 4px;background:#24222b;border-radius:4px;color:#d5c5e4}.action-row{display:flex;gap:7px;margin:9px 0;flex-wrap:wrap}.discord-button{border:1px solid #4a4353;background:#302d37;color:#e2dbea;font-size:11px;padding:8px 12px;border-radius:5px;opacity:1}.discord-button.style-1{background:#7360b2;border-color:#7360b2;color:#fff}.discord-button.style-3{background:#377e63;border-color:#377e63}.discord-button.style-4{background:#9d4b60;border-color:#9d4b60}.discord-select{padding:10px 12px;border:1px solid #48404f;background:#25222c;border-radius:5px;width:100%;font-size:11px;color:#c2b5d0}.discord-select span{float:right}.section{display:flex;flex-direction:column;gap:3px}@media(max-width:1000px){.gallery{grid-template-columns:1fr;max-width:700px}header{max-width:700px}body{padding:25px 16px}.message{padding:15px 10px;gap:9px}}@media(max-width:480px){body{padding:20px 8px}.bot-avatar{display:none}.discord-container{padding:12px}.line{font-size:12px}h2{font-size:19px}}
</style></head><body><header><span class="eyebrow">SIELA / THE DISCORD DESIGN SYSTEM</span><h1>Same community. A whole new feeling.</h1><p>Actual generated message payloads, shown in a Discord-style visual approximation. Buttons are disabled in this preview. No messages were posted to your server.</p></header><main class="gallery">${sheets.join("")}</main></body></html>`);
console.log(`Generated ${examples.length} Discord UI previews in ${out}`);
