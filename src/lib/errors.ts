/* eslint-disable no-unused-vars */
export class AuthenticationError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class TenantRecordNotFoundError extends DomainError {
  constructor(resource: string) {
    super("TENANT_RECORD_NOT_FOUND", `${resource} not found`);
    this.name = "TenantRecordNotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ValidationError";
  }
}
