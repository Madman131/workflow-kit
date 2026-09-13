#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn } from "node:child_process";

function fail(message, code = 2) {
  process.stderr.write(`gemini-gate-supervisor: ${message}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const options = {};
let separator = args.indexOf("--");
if (separator < 0) fail("missing -- before the child command");

for (let i = 0; i < separator; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (!key?.startsWith("--") || value === undefined) fail(`invalid option near ${key ?? "<end>"}`);
  options[key.slice(2)] = value;
}

const command = args[separator + 1];
const commandArgs = args.slice(separator + 2);
if (!command) fail("missing child command");

const timeoutSeconds = Number(options["timeout-seconds"]);
const graceSeconds = Number(options["grace-seconds"] ?? 2);
const parentPid = Number(options["parent-pid"]);
const forwardStdin = options.stdin === "forward";
if (options.stdin !== undefined && !forwardStdin) fail("--stdin must be forward when supplied");
if (options.cwd !== undefined && (!fs.existsSync(options.cwd) || !fs.statSync(options.cwd).isDirectory())) fail("--cwd must name an existing directory");
if (options["parent-heartbeat"] !== undefined && !fs.existsSync(options["parent-heartbeat"])) fail("--parent-heartbeat must name an existing file");
for (const key of ["stdout-limit", "stderr-limit"]) if (options[key] !== undefined && (!/^\d+$/.test(options[key]) || Number(options[key]) < 1)) fail(`--${key} must be a positive byte limit`);
for (const [name, value] of [["timeout-seconds", timeoutSeconds], ["grace-seconds", graceSeconds], ["parent-pid", parentPid]]) {
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
}
for (const required of ["stdout", "stderr", "pid-file", "temp-dir", "lock-dir", "parent-loss-meta"]) {
  if (!options[required]) fail(`missing --${required}`);
}
const stdoutLimit = options["stdout-limit"] === undefined ? 4 * 1024 * 1024 : Number(options["stdout-limit"]), stderrLimit = options["stderr-limit"] === undefined ? 1024 * 1024 : Number(options["stderr-limit"]);

function psField(pid, field) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`cannot establish supervisor ${field} identity: ${error.message}`, 3);
  }
}

function publishSupervisorOwner() {
  const ownerPath = `${options["lock-dir"]}/owner`;
  const temporary = `${options["lock-dir"]}/owner.supervisor.${process.pid}`;
  let owner;
  try { owner = fs.readFileSync(ownerPath, "utf8"); } catch (error) { fail(`cannot read runner lock owner: ${error.message}`, 3); }
  if (!owner.split("\n").includes(`pid=${parentPid}`)) fail("runner no longer owns the lock; refusing to spawn agy", 3);
  const retained = owner.split("\n").filter(line => !/^supervisor_(?:pid|start|command|state|unresolved_at)=/.test(line) && line).join("\n");
  const addition = `supervisor_pid=${process.pid}\nsupervisor_start=${psField(process.pid, "lstart")}\nsupervisor_command=${psField(process.pid, "command")}\n`;
  try {
    fs.writeFileSync(temporary, `${retained}\n${addition}`, { mode: 0o600 });
    fs.renameSync(temporary, ownerPath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    fail(`cannot publish supervisor ownership: ${error.message}`, 3);
  }
}

function readBoundedFile(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    const chunks = []; let remaining = limit + 1;
    while (remaining > 0) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, remaining)), read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) break;
      chunks.push(chunk.subarray(0, read)); remaining -= read;
    }
    const bytes = Buffer.concat(chunks);
    return { bytes: bytes.subarray(0, limit), overflow: bytes.length > limit };
  } finally { fs.closeSync(fd); }
}

// Publication precedes spawn: no agy process can exist without a durable supervisor owner.
publishSupervisorOwner();

const captures = {
  stdout: { file: options.stdout, limit: stdoutLimit, bytes: 0, overflow: false, fd: undefined },
  stderr: { file: options.stderr, limit: stderrLimit, bytes: 0, overflow: false, fd: undefined },
};
try {
  for (const capture of Object.values(captures)) capture.fd = fs.openSync(capture.file, "w", 0o600);
} catch (error) {
  for (const capture of Object.values(captures)) if (capture.fd !== undefined) try { fs.closeSync(capture.fd); } catch {}
  fail(`cannot open output files: ${error.message}`, 3);
}

function closeCaptures() {
  for (const capture of Object.values(captures)) if (capture.fd !== undefined) {
    try { fs.closeSync(capture.fd); } catch {}
    capture.fd = undefined;
  }
}

function writeAll(fd, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw new Error("output capture write made no progress");
    offset += written;
  }
}

let child;
try {
  child = spawn(command, commandArgs, {
    detached: true,
    env: process.env,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    stdio: [forwardStdin ? process.stdin : "ignore", "pipe", "pipe"],
  });
} catch (error) {
  closeCaptures();
  fail(`cannot start child: ${error.message}`, 127);
}

if (!Number.isInteger(child.pid) || child.pid <= 0) {
  fail("child process did not start with a valid pid", 127);
}

try {
  fs.writeFileSync(options["pid-file"], `${child.pid}\n`, { mode: 0o600 });
} catch (error) {
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
  fail(`cannot write child pid file: ${error.message}`, 3);
}

let finished = false;
let requestedExit = null;
let killTimer = null;
let parentLost = false;
let closureTimer = null;
let unresolvedOwnership = false;
let nextUnresolvedOwnershipWrite = 0;

function signalGroup(signal) {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    process.stderr.write(`gemini-gate-supervisor: ${signal} failed: ${error.message}\n`);
    return true;
  }
}

function groupIsLive() {
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function markUnresolvedOwnership() {
  if (unresolvedOwnership) return true;
  const ownerPath = `${options["lock-dir"]}/owner`, temporary = `${ownerPath}.unresolved.${process.pid}`;
  try {
    const retained = fs.readFileSync(ownerPath, "utf8").split("\n").filter(line => !/^supervisor_(?:state|unresolved_at)=/.test(line) && line).join("\n");
    fs.writeFileSync(temporary, `${retained}\nsupervisor_state=UNRESOLVED_PROCESS_GROUP\nsupervisor_unresolved_at=${new Date().toISOString()}\n`, { mode: 0o600 });
    fs.renameSync(temporary, ownerPath);
    unresolvedOwnership = true;
    return true;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    process.stderr.write(`gemini-gate-supervisor: could not preserve unresolved ownership: ${error.message}\n`);
    return false;
  }
}

function captureOutput(label, chunk) {
  const capture = captures[label];
  if (capture.overflow) return;
  const allowed = Math.max(0, capture.limit - capture.bytes), persisted = Math.min(allowed, chunk.length);
  try {
    if (persisted) writeAll(capture.fd, chunk.subarray(0, persisted));
    capture.bytes += persisted;
  } catch (error) {
    capture.overflow = true;
    terminate(3, `cannot persist bounded ${label} capture: ${error.message}`);
    return;
  }
  if (persisted !== chunk.length) {
    capture.overflow = true;
    terminate(3, `${label} exceeded bounded capture limit`);
  }
}

child.stdout.on("data", chunk => captureOutput("stdout", chunk));
child.stderr.on("data", chunk => captureOutput("stderr", chunk));
child.stdout.once("error", error => terminate(3, `stdout capture failed: ${error.message}`));
child.stderr.once("error", error => terminate(3, `stderr capture failed: ${error.message}`));

function readMeta() {
  const meta = JSON.parse(fs.readFileSync(options["parent-loss-meta"], "utf8"));
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || !/^PIL-FROZEN-ATTEMPT-[0-9a-f]{24}$/.test(meta.attempt_id || "") || !meta.frozen || typeof meta.frozen !== "object" || !/^[0-9a-f]{40}$/.test(meta.frozen.base || "") || !/^[0-9a-f]{40}$/.test(meta.frozen.candidate || "") || !/^[0-9a-f]{40}$/.test(meta.frozen.tree || "") || typeof meta.plan_id !== "string" || typeof meta.slice !== "string" || !meta.transport || typeof meta.transport !== "object" || typeof meta.transport.name !== "string" || typeof meta.transport.identity !== "string" || typeof meta.diagnostic_path !== "string") throw new Error("parent-loss metadata is malformed");
  return meta;
}

function writeParentLossDiagnostic(meta, end) {
  if (!options["parent-loss-diagnostic"] || meta.diagnostic_path !== options["parent-loss-diagnostic"]) throw new Error("parent-loss diagnostic path is not bound by metadata");
  let captured = { bytes: Buffer.alloc(0), overflow: false };
  try { captured = readBoundedFile(options.stdout, stdoutLimit); } catch {}
  const diagnostic = {
    version: 1,
    kind: "ABRUPT_PARENT_LOSS_UNVERIFIED",
    non_verdict: true,
    attempt_id: meta.attempt_id,
    frozen: meta.frozen,
    plan_id: meta.plan_id,
    slice: meta.slice,
    transport: meta.transport,
    parent_pid: parentPid,
    supervisor_pid: process.pid,
    started_at: meta.started_at,
    ended_at: end,
    process_group: { pid: child.pid, closure_observed: !unresolvedOwnership, ownership: unresolvedOwnership ? "UNRESOLVED_PROCESS_GROUP" : "CLOSED" },
    verification: { endpoint: "NOT_COMPLETED", workspace: "NOT_COMPLETED" },
    captured_stdout: { bytes: captured.bytes.length, truncated: captured.overflow, utf8_base64: captured.bytes.toString("base64") },
  };
  const temporary = `${meta.diagnostic_path}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(meta.diagnostic_path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, `${JSON.stringify(diagnostic)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, meta.diagnostic_path);
}

function cleanupAfterParentLoss() {
  if (!parentLost) return;
  const end = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  try {
    const meta = readMeta();
    writeParentLossDiagnostic(meta, end);
  } catch (error) {
    process.stderr.write(`gemini-gate-supervisor: could not write parent-loss diagnostic: ${error.message}\n`);
  }
  try {
    const owner = fs.readFileSync(`${options["lock-dir"]}/owner`, "utf8");
    if (!unresolvedOwnership && owner.split("\n").includes(`pid=${parentPid}`)) fs.rmSync(options["lock-dir"], { recursive: true, force: true });
  } catch {}
  if (!unresolvedOwnership) {
    try { fs.rmSync(options["temp-dir"], { recursive: true, force: true }); } catch {}
    try { fs.rmSync(options["capture-dir"], { recursive: true, force: true }); } catch {}
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutTimer);
  clearInterval(parentTimer);
  if (killTimer) clearTimeout(killTimer);
  if (closureTimer) clearInterval(closureTimer);
  closeCaptures();
  cleanupAfterParentLoss();
  process.exit(code);
}

function observeClosureThenFinish(exitCode) {
  if (finished || closureTimer) return;
  const deadline = Date.now() + Math.max(1000, graceSeconds * 1000 + 1000);
  const observe = () => {
    if (!groupIsLive()) { clearInterval(closureTimer); closureTimer = null; finish(exitCode); return; }
    if (Date.now() >= deadline && Date.now() >= nextUnresolvedOwnershipWrite) {
      nextUnresolvedOwnershipWrite = Date.now() + 1000;
      if (markUnresolvedOwnership()) { clearInterval(closureTimer); closureTimer = null; finish(exitCode); }
    }
  };
  observe();
  if (!finished && !closureTimer) closureTimer = setInterval(observe, 50);
}

function terminate(exitCode, reason) {
  if (finished || requestedExit !== null) return;
  requestedExit = exitCode;
  process.stderr.write(`gemini-gate-supervisor: ${reason}; terminating owned process group ${child.pid}\n`);
  signalGroup("SIGTERM");
  killTimer = setTimeout(() => {
    signalGroup("SIGKILL");
    observeClosureThenFinish(exitCode);
  }, graceSeconds * 1000);
  killTimer.unref();
}

const timeoutTimer = setTimeout(
  () => terminate(124, `timeout after ${timeoutSeconds}s`),
  timeoutSeconds * 1000,
);

const parentTimer = setInterval(() => {
  if (options["parent-heartbeat"]) {
    try {
      if (Date.now() - fs.statSync(options["parent-heartbeat"]).mtimeMs > 1500) {
        parentLost = true; terminate(125, `runner parent ${parentPid} heartbeat stopped`); return;
      }
    } catch { parentLost = true; terminate(125, `runner parent ${parentPid} heartbeat disappeared`); return; }
  }
  if (process.ppid !== parentPid) {
    parentLost = true;
    terminate(125, `runner parent ${parentPid} exited`);
    return;
  }
  try {
    process.kill(parentPid, 0);
  } catch (error) {
    if (error.code === "ESRCH") {
      parentLost = true;
      terminate(125, `runner parent ${parentPid} exited`);
    }
  }
}, 250);

process.on("SIGINT", () => terminate(130, "received INT"));
process.on("SIGTERM", () => terminate(143, "received TERM"));
process.on("SIGHUP", () => terminate(129, "received HUP"));

child.once("error", (error) => {
  process.stderr.write(`gemini-gate-supervisor: child error: ${error.message}\n`);
  terminate(127, "child failed to start");
});

child.once("exit", (code, signal) => {
  // A CLI can exit while a descendant remains. Target the owned group once more so a
  // successful or failed invocation cannot orphan a helper process.
  signalGroup("SIGTERM");
  setTimeout(() => {
    signalGroup("SIGKILL");
    const exitCode = requestedExit ?? (Number.isInteger(code) ? code : ({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 }[signal] ?? 1));
    return observeClosureThenFinish(exitCode);
  }, Math.min(graceSeconds * 1000, 250));
});
