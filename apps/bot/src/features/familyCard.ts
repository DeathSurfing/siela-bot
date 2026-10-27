import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { FamilyTree } from "./family.js";
import { canvasFonts } from "./canvas.js";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 68;
const COUPLE_GAP = 34;
const ROW_HEIGHT = 150;
const CHILD_GAP = 64;
const ROOT_GAP = 88;
const MARGIN = 56;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 180;
const MAX_DIMENSION = 4096;

const INK = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const LINE = "rgba(161, 161, 170, 0.82)";
const ACCENT = "#8b5cf6";
const HEART = "#ec4899";

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  family: string,
): { text: string; size: number } {
  let size = baseSize;
  while (size > minSize) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
    size -= 1;
  }
  ctx.font = `${size}px ${family}`;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return { text: `${value}…`, size };
}

interface Group {
  id: string;
  members: string[];
  parents: Set<string>;
  children: Set<string>;
  level: number;
}

interface LayoutResult {
  width: number;
  positions: Map<string, { x: number; y: number }>;
}

export async function generateFamilyTreeCard(
  tree: FamilyTree,
  names: Map<string, string>,
  rootUserId: string,
  avatarUrls: Map<string, string> = new Map(),
): Promise<Buffer> {
  const avatars = new Map<string, Image>();
  await Promise.all([...avatarUrls].map(async ([id, url]) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      avatars.set(id, await loadImage(Buffer.from(await response.arrayBuffer())));
    } catch {
      // A failed CDN image must not prevent the rest of the tree from rendering.
    }
  }));
  const { regular: regularFamily, bold: boldFamily } = canvasFonts();
  const nodeIds = tree.nodes;
  const nodeSet = new Set(nodeIds);
  const parentOf = new Map<string, string>();
  for (const id of nodeIds) parentOf.set(id, id);

  const find = (id: string): string => {
    let current = id;
    while (parentOf.get(current) !== current) current = parentOf.get(current)!;
    let node = id;
    while (parentOf.get(node) !== current) {
      const next = parentOf.get(node)!;
      parentOf.set(node, current);
      node = next;
    }
    return current;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parentOf.set(rootB, rootA);
  };

  for (const edge of tree.edges) {
    if (edge.type === "marriage" && nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
      union(edge.from, edge.to);
    }
  }

  const membersByGroup = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    const list = membersByGroup.get(root) ?? [];
    list.push(id);
    membersByGroup.set(root, list);
  }

  const groups = new Map<string, Group>();
  for (const [id, members] of membersByGroup) {
    groups.set(id, {
      id,
      members: [...members].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b)),
      parents: new Set(),
      children: new Set(),
      level: 0,
    });
  }

  const groupOf = new Map<string, string>();
  for (const [groupId, group] of groups) {
    for (const member of group.members) groupOf.set(member, groupId);
  }

  for (const edge of tree.edges) {
    if (edge.type !== "parent") continue;
    const parentGroup = groupOf.get(edge.from);
    const childGroup = groupOf.get(edge.to);
    if (!parentGroup || !childGroup || parentGroup === childGroup) continue;
    groups.get(parentGroup)?.children.add(childGroup);
    groups.get(childGroup)?.parents.add(parentGroup);
  }

  const groupLabel = (id: string): string =>
    (groups.get(id)?.members.map((member) => names.get(member) ?? member).join(" & ") ?? id).toLowerCase();

  const indegree = new Map<string, number>();
  for (const [id, group] of groups) indegree.set(id, group.parents.size);
  const queue = [...groups.keys()]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
  const processed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    const group = groups.get(id);
    if (!group) continue;
    processed.add(id);
    for (const childId of group.children) {
      const child = groups.get(childId);
      if (!child) continue;
      child.level = Math.max(child.level, group.level + 1);
      const next = (indegree.get(childId) ?? 1) - 1;
      indegree.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }

  for (const group of groups.values()) {
    if (processed.has(group.id)) continue;
    group.level = Math.max(0, ...[...group.parents].map((parentId) => (groups.get(parentId)?.level ?? 0) + 1));
  }

  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();

  const layoutGroup = (groupId: string): LayoutResult => {
    visited.add(groupId);
    const group = groups.get(groupId)!;
    const children = [...group.children]
      .filter((id) => !visited.has(id))
      .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
    const childLayouts = children.map((id) => layoutGroup(id));
    const unitWidth = group.members.length * NODE_WIDTH + (group.members.length - 1) * COUPLE_GAP;
    const childTotal =
      childLayouts.reduce((sum, child) => sum + child.width, 0) + Math.max(0, childLayouts.length - 1) * CHILD_GAP;
    const width = Math.max(unitWidth, childTotal);
    const merged = new Map<string, { x: number; y: number }>();
    let offset = (width - childTotal) / 2;
    for (const child of childLayouts) {
      for (const [id, position] of child.positions) {
        merged.set(id, { x: position.x + offset, y: position.y });
      }
      offset += child.width + CHILD_GAP;
    }
    merged.set(groupId, { x: (width - unitWidth) / 2, y: group.level * ROW_HEIGHT });
    return { width, positions: merged };
  };

  const roots = [...groups.keys()]
    .filter((id) => (groups.get(id)?.parents.size ?? 0) === 0)
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
  const layouts = roots.map((id) => layoutGroup(id));
  for (const id of groups.keys()) {
    if (!visited.has(id)) layouts.push(layoutGroup(id));
  }

  let rootOffset = 0;
  for (const layout of layouts) {
    for (const [id, position] of layout.positions) {
      positions.set(id, { x: position.x + rootOffset + MARGIN, y: position.y });
    }
    rootOffset += layout.width + ROOT_GAP;
  }

  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const group of groups.values()) {
    const position = positions.get(group.id);
    if (!position) continue;
    group.members.forEach((member, index) => {
      nodePositions.set(member, {
        x: position.x + index * (NODE_WIDTH + COUPLE_GAP),
        y: position.y,
      });
    });
  }

  let maxX = 0;
  let maxY = 0;
  for (const position of nodePositions.values()) {
    maxX = Math.max(maxX, position.x + NODE_WIDTH);
    maxY = Math.max(maxY, position.y + NODE_HEIGHT);
  }
  const logicalWidth = Math.max(MIN_WIDTH, maxX + MARGIN);
  const logicalHeight = Math.max(MIN_HEIGHT, maxY + MARGIN * 2);
  const scale = Math.min(1, MAX_DIMENSION / logicalWidth, MAX_DIMENSION / logicalHeight);
  const canvas = createCanvas(Math.ceil(logicalWidth * scale), Math.ceil(logicalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const drawY = (value: number): number => value + MARGIN;
  const groupCenter = (groupId: string): { x: number; y: number } => {
    const group = groups.get(groupId);
    const position = group ? positions.get(group.id) : undefined;
    if (!group || !position) return { x: 0, y: 0 };
    const unitWidth = group.members.length * NODE_WIDTH + (group.members.length - 1) * COUPLE_GAP;
    return { x: position.x + unitWidth / 2, y: drawY(position.y) + NODE_HEIGHT };
  };

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.25;
  for (const group of groups.values()) {
    const parent = groupCenter(group.id);
    for (const childId of group.children) {
      const child = groupCenter(childId);
      if (!parent.x || !child.x) continue;
      const startY = parent.y;
      const endY = child.y - NODE_HEIGHT;
      const midY = startY + (endY - startY) / 2;
      ctx.beginPath();
      ctx.moveTo(parent.x, startY);
      ctx.bezierCurveTo(parent.x, midY, child.x, midY, child.x, endY);
      ctx.stroke();
    }
  }

  for (const group of groups.values()) {
    if (group.members.length < 2) continue;
    const first = nodePositions.get(group.members[0]!);
    const second = nodePositions.get(group.members[1]!);
    if (!first || !second) continue;
    const y = drawY(first.y) + NODE_HEIGHT / 2;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    // Leave the partner gap empty so the heart floats between the cards.
    ctx.fillStyle = HEART;
    // Geometry is centered on the connector; font baselines vary across platforms.
    const cx = (first.x + NODE_WIDTH + second.x) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, y - 3);
    ctx.bezierCurveTo(cx - 8, y - 11, cx - 12, y + 1, cx, y + 8);
    ctx.bezierCurveTo(cx + 12, y + 1, cx + 8, y - 11, cx, y - 3);
    ctx.fill();
  }

  for (const [id, position] of nodePositions) {
    const displayName = names.get(id) ?? "Unavailable user";
    const isRoot = id === rootUserId;
    const x = position.x;
    const y = drawY(position.y);

    roundedRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = isRoot ? 2 : 1;
    ctx.strokeStyle = isRoot ? ACCENT : BORDER;
    ctx.stroke();

    ctx.fillStyle = isRoot ? ACCENT : INK;
    ctx.beginPath();
    ctx.arc(x + 28, y + NODE_HEIGHT / 2, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 11px ${boldFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(displayName), x + 28, y + NODE_HEIGHT / 2 + 1);
    const avatar = avatars.get(id);
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 28, y + NODE_HEIGHT / 2, 17, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, x + 11, y + NODE_HEIGHT / 2 - 17, 34, 34);
      ctx.restore();
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const label = fitText(ctx, displayName, NODE_WIDTH - 62, 17, 11, boldFamily);
    ctx.fillStyle = INK;
    ctx.font = `${label.size}px ${boldFamily}`;
    if (isRoot) {
      ctx.fillText(label.text, x + 54, y + 30);
      ctx.fillStyle = MUTED;
      ctx.font = `9px ${regularFamily}`;
      ctx.fillText("YOU", x + 54, y + 49);
    } else {
      ctx.fillText(label.text, x + 54, y + 40);
    }
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}

