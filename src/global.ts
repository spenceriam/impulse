import os from "os";
import path from "path";

export namespace Global {
  export namespace Path {
    const homeDir = os.homedir();
    const baseConfigDir = path.join(homeDir, ".config", "glm-cli");

    export const config: string = baseConfigDir;
    export const data: string = baseConfigDir;
    export const logs: string = path.join(baseConfigDir, "logs");
  }
}
