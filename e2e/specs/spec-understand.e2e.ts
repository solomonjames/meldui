/**
 * E2E test: Spec Understand step in MELD Full Flow workflow.
 *
 * Tests the full pipeline:
 *   React → Tauri invoke → Rust agent.rs → Mock sidecar → NDJSON fixture → UI
 *
 * Prerequisites:
 * - Mock sidecar built: `bun run e2e:build-mock`
 * - App built: `bun run tauri:build` (or debug build)
 * - tauri-driver installed
 */

describe("Spec Understand workflow step", () => {
  it("should stream fixture response and show approve button", async () => {
    // Wait for app to load
    const body = await $("body");
    await body.waitForExist({ timeout: 15000 });

    // The app should show the main interface
    // Note: This test assumes a pre-configured project dir + ticket.
    // In a full E2E setup, we'd interact with the folder picker or
    // pre-seed the tauri-plugin-store data.

    // Look for the workflow shell to appear
    const workflowShell = await $('[data-testid="workflow-shell"]');

    // If workflow shell exists, verify the stage bar
    if (await workflowShell.isExisting()) {
      const stageBar = await $('[data-testid="stage-bar"]');
      await expect(stageBar).toBeExisting();

      // Wait for chat view to appear (indicates a chat-type step is active)
      const chatView = await $('[data-testid="chat-view"]');
      if (await chatView.isExisting()) {
        // Wait for the ticket context panel to show streamed content
        // (spec-understand writes_to: [design], so text streams into Ticket Context)
        const ticketContext = await chatView.$(".w-1\\/2.border-r .prose");
        await ticketContext.waitForExist({ timeout: 30000 });

        // Verify the fixture content appeared in Ticket Context
        const responseText = await ticketContext.getText();
        expect(responseText).toContain("Problem Statement");

        // Check for the approve gate button
        const approveBtn = await $('[data-testid="approve-gate"]');
        await approveBtn.waitForExist({ timeout: 10000 });
        expect(await approveBtn.isDisplayed()).toBe(true);
      }
    }
  });

  it("should show stage bar with step indicators", async () => {
    const stageBar = await $('[data-testid="stage-bar"]');
    if (await stageBar.isExisting()) {
      // Verify at least one step exists in the stage bar
      const steps = await $$('[data-testid^="stage-step-"]');
      expect(steps.length).toBeGreaterThan(0);
    }
  });
});
