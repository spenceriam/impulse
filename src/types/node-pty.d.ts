declare module "node-pty" {
  export interface IPty {
    readonly pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (event: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    kill(signal?: string): void;
  }

  export function spawn(
    file: string,
    args: string[] | string,
    options: Record<string, unknown>
  ): IPty;
}
