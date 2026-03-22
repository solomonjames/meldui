import { load, type Store } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/bindings";

const STORE_FILE = "settings.json";
const STORE_KEY = "lastProjectDir";

export function useProjectDir() {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const storeRef = useRef<Store | null>(null);

  useEffect(() => {
    load(STORE_FILE).then(async (store) => {
      storeRef.current = store;
      const saved = await store.get<string>(STORE_KEY);
      if (saved) {
        setProjectDir(saved);
      }
      setLoading(false);
    });
  }, []);

  const openFolderDialog = useCallback(async () => {
    const selected = await commands.openFolderDialog();
    if (selected) {
      setProjectDir(selected);
      const store = storeRef.current ?? (await load(STORE_FILE));
      await store.set(STORE_KEY, selected);
      await store.save();
    }
  }, []);

  const folderName = projectDir ? (projectDir.split("/").pop() ?? projectDir) : null;

  return { projectDir, folderName, loading, openFolderDialog };
}
