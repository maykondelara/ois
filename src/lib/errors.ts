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

/** Raised only when Stage 1 cannot establish an active TenantContext. */
export class TenantContextUnavailableError extends AuthorizationError {
  constructor() {
    super("No active membership for the requested company");
    this.name = "TenantContextUnavailableError";
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

/** HTTP-safe concealment response for an unauthorised tenant selector. */
export class TenantResourceNotFoundError extends DomainError {
  constructor() {
    super("TENANT_RESOURCE_NOT_FOUND", "Tenant resource not found");
    this.name = "TenantResourceNotFoundError";
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
