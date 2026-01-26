/**
 * Type declarations for @lydell/node-pty
 * The package has types but they're not properly exported via package.json
 */

declare module "@lydell/node-pty" {
  export interface IPty {
    readonly pid: number;
    readonly cols: number;
    readonly rows: number;
    readonly process: string;
    
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
    
    onData(callback: (data: string) => void): IDisposable;
    onExit(callback: (exitData: { exitCode: number; signal?: number }) => void): IDisposable;
  }
  
  export interface IDisposable {
    dispose(): void;
  }
  
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
    encoding?: string;
    handleFlowControl?: boolean;
  }
  
  export function spawn(
    file: string,
    args: string[],
    options: IPtyForkOptions
  ): IPty;
}
