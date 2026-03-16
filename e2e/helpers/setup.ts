/**
 * E2E test helpers for MeldUI.
 *
 * Provides utilities for creating temporary project directories
 * with pre-seeded ticket data.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const projectRoot = join(import.meta.dir, "..", "..");

/**
 * Create a temporary project directory with a .meldui/tickets/ structure
 * containing the test ticket fixture.
 */
export function createTestProject(
  fixturePath?: string
): { projectDir: string; ticketId: string } {
  const projectDir = join(
    tmpdir(),
    `meldui-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const ticketsDir = join(projectDir, ".meldui", "tickets");
  mkdirSync(ticketsDir, { recursive: true });

  // Read and write the test ticket
  const ticketFixture = fixturePath
    ?? join(projectRoot, "e2e", "fixtures", "test-ticket.json");
  const ticketData = JSON.parse(readFileSync(ticketFixture, "utf-8"));
  const ticketId = ticketData.id;

  // Write ticket file (filename matches ticket id)
  writeFileSync(
    join(ticketsDir, `${ticketId}.json`),
    JSON.stringify(ticketData, null, 2)
  );

  return { projectDir, ticketId };
}

/**
 * Clean up a temporary project directory.
 */
export function cleanupTestProject(projectDir: string): void {
  try {
    rmSync(projectDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
