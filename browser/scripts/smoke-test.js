#!/usr/bin/env node
// --experimental-websocket
/**
 * Launches the freshly-packaged app from `out/<name>-<platform>-<arch>/`
 * with remote debugging enabled and confirms both renderer windows
 * (chrome + chat) actually mounted real content - not just that the
 * process started without crashing.
 *
 * This exists because browser-v1.0.0/1.0.1 shipped a build that packaged
 * and launched successfully but silently loaded two completely empty
 * documents (a Vite outDir misconfiguration meant the real renderer
 * bundles never made it into app.asar - see vite.renderer.*.config.ts).
 * Nothing short of actually loading the packaged app and inspecting its
 * DOM would have caught that before a user did.
 *
 * Needs Node's global WebSocket, which is behind a flag on Node 20 (the
 * version this project's CI pins) - run as:
 *   node --experimental-websocket scripts/smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const CDP_PORT = 9333;
const EXPECTED_WINDOW_TITLES = ['Paperkite', 'Paperkite Chat'];
const MIN_BODY_LENGTH = 200;
const LAUNCH_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

function findPackagedExecutable() {
  const { productName } = require(path.join(ROOT, 'package.json'));
  const candidates = fs
    .readdirSync(OUT_DIR)
    .filter((name) => name.startsWith(`${productName}-`) && name !== 'make');
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one packaged output dir under out/, found: [${candidates.join(', ')}]`,
    );
  }
  const packageDir = path.join(OUT_DIR, candidates[0]);
  if (process.platform === 'darwin') {
    return path.join(packageDir, `${productName}.app`, 'Contents', 'MacOS', productName);
  }
  if (process.platform === 'win32') {
    return path.join(packageDir, `${productName}.exe`);
  }
  return path.join(packageDir, productName);
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function evaluateInPage(webSocketDebuggerUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP Runtime.evaluate timed out'));
    }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('CDP WebSocket error'));
    });
  });
}

async function waitForWindow(title, deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const match = targets.find((t) => t.type === 'page' && t.title === title);
      if (match) return match;
    } catch {
      // CDP endpoint not up yet - keep polling.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`timed out waiting for a window titled "${title}" on CDP port ${CDP_PORT}`);
}

async function main() {
  const exe = findPackagedExecutable();
  if (!fs.existsSync(exe)) throw new Error(`packaged executable not found: ${exe}`);
  console.log(`launching ${exe}`);

  const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu'], {
    stdio: 'inherit',
  });
  let exitInfo = null;
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  try {
    // Give the process a moment to crash-loop before polling, so a hard
    // startup crash fails fast with a clear message instead of a generic
    // "CDP never came up" timeout.
    await new Promise((r) => setTimeout(r, 1500));
    if (exitInfo) throw new Error(`app exited immediately (code=${exitInfo.code}, signal=${exitInfo.signal})`);

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    for (const title of EXPECTED_WINDOW_TITLES) {
      const target = await waitForWindow(title, deadline);
      const length = await evaluateInPage(target.webSocketDebuggerUrl, 'document.body.innerHTML.length');
      console.log(`"${title}": document.body has ${length} chars`);
      if (!length || length < MIN_BODY_LENGTH) {
        throw new Error(
          `"${title}" rendered an empty/near-empty document (${length ?? 0} chars) - the renderer bundle likely didn't load`,
        );
      }
    }
    console.log('smoke test passed: both windows rendered real content');
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
