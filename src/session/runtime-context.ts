import { AsyncLocalStorage } from "async_hooks";
import type { SessionManagerImpl } from "./manager.js";

const storage = new AsyncLocalStorage<SessionManagerImpl>();

export function runWithSessionManager<T>(
  manager: SessionManagerImpl,
  action: () => Promise<T>
): Promise<T> {
  return storage.run(manager, action);
}

export function currentSessionManager(): SessionManagerImpl | undefined {
  return storage.getStore();
}
