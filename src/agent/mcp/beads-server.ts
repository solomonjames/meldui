/**
 * Beads MCP server — exposes bd CLI operations as tools
 * that Claude can call directly during workflow execution.
 *
 * Uses the Agent SDK's createSdkMcpServer + tool() for
 * in-process MCP tool registration.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let cachedBdPath: string | null = null;

/**
 * Find the bd CLI binary, searching common install locations.
 * Same search strategy as beads.rs.
 */
function findBdBinary(hint?: string): string {
  if (hint && existsSync(hint)) {
    return hint;
  }
  if (cachedBdPath && existsSync(cachedBdPath)) {
    return cachedBdPath;
  }

  const home = homedir();
  const candidates = [
    "/opt/homebrew/bin/bd",
    "/usr/local/bin/bd",
    join(home, ".local/bin/bd"),
    join(home, "go/bin/bd"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      cachedBdPath = path;
      return path;
    }
  }

  // Last resort: assume it's on PATH
  cachedBdPath = "bd";
  return "bd";
}

/**
 * Run a bd command and return stdout.
 */
async function runBd(
  bdPath: string,
  projectDir: string,
  args: string[]
): Promise<string> {
  const proc = Bun.spawn([bdPath, ...args, "--json"], {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`bd ${args[0]} failed: ${stderr.trim() || "unknown error"}`);
  }

  return stdout.trim();
}

/**
 * Create a Beads MCP server with tools for issue management.
 */
export function createBeadsMcpServer(projectDir: string, bdBinaryHint?: string) {
  const bdPath = findBdBinary(bdBinaryHint);

  const beadsList = tool(
    "beads_list",
    "List beads issues. Returns JSON array of issues.",
    {
      status: z.string().optional().describe("Filter by status: open, closed, in_progress"),
      type: z.string().optional().describe("Filter by issue type: task, bug, feature, epic"),
    },
    async ({ status, type }) => {
      const args = ["list"];
      if (status) {
        args.push("-s", status);
      }
      if (type) {
        args.push("-t", type);
      }
      args.push("-n", "0");
      const output = await runBd(bdPath, projectDir, args);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const beadsShow = tool(
    "beads_show",
    "Show full details of a beads issue by ID.",
    {
      id: z.string().describe("The issue ID (e.g., beads-abc123)"),
    },
    async ({ id }) => {
      const output = await runBd(bdPath, projectDir, ["show", id]);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const beadsCreate = tool(
    "beads_create",
    "Create a new beads issue.",
    {
      title: z.string().describe("Issue title"),
      description: z.string().optional().describe("Issue description"),
      type: z.string().optional().describe("Issue type: task, bug, feature, epic"),
      priority: z.string().optional().describe("Priority: 0-4 (0=critical, 2=medium, 4=backlog)"),
    },
    async ({ title, description, type, priority }) => {
      const args = ["create", title];
      if (type) args.push("-t", type);
      if (priority) args.push("-p", priority);
      if (description) args.push("-d", description);
      const output = await runBd(bdPath, projectDir, args);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const beadsUpdate = tool(
    "beads_update",
    "Update a field on a beads issue.",
    {
      id: z.string().describe("The issue ID"),
      field: z.string().describe("Field to update: title, status, priority, description, notes, design, acceptance"),
      value: z.string().describe("New value for the field"),
    },
    async ({ id, field, value }) => {
      const flagMap: Record<string, string> = {
        title: "--title",
        status: "-s",
        priority: "-p",
        description: "-d",
        notes: "--notes",
        design: "--design",
        acceptance: "--acceptance",
      };
      const flag = flagMap[field];
      if (!flag) {
        return { content: [{ type: "text" as const, text: `Unknown field: ${field}` }], isError: true };
      }
      const output = await runBd(bdPath, projectDir, ["update", id, flag, value]);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const beadsClose = tool(
    "beads_close",
    "Close a beads issue.",
    {
      id: z.string().describe("The issue ID to close"),
      reason: z.string().optional().describe("Reason for closing"),
    },
    async ({ id, reason }) => {
      const args = ["close", id];
      if (reason) args.push("-r", reason);
      const output = await runBd(bdPath, projectDir, args);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const beadsComment = tool(
    "beads_comment",
    "Add a comment to a beads issue.",
    {
      id: z.string().describe("The issue ID"),
      text: z.string().describe("Comment text to add"),
    },
    async ({ id, text }) => {
      const output = await runBd(bdPath, projectDir, ["comments", "add", id, text]);
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  return createSdkMcpServer({
    name: "beads",
    tools: [beadsList, beadsShow, beadsCreate, beadsUpdate, beadsClose, beadsComment],
  });
}
