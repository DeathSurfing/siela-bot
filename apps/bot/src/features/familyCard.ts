import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { FamilyTree } from "./family.js";
import { canvasFont } from "./canvas.js";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const COUPLE_GAP = 28;
const ROW_HEIGHT = 120;
const CHILD_GAP = 52;
const ROOT_GAP = 72;
const MARGIN = 44;
const HEADER_HEIGHT = 92;
const FOOTER_HEIGHT = 36;
const MAX_DIMENSION = 2600;

const PALETTE = ["#8b5cf6", "#06b6d4", "#f472b6", "#22c55e", "#f59e0b", "#38bdf8"];

function truncate(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
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
): Promise<Buffer> {
  const fontFamily = canvasFont();
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
  const queue = [...groups.keys()].filter((id) => (indegree.get(id) ?? 0) === 0).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
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
    const unitWidth = group.members.length > 1 ? NODE_WIDTH * 2 + COUPLE_GAP : NODE_WIDTH;
    const childTotal = childLayouts.reduce((sum, child) => sum + child.width, 0) + Math.max(0, childLayouts.length - 1) * CHILD_GAP;
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
      positions.set(id, { x: position.x + rootOffset, y: position.y });
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
  const logicalWidth = Math.max(760, maxX + MARGIN * 2);
  const logicalHeight = Math.max(300, maxY + MARGIN * 2 + HEADER_HEIGHT + FOOTER_HEIGHT);
  const scale = Math.min(1, MAX_DIMENSION / logicalWidth, MAX_DIMENSION / logicalHeight);
  const canvas = createCanvas(Math.ceil(logicalWidth * scale), Math.ceil(logicalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const background = ctx.createLinearGradient(0, 0, logicalWidth, logicalHeight);
  background.addColorStop(0, "#0f172a");
  background.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#c4b5fd";
  ctx.beginPath();
  ctx.arc(logicalWidth - 80, 40, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#f8fafc";
  ctx.font = `bold 32px ${fontFamily}`;
  ctx.fillText("Family tree", MARGIN, 52);
  ctx.fillStyle = "#a5b4fc";
  ctx.font = `16px ${fontFamily}`;
  ctx.fillText(`${tree.nodes.length} members${tree.truncated ? " · truncated" : ""}`, MARGIN, 78);

  const groupCenter = (groupId: string): { x: number; y: number } => {
    const group = groups.get(groupId);
    const position = group ? positions.get(group.id) : undefined;
    if (!group || !position) return { x: 0, y: 0 };
    const unitWidth = group.members.length > 1 ? NODE_WIDTH * 2 + COUPLE_GAP : NODE_WIDTH;
    return { x: position.x + unitWidth / 2, y: position.y + HEADER_HEIGHT + MARGIN };
  };

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(196, 181, 253, 0.32)";
  for (const group of groups.values()) {
    const parent = groupCenter(group.id);
    for (const childId of group.children) {
      const child = groupCenter(childId);
      if (!parent.x || !child.x) continue;
      const startY = parent.y + NODE_HEIGHT;
      const endY = child.y;
      const midY = startY + (endY - startY) / 2;
      ctx.beginPath();
      ctx.moveTo(parent.x, startY);
      ctx.lineTo(parent.x, midY);
      ctx.lineTo(child.x, midY);
      ctx.lineTo(child.x, endY);
      ctx.stroke();
    }
  }

  for (const [id, position] of nodePositions) {
    const displayName = names.get(id) ?? id;
    const accent = colorFor(id);
    const isRoot = id === rootUserId;
    const x = position.x;
    const y = position.y + HEADER_HEIGHT + MARGIN;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    roundedRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 14);
    ctx.fillStyle = "#111827";
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 14);
    ctx.lineWidth = isRoot ? 3 : 1.5;
    ctx.strokeStyle = isRoot ? "#c4b5fd" : "rgba(139, 92, 246, 0.65)";
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + 30, y + NODE_HEIGHT / 2, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 13px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(displayName), x + 30, y + NODE_HEIGHT / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#f8fafc";
    ctx.font = `bold 17px ${fontFamily}`;
    ctx.fillText(truncate(displayName, 18), x + 58, y + 30);
    ctx.fillStyle = "#94a3b8";
    ctx.font = `12px ${fontFamily}`;
    ctx.fillText(isRoot ? "you" : "member", x + 58, y + 48);
  }

  for (const group of groups.values()) {
    if (group.members.length < 2) continue;
    const first = nodePositions.get(group.members[0]!);
    const second = nodePositions.get(group.members[1]!);
    if (!first || !second) continue;
    const y = first.y + HEADER_HEIGHT + MARGIN + NODE_HEIGHT / 2;
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(first.x + NODE_WIDTH, y);
    ctx.lineTo(second.x, y);
    ctx.stroke();
    ctx.fillStyle = "#f472b6";
    ctx.font = `bold 20px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♥", (first.x + NODE_WIDTH + second.x) / 2, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  if (tree.truncated) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `14px ${fontFamily}`;
    ctx.fillText("Family continues…", MARGIN, logicalHeight - 26);
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}
