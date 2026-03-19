import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

export function useUpdater() {
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update) {
          toast.info(`Update available (v${update.version})`, {
            description: "Click to download and install.",
            duration: Infinity,
            action: {
              label: "Install",
              onClick: async () => {
                try {
                  await update.downloadAndInstall();
                  await relaunch();
                } catch (err) {
                  toast.error("Update failed", {
                    description: String(err),
                  });
                }
              },
            },
          });
        }
      } catch {
        // Silently ignore update check failures (e.g., no internet, no pubkey configured)
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
}
