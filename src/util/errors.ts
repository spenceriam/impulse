import { GLMClientError, GLMAuthError, GLMRateLimitError } from "../api/client";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UIError extends AppError {
  constructor(message: string, recoverable: boolean = true) {
    super(message, "UI_ERROR", recoverable);
    this.name = "UIError";
  }
}

export class SessionError extends AppError {
  constructor(message: string, recoverable: boolean = true) {
    super(message, "SESSION_ERROR", recoverable);
    this.name = "SessionError";
  }
}

export class ToolError extends AppError {
  constructor(
    message: string,
    public readonly toolName: string,
    recoverable: boolean = true
  ) {
    super(message, "TOOL_ERROR", recoverable);
    this.name = "ToolError";
  }
}

export interface ErrorContext {
  operation?: string
  details?: Record<string, unknown>
  timestamp: string
}

class ErrorHandlerImpl {
  private static instance: ErrorHandlerImpl;
  private errorLog: Array<{ error: Error; context: ErrorContext }> = [];

  private constructor() {}

  static getInstance(): ErrorHandlerImpl {
    if (!ErrorHandlerImpl.instance) {
      ErrorHandlerImpl.instance = new ErrorHandlerImpl();
    }
    return ErrorHandlerImpl.instance;
  }

  handle(error: unknown, context: Partial<ErrorContext> = {}): AppError {
    const errorContext: ErrorContext = {
      timestamp: new Date().toISOString(),
      ...context,
    };

    if (error instanceof AppError) {
      this.log(error, errorContext);
      return error;
    }

    if (error instanceof GLMAuthError) {
      const appError = new AppError(
        "Authentication failed. Please check your API key configuration.",
        "AUTH_ERROR",
        false
      );
      this.log(appError, errorContext);
      return appError;
    }

    if (error instanceof GLMRateLimitError) {
      const retryAfter = error.retryAfter ?? 60;
      const appError = new AppError(
        `Rate limited. Please wait ${retryAfter}s before retrying.`,
        "RATE_LIMIT_ERROR",
        true
      );
      this.log(appError, errorContext);
      return appError;
    }

    if (error instanceof GLMClientError) {
      const appError = new AppError(
        `API error: ${error.message}`,
        error.code ?? "API_ERROR",
        true
      );
      this.log(appError, errorContext);
      return appError;
    }

    if (error instanceof Error) {
      const appError = new AppError(
        error.message,
        "UNKNOWN_ERROR",
        true
      );
      this.log(appError, errorContext);
      return appError;
    }

    const appError = new AppError(
      String(error),
      "UNKNOWN_ERROR",
      true
    );
    this.log(appError, errorContext);
    return appError;
  }

  getUserMessage(error: AppError): string {
    switch (error.code) {
      case "AUTH_ERROR":
        return "Authentication failed. Please configure your API key.";
      case "RATE_LIMIT_ERROR":
        return error.message;
      case "API_ERROR":
        return `API error: ${error.message}`;
      case "SESSION_ERROR":
        return `Session error: ${error.message}`;
      case "TOOL_ERROR":
        return error.message;
      case "UI_ERROR":
        return error.message;
      default:
        return `An error occurred: ${error.message}`;
    }
  }

  isRecoverable(error: AppError): boolean {
    return error.recoverable;
  }

  private log(error: Error, context: ErrorContext): void {
    this.errorLog.push({ error, context });

    console.error(`[${context.timestamp}] ${error.name}: ${error.message}`);

    if (context.operation) {
      console.error(`  Operation: ${context.operation}`);
    }

    if (context.details) {
      console.error(`  Details:`, context.details);
    }
  }

  getErrorLog(): Array<{ error: Error; context: ErrorContext }> {
    return [...this.errorLog];
  }

  clearErrorLog(): void {
    this.errorLog = [];
  }
}

export const ErrorHandler = ErrorHandlerImpl.getInstance();
