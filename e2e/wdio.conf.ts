/**
 * WebdriverIO configuration for MeldUI E2E tests.
 *
 * Uses tauri-driver as the bridge between WebdriverIO and
 * Tauri's WKWebView on macOS.
 */

import { join } from "path";
import { spawn, type ChildProcess } from "child_process";

const projectRoot = join(import.meta.dir, "..");

// Determine architecture for binary names
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const mockBinary = join(projectRoot, "src-tauri", "binaries", `agent-mock-${arch}-apple-darwin`);
const fixtureDir = join(projectRoot, "e2e", "fixtures", "spec-understand-happy");

let tauriDriver: ChildProcess;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./e2e/specs/**/*.e2e.ts"],

  maxInstances: 1,
  capabilities: [
    {
      // @ts-expect-error custom capability for tauri
      "tauri:options": {
        application: join(
          projectRoot,
          "src-tauri",
          "target",
          "debug",
          "meldui"
        ),
      },
    },
  ],

  logLevel: "info",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],

  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  // Start tauri-driver before tests
  onPrepare: function () {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tauriDriver.stderr?.on("data", (data: Buffer) => {
      console.error(`[tauri-driver stderr] ${data.toString().trim()}`);
    });

    // Wait for tauri-driver to be ready
    return new Promise<void>((resolve) => {
      // Give tauri-driver time to start
      setTimeout(resolve, 2000);
    });
  },

  // Kill tauri-driver after tests
  onComplete: function () {
    tauriDriver?.kill();
  },

  // Set environment variables for mock sidecar
  before: function () {
    process.env.MELDUI_AGENT_BINARY = mockBinary;
    process.env.MOCK_FIXTURE_DIR = fixtureDir;
  },

  hostname: "localhost",
  port: 4444,
};

export default config;
