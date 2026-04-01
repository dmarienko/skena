#!/usr/bin/env node
/**
 * Skena canvas CLI — talks to the Skena MCP server via stdio transport.
 *
 * Spawns dist/mcp-server.js (or .vscode/skena-mcp.js if dist/ not present),
 * performs the MCP initialize handshake, calls one tool, prints the result.
 *
 * Usage:
 *   node scripts/skena-canvas.js list   <canvas>
 *   node scripts/skena-canvas.js read   <canvas> <ref>
 *   node scripts/skena-canvas.js search <canvas> <query> [--type text|file|…]
 *   node scripts/skena-canvas.js add    <canvas> [options]
 *   node scripts/skena-canvas.js remove <canvas> <ref>
 *   node scripts/skena-canvas.js edge   <canvas> <from-ref> <to-ref> [--label "text"]
 *
 * Options for `add`:
 *   --type    text|cell|file|link|portal   (default: text)
 *   --content "markdown text here"
 *   --format  markdown|html|image         (cell nodes; default: markdown)
 *   --file    path/to/file.py             (file nodes)
 *   --url     https://...                 (link nodes)
 *   --canvas  sub.canvas                  (portal nodes)
 *   --tags    tag1,tag2,tag3
 *   --color   1-6                         (1=red 2=orange 3=yellow 4=green 5=cyan 6=purple)
 *   --connect N1                          (add edge from that node to the new one)
 *   --x, --y, --width, --height           (manual position/size)
 *
 * Examples:
 *   node scripts/skena-canvas.js list ~/projects/board.canvas
 *   node scripts/skena-canvas.js add  ~/projects/board.canvas --content "# Hello" --tags research,draft
 *   node scripts/skena-canvas.js add  ~/projects/board.canvas --type file --file src/foo.py --connect N1
 *   node scripts/skena-canvas.js remove ~/projects/board.canvas N7
 */

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

// ─── resolve server path ──────────────────────────────────────────────────────

const root       = path.resolve(__dirname, '..');
const distServer = path.join(root, 'dist', 'mcp-server.js');
const vsServer   = path.join(root, '.vscode', 'skena-mcp.js');

function findServer() {
  if (fs.existsSync(distServer)) return distServer;
  if (fs.existsSync(vsServer))   return vsServer;
  throw new Error(
    'MCP server not found. Run `node esbuild.config.mjs` first to build dist/mcp-server.js'
  );
}

// ─── arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args   = {};
  const pos    = [];
  let   i      = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      args[key] = (val !== undefined && !val.startsWith('--')) ? (i++, val) : true;
    } else {
      pos.push(a);
    }
    i++;
  }
  return { args, pos };
}

// ─── MCP client ───────────────────────────────────────────────────────────────

/**
 * Spawn the MCP server, perform initialize handshake, call one tool, return result text.
 */
async function callTool(toolName, toolArgs) {
  const serverPath = findServer();
  const proc       = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

  return new Promise((resolve, reject) => {
    let   buf     = '';
    let   nextId  = 1;
    const pending = new Map();   // - id → { resolve, reject }

    // - send a JSON-RPC message (newline-delimited)
    function send(msg) {
      proc.stdin.write(JSON.stringify(msg) + '\n');
    }

    // - send a request and return a promise for its result
    function request(method, params) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        send({ jsonrpc: '2.0', id, method, params });
      });
    }

    // - parse incoming lines
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // - keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve: res, reject: rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else           res(msg.result);
        }
      }
    });

    proc.stdout.on('end', () => {
      for (const { reject: rej } of pending.values()) rej(new Error('server closed'));
    });

    proc.on('error', reject);

    // - MCP handshake then tool call
    (async () => {
      try {
        // - step 1: initialize
        await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities:    {},
          clientInfo:      { name: 'skena-canvas-cli', version: '1.0' },
        });

        // - step 2: initialized notification (no id = fire-and-forget)
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

        // - step 3: call the tool
        const result = await request('tools/call', {
          name:      toolName,
          arguments: toolArgs,
        });

        const text = result?.content?.[0]?.text ?? JSON.stringify(result, null, 2);
        resolve(text);
      } catch (err) {
        reject(err);
      } finally {
        proc.stdin.end();
      }
    })();
  });
}

// ─── commands ─────────────────────────────────────────────────────────────────

async function cmdList(canvasPath) {
  return callTool('canvas_list', { canvasPath });
}

