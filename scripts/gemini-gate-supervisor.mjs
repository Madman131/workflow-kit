#!/usr/bin/env node

import fs from "node:fs";
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
for (const [name, value] of [["timeout-seconds", timeoutSeconds], ["grace-seconds", graceSeconds], ["parent-pid", parentPid]]) {
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
}
for (const required of ["stdout", "stderr", "pid-file", "temp-dir", "lock-dir", "attempt-log", "parent-loss-meta"]) {
  if (!options[required]) fail(`missing --${required}`);
}

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
  const addition = `supervisor_pid=${process.pid}\nsupervisor_start=${psField(process.pid, "lstart")}\nsupervisor_command=${psField(process.pid, "command")}\n`;
  try {
    fs.writeFileSync(temporary, `${owner.trimEnd()}\n${addition}`, { mode: 0o600 });
    fs.renameSync(temporary, ownerPath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    fail(`cannot publish supervisor ownership: ${error.message}`, 3);
  }
}

// Publication precedes spawn: no agy process can exist without a durable supervisor owner.
publishSupervisorOwner();

let stdoutFd;
let stderrFd;
try {
  stdoutFd = fs.openSync(options.stdout, "w", 0o600);
  stderrFd = fs.openSync(options.stderr, "w", 0o600);
} catch (error) {
  if (stdoutFd !== undefined) {
    try { fs.closeSync(stdoutFd); } catch {}
  }
  fail(`cannot open output files: ${error.message}`, 3);
}

let child;
try {
  child = spawn(command, commandArgs, {
    detached: true,
    env: process.env,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
} catch (error) {
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  fail(`cannot start child: ${error.message}`, 127);
}
fs.closeSync(stdoutFd);
fs.closeSync(stderrFd);

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

function readMeta() {
  const meta = {};
  for (const line of fs.readFileSync(options["parent-loss-meta"], "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) meta[line.slice(0, at)] = line.slice(at + 1);
  }
  return meta;
}

function cleanupAfterParentLoss() {
  if (!parentLost) return;
  const end = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  try {
    const meta = readMeta();
    if (meta.do_log !== "0") {
      let output = "";
      try { output = fs.readFileSync(options.stdout, "utf8"); } catch {}
      const indented = (output.trim() || "(no output)").split("\n").map((line) => `    ${line}`).join("\n");
      const record = `\n## Gemini gate attempt — FAILED_TOOL — ${end}\n\n` +
        `- Status: \`FAILED_TOOL\`\n- Attempt-ID: \`${meta.attempt_id || "unknown"}\`\n` +
        `- Record-Kind: \`${meta.record_kind || "FULL_REVIEW"}\`\n- Release-Gate: \`NO\`\n` +
        `${meta.plan_id ? `- Plan-ID: \`${meta.plan_id}\`\n` : ""}` +
        `- Delivery: \`${meta.delivery || "UNSELECTED"}\`\n` +
        `- Bytes: raw_payload=${meta.raw_payload || 0}; instrumented_payload=${meta.payload || 0}; inline_combined=${meta.combined || 0}; file=${meta.file || 0}\n` +
        `- Ingestion proof: EOF receipt + ${meta.canaries || 0} distributed random canary token(s)\n` +
        `- Model: ${meta.model || "unknown"}\n- Context/design: ${meta.context || "(none)"}\n` +
        `- HEAD: \`${meta.head || "unknown"}\`\n- Start: ${meta.start || "unknown"}\n- End: ${end}\n` +
        `- Slice: ${meta.slice || "(none; full artifact)"}\n\n### Diagnostic output — NOT A VERDICT\n\n` +
        `    runner parent ${parentPid} exited abruptly; supervisor terminated the owned process group and performed parent-loss cleanup\n${indented}\n`;
      fs.appendFileSync(options["attempt-log"], record, { encoding: "utf8" });
    }
  } catch (error) {
    process.stderr.write(`gemini-gate-supervisor: could not append parent-loss attempt: ${error.message}\n`);
  }
  try {
    const owner = fs.readFileSync(`${options["lock-dir"]}/owner`, "utf8");
    if (owner.split("\n").includes(`pid=${parentPid}`)) fs.rmSync(options["lock-dir"], { recursive: true, force: true });
  } catch {}
  try { fs.rmSync(options["temp-dir"], { recursive: true, force: true }); } catch {}
}

function signalGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") process.stderr.write(`gemini-gate-supervisor: ${signal} failed: ${error.message}\n`);
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutTimer);
  clearInterval(parentTimer);
  if (killTimer) clearTimeout(killTimer);
  cleanupAfterParentLoss();
  process.exit(code);
}

function terminate(exitCode, reason) {
  if (finished || requestedExit !== null) return;
  requestedExit = exitCode;
  process.stderr.write(`gemini-gate-supervisor: ${reason}; terminating owned process group ${child.pid}\n`);
  signalGroup("SIGTERM");
  killTimer = setTimeout(() => signalGroup("SIGKILL"), graceSeconds * 1000);
  killTimer.unref();
}

const timeoutTimer = setTimeout(
  () => terminate(124, `timeout after ${timeoutSeconds}s`),
  timeoutSeconds * 1000,
);

const parentTimer = setInterval(() => {
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
    if (requestedExit !== null) return finish(requestedExit);
    if (Number.isInteger(code)) return finish(code);
    const signalExit = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 }[signal];
    finish(signalExit ?? 1);
  }, Math.min(graceSeconds * 1000, 250));
});
