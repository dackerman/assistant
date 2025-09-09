import { type ChildProcess, spawn } from "node:child_process";
import type { Logger } from "../utils/logger.js";

export interface BashSessionConfig {
  workingDirectory?: string;
  timeout?: number;
  environment?: Record<string, string>;
}

export interface CommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface StreamingCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (exitCode: number | null, signal: string | null) => void;
  onError?: (error: Error) => void;
}

/**
 * BashSession maintains a persistent bash process for executing commands.
 * It provides both streaming and buffered execution modes without any database interactions.
 */
export class BashSession {
  private process?: ChildProcess;
  private readonly config: Required<BashSessionConfig>;
  private readonly logger: Logger;
  private commandCounter = 0;

  constructor(logger: Logger, config: BashSessionConfig = {}) {
    this.config = {
      workingDirectory: config.workingDirectory || process.cwd(),
      timeout: config.timeout || 300000, // 5 minutes default
      environment: {
        ...(process.env as Record<string, string>),
        ...config.environment,
      },
    };
    this.logger = logger.child({ service: "BashSession" });
  }

  /**
   * Start the persistent bash session
   */
  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.logger.info("Starting bash session", {
      workingDirectory: this.config.workingDirectory,
    });

    try {
      this.process = spawn("bash", ["-i"], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.config.workingDirectory,
        env: this.config.environment,
        detached: false,
      });

      if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
        throw new Error("Failed to create stdio pipes for bash process");
      }

      // Handle process exit
      this.process.on("exit", (code, signal) => {
        this.logger.info("Bash session exited", { code, signal });
        this.process = undefined;
      });

      // Handle process errors
      this.process.on("error", (error) => {
        this.logger.error("Bash session error", { error });
        this.process = undefined;
      });

      // Wait a moment for the process to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.logger.info("Bash session started successfully");
    } catch (error) {
      this.logger.error("Failed to start bash session", { error });
      this.process = undefined;
      throw error;
    }
  }

  /**
   * Execute a command with streaming callbacks
   */
  async exec(
    command: string,
    callbacks: StreamingCallbacks = {},
  ): Promise<CommandResult> {
    const process = this.process;
    if (!process) {
      throw new Error("Bash session not started");
    }

    const commandId = ++this.commandCounter;
    this.logger.info("Executing streaming command", { commandId, command });

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let completed = false;

      const cleanup = () => {
        if (process) {
          process.stdout?.removeAllListeners("data");
          process.stderr?.removeAllListeners("data");
        }
      };

      const complete = (result: CommandResult) => {
        if (completed) return;
        completed = true;
        cleanup();
        callbacks.onExit?.(result.exitCode, null);
        resolve(result);
      };

      const fail = (error: Error) => {
        if (completed) return;
        completed = true;
        cleanup();
        callbacks.onError?.(error);
        reject(error);
      };

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        fail(
          new Error(
            `Streaming command timed out after ${this.config.timeout}ms`,
          ),
        );
      }, this.config.timeout);

      try {
        // Generate unique markers to detect command completion
        const startMarker = `__BASH_SESSION_START_${commandId}__`;
        const endMarker = `__BASH_SESSION_END_${commandId}__`;
        const errorMarker = `__BASH_SESSION_ERROR_${commandId}__`;

        // Listen for stdout with streaming callbacks
        const onStdout = (data: Buffer) => {
          const chunk = data.toString();

          // Filter out our markers before calling callback
          if (
            !chunk.includes(startMarker) &&
            !chunk.includes(endMarker) &&
            !chunk.includes(errorMarker)
          ) {
            callbacks.onStdout?.(chunk);
          }

          stdout += chunk;

          // Check for completion markers
          if (chunk.includes(endMarker)) {
            clearTimeout(timeoutHandle);
            complete({
              success: true,
              exitCode: 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          }
        };

        // Listen for stderr with streaming callbacks
        const onStderr = (data: Buffer) => {
          const chunk = data.toString();

          // Filter out our markers before calling callback
          if (!chunk.includes(errorMarker)) {
            callbacks.onStderr?.(chunk);
          }

          stderr += chunk;

          // Check for error marker
          if (chunk.includes(errorMarker)) {
            clearTimeout(timeoutHandle);
            complete({
              success: false,
              exitCode: 1,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              error: "Streaming command execution failed",
            });
          }
        };

        process.stdout?.on("data", onStdout);
        process.stderr?.on("data", onStderr);

        // Execute the command with markers
        const wrappedCommand = [
          `echo "${startMarker}"`,
          command,
          `echo "${endMarker}"`,
          `|| echo "${errorMarker}"`,
        ].join("; ");

        process.stdin?.write(`${wrappedCommand}\n`);
      } catch (error) {
        clearTimeout(timeoutHandle);
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Check if the session is alive
   */
  get alive(): boolean {
    return this.process !== undefined;
  }

  /**
   * Get process PID
   */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Stop the bash session
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.logger.info("Stopping bash session");

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.process = undefined;
        resolve();
      };

      // Set timeout for forceful termination
      const forceKillTimeout = setTimeout(() => {
        this.logger.warn("Force killing bash session");
        this.process?.kill("SIGKILL");
        cleanup();
      }, 5000);

      this.process.on("exit", () => {
        clearTimeout(forceKillTimeout);
        cleanup();
      });

      // Try graceful termination first
      this.process.stdin?.write("exit\n");

      // If that doesn't work, send SIGTERM
      setTimeout(() => {
        if (this.process) {
          this.logger.info("Sending SIGTERM to bash session");
          this.process.kill("SIGTERM");
        }
      }, 1000);
    });
  }

  /**
   * Send raw input to the bash process
   * Use with caution - prefer executeCommand or executeCommandStreaming
   */
  writeInput(input: string): void {
    if (!this.process || !this.process.stdin) {
      throw new Error("Bash session not started or stdin not available");
    }
    this.process.stdin.write(input);
  }
}
