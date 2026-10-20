import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

export const root = fileURLToPath(new URL("../", import.meta.url));

// Port zero can select a port prohibited by Fetch. Use the desktop launcher's
// high port range while still proving the real token-protected HTTP transport.
async function testPort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer(); probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
      });
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE" && error.code !== "EACCES") { throw error; } }
  }
  throw new Error("No available loopback test port was found.");
}

export async function startHost(vault) {
  const token = randomBytes(32).toString("hex");
  const port = await testPort();
  const child = spawn("dotnet", [join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll"), "--urls", `http://127.0.0.1:${port}`], {
    cwd: join(root, "src", "RonSijm.Slopsidian"),
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", SLOPSIDIAN_TOKEN: token, SLOPSIDIAN_PARENT: "1", SLOPSIDIAN_VAULT: vault ?? "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let log = "";
  let endpoint;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", text => {
      log += text;
      const match = log.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)\r?\n/m);
      if (match) {
        endpoint = match[1];
      }
    });
  }
  async function stop() {
    if (child.exitCode === null) {
      child.stdin.end("shutdown\n");
    }
    const [code, signal] = await exited;
    assert.equal(signal, null, log);
    assert.equal(code, 0, log);
  }
  const deadline = Date.now() + 20000;
  while (!endpoint && child.exitCode === null && Date.now() < deadline) {
    await delay(50);
  }
  if (!endpoint) {
    await stop();
    throw new Error(`Host did not start.\n${log}`);
  }
  return {
    endpoint,
    stop,
    log: () => log,
    request: (path, method = "GET", body) => fetch(endpoint + path, {
      method,
      headers: { "X-Vault-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  };
}
