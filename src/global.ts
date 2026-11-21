import os from "os";
import path from "path";

export namespace Global {
  export namespace Path {
    const homeDir = os.homedir();
    /**
     * Branded Impulse home (~/.impulse).
     *
     * `IMPULSE_HOME` overrides it — tests point it at a throwaway directory so
     * they never read or orphan state in the real session store (#156).
     */
    export const home: string = process.env["IMPULSE_HOME"] || path.join(homeDir, ".impulse");

    export const config: string = home;
    export const data: string = home;
    export const sessions: string = path.join(home, "sessions");
    export const logs: string = path.join(home, "logs");
    export const cache: string = path.join(home, "cache");

    /** Legacy XDG layout (read fallback + one-time migration source) */
    export const legacyData: string = path.join(homeDir, ".config", "impulse");
  }
}
