#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/extension/mcp/server.ts
var fs = __toESM(require("fs/promises"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var readline = __toESM(require("readline"));
var crypto = __toESM(require("crypto"));

// src/shared/nodeLabels.ts
function nodeLabelPrefix(node) {
  switch (node.type) {
    case "text":
      return "N";
    case "link":
      return "L";
    case "group":
      return "G";
    case "cell":
      return "C";
    case "chat":
      return "A";
    case "portal":
      return "R";
    case "file": {
      const f = node.file.toLowerCase();
      if (f.endsWith(".ipynb"))
        return "J";
      if (f.endsWith(".md"))
        return "M";
      if (f.endsWith(".py"))
        return "P";
      if (f.endsWith(".yaml") || f.endsWith(".yml"))
        return "Y";
      if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))
        return "I";
      return "F";
    }
    default:
      return "X";
  }
}
function usedLabels(nodes) {
  const s = /* @__PURE__ */ new Set();
  for (const n of nodes)
    if (n.nodeLabel)
      s.add(n.nodeLabel);
  return s;
}
function nextLabel(prefix, used) {
  let i = 1;
  while (used.has(`${prefix}${i}`))
    i++;
  return `${prefix}${i}`;
}
function ensureLabels(nodes) {
  const needsLabel = nodes.some((n) => !n.nodeLabel);
  if (!needsLabel)
    return nodes;
  const used = usedLabels(nodes);
  return nodes.map((n) => {
    if (n.nodeLabel)
      return n;
    const label = nextLabel(nodeLabelPrefix(n), used);
    used.add(label);
    return { ...n, nodeLabel: label };
  });
}
function assignLabel(node, existingNodes) {
  if (node.nodeLabel)
    return node;
  const used = usedLabels(existingNodes);
  const label = nextLabel(nodeLabelPrefix(node), used);
  return { ...node, nodeLabel: label };
}

// src/extension/mcp/server.ts
function resolvePath(raw) {
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  return path.resolve(expanded);
}
function expandHome(p) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}
var vaultCache = /* @__PURE__ */ new Map();
function stripComments(raw) {
  return raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
async function readSettingsFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(stripComments(raw));
  } catch {
    return null;
  }
}
async function loadVaults(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const settingsPath = path.join(dir, ".vscode", "settings.json");
    const base = await readSettingsFile(settingsPath);
    if (base !== null) {
      const cacheKey = settingsPath;
      const cached = vaultCache.get(cacheKey);
      if (cached)
        return cached;
      const localPath = path.join(dir, ".vscode", "settings.local.json");
      const local = await readSettingsFile(localPath);
      const vaults = local?.["skena.vaults"] ?? base["skena.vaults"] ?? [];
      vaultCache.set(cacheKey, vaults);
      return vaults;
    }
    const parent = path.dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return [];
}
async function resolveVaultUri(uri, canvasPath) {
  if (!uri.startsWith("vault://"))
    return null;
  const rest = uri.slice(8);
  const slash = rest.indexOf("/");
  const name = slash === -1 ? rest : rest.slice(0, slash);
  const rel = slash === -1 ? "" : rest.slice(slash + 1);
  const vaults = await loadVaults(path.dirname(canvasPath));
  const vault = vaults.find((v) => v.name === name);
  if (!vault)
    return null;
  return path.join(expandHome(vault.path), rel);
}
async function readCanvas(fsPath) {
  const raw = await fs.readFile(fsPath, "utf-8");
  const parsed = JSON.parse(raw);
  const data = {
    nodes: parsed.nodes ?? [],
    edges: parsed.edges ?? [],
    viewport: parsed.viewport
  };
  data.nodes = ensureLabels(data.nodes);
  return data;
}
async function writeCanvas(fsPath, data) {
  await fs.writeFile(fsPath, JSON.stringify(data, null, 2), "utf-8");
}
function findNode(data, ref) {
  return data.nodes.find((n) => n.nodeLabel === ref) ?? data.nodes.find((n) => n.id === ref);
}
function nodeSnippet(node) {
  switch (node.type) {
    case "text":
      return truncate(node.text.replace(/\n/g, " "), 80);
    case "file":
      return node.file;
    case "link":
      return node.url;
    case "group":
      return node.label ? `"${node.label}"` : "(unnamed group)";
    case "cell":
      return `${node.format} (${node.content.length} chars)`;
    case "chat":
      return `${node.agent}: ${node.title}`;
    case "portal":
      return `\u2192 ${node.canvas}`;
    default:
      return "(unknown)";
  }
}
function typeLabel(node) {
  if (node.type === "file") {
    const f = node.file.toLowerCase();
    if (f.endsWith(".ipynb"))
      return "notebook";
    if (f.endsWith(".md"))
      return "markdown";
    if (f.endsWith(".py"))
      return "python";
    if (f.endsWith(".yaml") || f.endsWith(".yml"))
      return "yaml";
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))
      return "image";
    return "file";
  }
  return node.type;
}
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}
function nowLabel() {
  const d = /* @__PURE__ */ new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}
