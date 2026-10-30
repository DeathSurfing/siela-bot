import { getHotkeyManager } from "@tanstack/hotkeys";

export interface HotkeyActions {
  view: (view: string) => void;
  search: () => void;
  help: () => void;
  save: () => void;
  escape: () => void;
}

/**
 * Register the dashboard shortcuts through TanStack Hotkeys. The manager
 * ignores typing targets automatically, so a chord never steals a keystroke
 * from a field unless it uses a modifier.
 */
export function installHotkeys(actions: HotkeyActions): () => void {
  const manager = getHotkeyManager();
  const handles = [
    manager.register(["G", "O"] as const, () => actions.view("overview"), { timeout: 1200 }),
    manager.register(["G", "S"] as const, () => actions.view("servers"), { timeout: 1200 }),
    manager.register(["G", "F"] as const, () => actions.view("features"), { timeout: 1200 }),
    manager.register(["G", "M"] as const, () => actions.view("music"), { timeout: 1200 }),
    manager.register(["G", "T"] as const, () => actions.view("settings"), { timeout: 1200 }),
    manager.register(["G", "U"] as const, () => actions.view("user"), { timeout: 1200 }),
    manager.register(["G", "A"] as const, () => actions.view("audit"), { timeout: 1200 }),
    manager.register(["G", "C"] as const, () => actions.view("commands"), { timeout: 1200 }),
    manager.register("Mod+S", actions.save),
    manager.register("/", actions.search),
    manager.register("?", actions.help),
    manager.register("Escape", actions.escape),
  ];
  return () => {
    for (const handle of handles) handle.unregister();
  };
}
