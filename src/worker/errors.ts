export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Not authenticated") {
    super(401, message, "unauthorized");
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Not allowed") {
    super(403, message, "forbidden");
  }
}

/**
 * Returned when a requested row does not exist OR belongs to another garage.
 * These two cases are deliberately indistinguishable to the client: a
 * separate 403 would confirm that an ID exists in someone else's garage,
 * which is itself a small cross-tenant leak.
 */
export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message, "not_found");
  }
}

export class ValidationError extends HttpError {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(422, message, "invalid");
  }
}