async function cmdRead(canvasPath, ref) {
  if (!ref) throw new Error('Usage: read <canvas> <ref>   (ref = N1, J3, node-id, …)');
  return callTool('canvas_read', { canvasPath, ref });
}

async function cmdSearch(canvasPath, query, flags) {
  if (!query) throw new Error('Usage: search <canvas> <query> [--type text|file|…]');
  const toolArgs = { canvasPath, query };
  if (flags.type) toolArgs.type = flags.type;
  return callTool('canvas_search', toolArgs);
}

async function cmdAdd(canvasPath, flags) {
  const toolArgs = { canvasPath };

  // - node type
  if (flags.type)    toolArgs.type    = flags.type;
  if (flags.content) toolArgs.content = flags.content;
  if (flags.format)  toolArgs.format  = flags.format;
  if (flags.file)    toolArgs.file    = flags.file;
  if (flags.url)     toolArgs.url     = flags.url;
  if (flags.canvas)  toolArgs.canvas  = flags.canvas;
  if (flags.color)   toolArgs.color   = flags.color;
  if (flags.tags)    toolArgs.tags    = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
  if (flags.x)       toolArgs.x       = Number(flags.x);
  if (flags.y)       toolArgs.y       = Number(flags.y);
  if (flags.width)   toolArgs.width   = Number(flags.width);
  if (flags.height)  toolArgs.height  = Number(flags.height);

  // - add the node
  const addResult = await callTool('canvas_add_node', toolArgs);

  // - optionally connect to an existing node
  if (flags.connect) {
    // - extract new node's label from the result text (e.g. "Added node N5 …")
    const match = addResult.match(/\b([A-Z]\d+)\b/);
    if (match) {
      const edgeArgs = { canvasPath, from: flags.connect, to: match[1] };
      const edgeResult = await callTool('canvas_add_edge', edgeArgs);
      return `${addResult}\n${edgeResult}`;
    }
  }

  return addResult;
}

async function cmdRemove(canvasPath, ref) {
  if (!ref) throw new Error('Usage: remove <canvas> <ref>');
  return callTool('canvas_remove_node', { canvasPath, ref });
}

async function cmdEdge(canvasPath, fromRef, toRef, flags) {
  if (!fromRef || !toRef) throw new Error('Usage: edge <canvas> <from-ref> <to-ref> [--label "text"]');
  const toolArgs = { canvasPath, from: fromRef, to: toRef };
  if (flags.label) toolArgs.label = flags.label;
  return callTool('canvas_add_edge', toolArgs);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rawArgs       = process.argv.slice(2);
  const { args, pos } = parseArgs(rawArgs);
  const [cmd, ...rest] = pos;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log([
      'Usage: node scripts/skena-canvas.js <command> <canvas> [options]',
      '',
      'Commands:',
      '  list   <canvas>                    list all nodes + edges',
      '  read   <canvas> <ref>              full content of a node (N1, J3, …)',
      '  search <canvas> <query>            search nodes by text/label/tags',
      '  add    <canvas> [--type …] …       add a new node (AI-tagged)',
      '  remove <canvas> <ref>              delete a node and its edges',
      '  edge   <canvas> <from> <to>        connect two nodes',
      '',
      'Add options:',
      '  --type    text|cell|file|link|portal  (default: text)',
      '  --content "markdown text"',
      '  --format  markdown|html|image         (cell nodes)',
      '  --file    path/to/file.py             (file nodes)',
      '  --url     https://...                 (link nodes)',
      '  --tags    tag1,tag2',
      '  --color   1-6  (1=red 2=orange 3=yellow 4=green 5=cyan 6=purple)',
      '  --connect N1   (also draw an edge from N1 to the new node)',
      '  --x --y --width --height',
    ].join('\n'));
    process.exit(0);
  }

  const canvasPath = rest[0];
  if (!canvasPath) {
    console.error('Error: canvas path required');
    process.exit(1);
  }

  try {
    let output;
    switch (cmd) {
      case 'list':   output = await cmdList(canvasPath); break;
      case 'read':   output = await cmdRead(canvasPath, rest[1]); break;
      case 'search': output = await cmdSearch(canvasPath, rest[1], args); break;
      case 'add':    output = await cmdAdd(canvasPath, args); break;
      case 'remove': output = await cmdRemove(canvasPath, rest[1]); break;
      case 'edge':   output = await cmdEdge(canvasPath, rest[1], rest[2], args); break;
      default:
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
