export class UserError extends Error {
  constructor(
    message: string,
    readonly code = "user_error",
  ) {
    super(message);
    this.name = "UserError";
  }
}

export class NotFoundError extends UserError {
  constructor(message = "Not found") {
    super(message, "not_found");
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends UserError {
  constructor(message = "You do not have permission to do that") {
    super(message, "forbidden");
    this.name = "ForbiddenError";
  }
}

export class ServiceUnavailableError extends UserError {
  constructor(message = "Service unavailable") {
    super(message, "service_unavailable");
    this.name = "ServiceUnavailableError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): string {
  if (error instanceof UserError) return error.code;
  return "internal_error";
}