function uid() {
  return `ai-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}
function autoPlace(nodes, w, h) {
  if (nodes.length === 0)
    return { x: 100, y: 100 };
  const GAP = 60;
  const rightmost = Math.max(...nodes.map((n) => n.x + n.width));
  const midY = (Math.min(...nodes.map((n) => n.y)) + Math.max(...nodes.map((n) => n.y + n.height))) / 2;
  return { x: Math.round(rightmost + GAP), y: Math.round(midY - h / 2) };
}
function defaultDims(type) {
  const map = {
    text: { w: 400, h: 300 },
    cell: { w: 480, h: 320 },
    file: { w: 400, h: 400 },
    link: { w: 240, h: 80 },
    portal: { w: 200, h: 120 }
  };
  return map[type] ?? { w: 400, h: 300 };
}
var BINARY_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf", ".zip", ".7z"]);
var MAX_READ_BYTES = 64 * 1024;
async function readFileNodeContent(uri, canvasPath) {
  let fsPath;
  if (uri.startsWith("vault://")) {
    const resolved = await resolveVaultUri(uri, canvasPath);
    if (!resolved) {
      return `vault URI: ${uri}
(vault not configured \u2014 add it to skena.vaults in .vscode/settings.json)`;
    }
    fsPath = resolved;
  } else if (path.isAbsolute(uri)) {
    fsPath = uri;
  } else {
    fsPath = path.resolve(path.dirname(canvasPath), uri);
  }
  const header = `File: ${fsPath}`;
  const ext = path.extname(fsPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return `${header}
(binary file \u2014 content not shown)`;
  }
  try {
    const stat2 = await fs.stat(fsPath);
    if (stat2.size > MAX_READ_BYTES) {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const fd = await fs.open(fsPath, "r");
      try {
        const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
        let text2 = buf.slice(0, bytesRead).toString("utf-8");
        const lastNl = text2.lastIndexOf("\n");
        if (lastNl > 0)
          text2 = text2.slice(0, lastNl + 1);
        return `${header}
(truncated \u2014 showing first ${MAX_READ_BYTES / 1024} KB of ${Math.round(stat2.size / 1024)} KB)

${text2}`;
      } finally {
        await fd.close();
      }
    }
    const text = await fs.readFile(fsPath, "utf-8");
    return `${header}

${text}`;
  } catch (e) {
    return `${header}
(error reading file: ${e})`;
  }
}
async function canvasList(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const lines = [
    `Canvas: ${p}`,
    `${d.nodes.length} node(s), ${d.edges.length} edge(s)`,
    "",
    "Nodes:"
  ];
  for (const n of d.nodes) {
    const ext = n;
    const aiMark = ext.createdBy === "ai" ? " \u{1F916}" : "";
    const tags = ext.tags?.length ? `  [${ext.tags.join(", ")}]` : "";
    lines.push(`  ${(n.nodeLabel ?? "?").padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}${aiMark}${tags}`);
  }
  if (d.edges.length > 0) {
    lines.push("", "Edges:");
    const labelMap = new Map(d.nodes.map((n) => [n.id, n.nodeLabel ?? n.id.slice(0, 8)]));
    for (const e of d.edges) {
      const from = labelMap.get(e.fromNode) ?? e.fromNode;
      const to = labelMap.get(e.toNode) ?? e.toNode;
      const lbl = e.label ? `  "${e.label}"` : "";
      lines.push(`  ${from} \u2192 ${to}${lbl}`);
    }
  }
  return lines.join("\n");
}
async function canvasRead(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  const labelMap = new Map(d.nodes.map((nd) => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const outgoing = d.edges.filter((e) => e.fromNode === n.id).map((e) => `\u2192 ${labelMap.get(e.toNode) ?? e.toNode}${e.label ? ` "${e.label}"` : ""}`);
  const incoming = d.edges.filter((e) => e.toNode === n.id).map((e) => `\u2190 ${labelMap.get(e.fromNode) ?? e.fromNode}${e.label ? ` "${e.label}"` : ""}`);
  const meta = [
    `Node ${n.nodeLabel ?? "?"} (id: ${n.id})`,
    `Type: ${typeLabel(n)}`
  ];
  const ext = n;
  if (ext.createdBy)
    meta.push(`Created by: ${ext.createdBy}`);
  if (ext.tags?.length)
    meta.push(`Tags: [${ext.tags.join(", ")}]`);
  meta.push(`Position: (${n.x}, ${n.y})  Size: ${n.width}\xD7${n.height}`);
  if (incoming.length || outgoing.length) {
    meta.push(`Connections: ${[...incoming, ...outgoing].join("  ")}`);
  }
  let content = "";
  switch (n.type) {
    case "text":
      content = n.text;
      break;
    case "file":
      content = await readFileNodeContent(n.file, p);
      break;
    case "link":
      content = `URL: ${n.url}`;
      break;
    case "group":
      content = `Label: ${n.label ?? "(none)"}`;
      break;
    case "cell":
      content = `Format: ${n.format}

${n.content}`;
      break;
    case "chat":
      content = `Agent: ${n.agent}  Model: ${n.model ?? "default"}
Title: ${n.title}`;
      break;
    case "portal":
      content = `Sub-canvas: ${n.canvas}`;
      break;
  }
  return [
    ...meta,
    "",
    "\u2500".repeat(60),
    content,
    "\u2500".repeat(60)
  ].join("\n");
}
async function canvasSearch(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const query = args.query.toLowerCase();
  const type = args.type;
  const results = [];
  for (const n of d.nodes) {
    if (type && n.type !== type)
      continue;
    const haystack = [
      n.nodeLabel ?? "",
      n.tags?.join(" ") ?? "",
      n.type === "text" ? n.text : "",
      n.type === "file" ? n.file : "",
      n.type === "link" ? n.url : "",
      n.type === "group" ? n.label ?? "" : "",
      n.type === "cell" ? n.content : "",
      n.type === "chat" ? n.title : "",
      n.type === "portal" ? n.canvas : "",
      d.edges.filter((e) => e.fromNode === n.id || e.toNode === n.id).map((e) => e.label ?? "").join(" ")
    ].join(" ").toLowerCase();
    if (haystack.includes(query))
      results.push(n);
  }
  if (results.length === 0)
    return `No nodes match "${args.query}"`;
  const lines = [`Found ${results.length} node(s) matching "${args.query}":`, ""];
  for (const n of results) {
    lines.push(`  ${(n.nodeLabel ?? "?").padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}`);
  }
  return lines.join("\n");
}
async function canvasEdges(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  const labelMap = new Map(d.nodes.map((nd) => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const lines = [`Edges for ${n.nodeLabel ?? n.id}:`, ""];
  const out = d.edges.filter((e) => e.fromNode === n.id);
  const inn = d.edges.filter((e) => e.toNode === n.id);
  if (!out.length && !inn.length)
    return `No edges for ${n.nodeLabel ?? n.id}`;
  for (const e of inn)
    lines.push(`  \u2190  ${(labelMap.get(e.fromNode) ?? e.fromNode).padEnd(6)}  ${e.label ? `"${e.label}"` : "(no label)"}  [${e.fromSide ?? "?"} \u2192 ${e.toSide ?? "?"}]`);
  for (const e of out)
    lines.push(`  \u2192  ${(labelMap.get(e.toNode) ?? e.toNode).padEnd(6)}  ${e.label ? `"${e.label}"` : "(no label)"}  [${e.fromSide ?? "?"} \u2192 ${e.toSide ?? "?"}]`);
  return lines.join("\n");
}
async function canvasFollow(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  if (n.type === "file") {
    if (n.file.startsWith("vault://")) {
      const resolved = await resolveVaultUri(n.file, p);
      if (!resolved)
        return `Vault URI: ${n.file}
(vault not configured in .vscode/settings.json \u2014 add it to skena.vaults)`;
      return `File path: ${resolved}
Vault URI: ${n.file}`;
    }
    const abs = path.isAbsolute(n.file) ? n.file : path.resolve(path.dirname(p), n.file);
    return `File path: ${abs}`;
  }
  if (n.type === "portal") {
    const abs = path.isAbsolute(n.canvas) ? n.canvas : path.resolve(path.dirname(p), n.canvas);
    return `Sub-canvas path: ${abs}`;
  }
  if (n.type === "link") {
    return `URL: ${n.url}`;
  }
  return `Node ${n.nodeLabel ?? n.id} (${n.type}) is not a file, portal, or link node`;
}
async function canvasAddNode(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const type = args.type ?? "text";
  const dims = defaultDims(type);
  const w = args.width ?? dims.w;
  const h = args.height ?? dims.h;
  const pos = args.x !== void 0 && args.y !== void 0 ? { x: args.x, y: args.y } : autoPlace(d.nodes, w, h);
  const base = {
    id: uid(),
    type,
    x: pos.x,
    y: pos.y,
    width: w,
    height: h,
    createdBy: "ai",
    ...args.color ? { color: args.color } : {},
    ...args.tags ? { tags: args.tags } : {}
  };
  let newNode;
  switch (type) {
    case "text":
      newNode = { ...base, type: "text", text: args.content ?? "" };
      break;
    case "cell":
      newNode = { ...base, type: "cell", format: args.format ?? "markdown", content: args.content ?? "" };
      break;
    case "file":
      newNode = { ...base, type: "file", file: args.file ?? "" };
      break;
    case "link":
      newNode = { ...base, type: "link", url: args.url ?? "" };
      break;
    case "portal":
      newNode = { ...base, type: "portal", canvas: args.canvas ?? "" };
      break;
    default:
      newNode = { ...base, type: "text", text: args.content ?? "" };
  }
  const labeled = assignLabel(newNode, d.nodes);
  d.nodes.push(labeled);
  await writeCanvas(p, d);
  return `Created node ${labeled.nodeLabel} (id: ${labeled.id})
Type: ${type}
Position: (${labeled.x}, ${labeled.y})  Size: ${labeled.width}\xD7${labeled.height}
Canvas: ${p}`;
}
async function canvasUpdateNode(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  const idx = d.nodes.indexOf(n);
  const updated = { ...n };
  if (args.content !== void 0) {
    if (n.type === "text")
      updated.text = args.content;
    if (n.type === "cell")
      updated.content = args.content;
  }
  if (args.tags !== void 0)
    updated.tags = args.tags;
  if (args.color !== void 0)
    updated.color = args.color;
  if (args.label !== void 0)
    updated.nodeLabel = args.label;
  d.nodes[idx] = updated;
  await writeCanvas(p, d);
  return `Updated node ${updated.nodeLabel ?? updated.id}`;
}
async function canvasRemoveNode(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const refs = Array.isArray(args.ref) ? args.ref : [args.ref];
  const toRemove = /* @__PURE__ */ new Set();
  const labels = [];
  for (const ref of refs) {
    const n = findNode(d, ref);
    if (n) {
      toRemove.add(n.id);
      labels.push(n.nodeLabel ?? n.id);
    }
  }
  if (toRemove.size === 0)
    return `No nodes found for: ${refs.join(", ")}`;
  d.nodes = d.nodes.filter((n) => !toRemove.has(n.id));
  d.edges = d.edges.filter((e) => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
  await writeCanvas(p, d);
  return `Removed ${toRemove.size} node(s): ${labels.join(", ")}`;
}
async function canvasAddEdge(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const fn = findNode(d, args.from);
  const tn = findNode(d, args.to);
  if (!fn)
    return `Source node not found: ${args.from}`;
  if (!tn)
    return `Target node not found: ${args.to}`;
  const edge = {
    id: `edge-${uid()}`,
    fromNode: fn.id,
    fromSide: args.fromSide ?? "right",
    toNode: tn.id,
    toSide: args.toSide ?? "left",
    toEnd: "arrow",
    ...args.label ? { label: args.label } : {},
    ...args.color ? { color: args.color } : {}
  };
  d.edges.push(edge);
  await writeCanvas(p, d);
  return `Connected ${fn.nodeLabel ?? fn.id} \u2192 ${tn.nodeLabel ?? tn.id}  (edge id: ${edge.id})`;
}
async function canvasPinOutput(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const format = args.format ?? "html";
  const content = args.content ?? "";
  const W = 480, H = 320;
  let x, y;
  let sourceNode;
  if (args.sourceRef) {
    sourceNode = findNode(d, args.sourceRef);
    if (sourceNode) {
      x = Math.round(sourceNode.x + sourceNode.width + 60);
      y = Math.round(sourceNode.y + (sourceNode.height - H) / 2);
    } else {
      const pos = autoPlace(d.nodes, W, H);
      x = pos.x;
      y = pos.y;
    }
  } else {
    const pos = autoPlace(d.nodes, W, H);
    x = pos.x;
    y = pos.y;
  }
  const cell = {
    id: uid(),
    type: "cell",
    x,
    y,
    width: W,
    height: H,
    format,
    content,
    createdBy: "ai",
    ...args.tags ? { tags: args.tags } : {}
  };
  const labeled = assignLabel(cell, d.nodes);
  d.nodes.push(labeled);
  let edgeId = "";
  if (sourceNode) {
    const edge = {
      id: `edge-pin-${uid()}`,
      fromNode: sourceNode.id,
      fromSide: "right",
      toNode: labeled.id,
      toSide: "left",
      toEnd: "arrow",
      label: args.edgeLabel ?? nowLabel()
    };
    d.edges.push(edge);
    edgeId = edge.id;
  }
  await writeCanvas(p, d);
  const lines = [`Pinned output as cell node ${labeled.nodeLabel} (id: ${labeled.id})`];
  if (sourceNode)
    lines.push(`Connected from ${sourceNode.nodeLabel ?? sourceNode.id} with edge "${d.edges.find((e) => e.id === edgeId)?.label}"`);
  lines.push(`Canvas: ${p}`);
  return lines.join("\n");
}
var TOOLS = [
  {
    name: "canvas_list",
    description: "List all nodes and edges on a canvas. Returns node labels (N1, J3, etc.), types, and content previews. Use these labels to reference nodes in other tools.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Absolute, workspace-relative, or ~/... path to the .canvas file" }
      },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_read",
    description: "Read the full content and metadata of a canvas node by its label (e.g. N1, J3) or node ID.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label (N1, J3, etc.) or full node ID" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_search",
    description: "Search for canvas nodes whose labels, content, filenames, or tags match a query string.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        query: { type: "string", description: "Search string (case-insensitive)" },
        type: { type: "string", description: "Optional: filter by node type (text, file, cell, link, portal, etc.)" }
      },
      required: ["canvasPath", "query"]
    }
  },
  {
    name: "canvas_edges",
    description: "List all edges (connections) going to or from a specific node.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label or ID" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_follow",
    description: "Resolve a file or portal node to its filesystem path so you can read its contents. File nodes return their absolute path; portal nodes return the sub-canvas path; link nodes return their URL.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label or ID of a file, portal, or link node" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_node",
    description: "Add a new node to the canvas. The node is automatically marked as AI-created (\u{1F916} badge) and assigned a label. Position defaults to the right of all existing nodes.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        type: { type: "string", description: "Node type: text (default), cell, file, link, portal" },
        content: { type: "string", description: "Text content for text/cell nodes" },
        format: { type: "string", description: "Cell format: markdown (default), html, image" },
        file: { type: "string", description: "File path for file nodes (vault:// URI or absolute path)" },
        url: { type: "string", description: "URL for link nodes" },
        canvas: { type: "string", description: "Relative canvas path for portal nodes" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for search/organisation" },
        color: { type: "string", description: "Node accent color: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple" },
        x: { type: "number", description: "X position (auto-placed if omitted)" },
        y: { type: "number", description: "Y position (auto-placed if omitted)" },
        width: { type: "number", description: "Width in canvas units (default: type-dependent)" },
        height: { type: "number", description: "Height in canvas units (default: type-dependent)" }
      },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_update_node",
    description: "Update the content, tags, or color of an existing canvas node.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label or ID to update" },
        content: { type: "string", description: "New text/cell content" },
        tags: { type: "array", items: { type: "string" }, description: "Replace tags list" },
        color: { type: "string", description: "New accent color (1-6)" },
        label: { type: "string", description: "Override the node label (e.g. rename N5 to N1)" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_remove_node",
    description: "Delete one or more nodes from the canvas (also removes their connected edges).",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Node label, node ID, or array of labels/IDs to delete" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_edge",
    description: "Connect two canvas nodes with a directed edge.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        from: { type: "string", description: "Source node label or ID" },
        to: { type: "string", description: "Target node label or ID" },
        label: { type: "string", description: "Optional edge label text" },
        fromSide: { type: "string", description: "Source handle: top, right (default), bottom, left" },
        toSide: { type: "string", description: "Target handle: top, left (default), bottom, right" },
        color: { type: "string", description: "Edge color (1-6)" }
      },
      required: ["canvasPath", "from", "to"]
    }
  },
  {
    name: "canvas_pin_output",
    description: "Pin a content snippet (analysis result, notebook output, HTML table, image) as a CellNode on the canvas. Automatically links it to a source node if specified.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        content: { type: "string", description: "Content to pin (markdown text, HTML string, or base64 image data URI)" },
        format: { type: "string", description: "Content format: html (default), markdown, image" },
        sourceRef: { type: "string", description: "Optional: label/ID of the node this output came from (notebook, analysis). Creates an edge." },
        edgeLabel: { type: "string", description: "Label for the connecting edge (defaults to current timestamp yy-mm-dd hh:mm)" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" }
      },
      required: ["canvasPath", "content"]
    }
  }
];
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}
function err(id, code, message) {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
async function dispatch(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "skena", version: "1.0.0" }
    });
    return;
  }
  if (method === "notifications/initialized")
    return;
  if (method === "tools/list") {
    ok(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name ?? "";
    const args = params?.arguments ?? {};
    try {
      let text;
      switch (name) {
        case "canvas_list":
          text = await canvasList(args);
          break;
        case "canvas_read":
          text = await canvasRead(args);
          break;
        case "canvas_search":
          text = await canvasSearch(args);
          break;
        case "canvas_edges":
          text = await canvasEdges(args);
          break;
        case "canvas_follow":
          text = await canvasFollow(args);
          break;
        case "canvas_add_node":
          text = await canvasAddNode(args);
          break;
        case "canvas_update_node":
          text = await canvasUpdateNode(args);
          break;
        case "canvas_remove_node":
          text = await canvasRemoveNode(args);
          break;
        case "canvas_add_edge":
          text = await canvasAddEdge(args);
          break;
        case "canvas_pin_output":
          text = await canvasPinOutput(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      ok(id, { content: [{ type: "text", text }] });
    } catch (e) {
      const msg2 = e instanceof Error ? e.message : String(e);
      ok(id, { content: [{ type: "text", text: `Error: ${msg2}` }], isError: true });
    }
    return;
  }
  err(id, -32601, `Method not found: ${method}`);
}
var rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed)
    return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  dispatch(msg).catch((e) => {
    process.stderr.write(`Skena MCP: unhandled error: ${e}
`);
  });
});
rl.on("close", () => process.exit(0));
process.stdin.resume();
//# sourceMappingURL=mcp-server.js.map
