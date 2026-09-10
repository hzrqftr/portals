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

/**
 * The request body was well-formed but too large to accept -- an upload over
 * MAX_ATTACHMENT_BYTES, in practice.
 *
 * Separate from ValidationError because "your file is 14 MB and the limit is
 * 10" is not the same answer as "this field is malformed", and a 422 sends the
 * client looking for a field to fix. app.onError in both portals maps any
 * HttpError to its own status, so nothing else has to change to use this.
 */
export class PayloadTooLargeError extends HttpError {
  constructor(message = "File too large") {
    super(413, message, "too_large");
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
