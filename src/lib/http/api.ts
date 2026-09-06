/* eslint-disable no-unused-vars */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireTenantContext } from "@/auth/context";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DomainError,
  TenantContextUnavailableError,
  TenantRecordNotFoundError,
  TenantResourceNotFoundError,
  ValidationError,
} from "@/lib/errors";

const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/;
const jsonLimitBytes = 64 * 1024;
const apiResponseMarker = Symbol("apiResponse");

export type ApiRouteContext = Readonly<{ companyId: string; requestId: string }>;
export type OffsetPage = Readonly<{ number: number; pageSize: number }>;
type ApiResponse<T> = Readonly<{ body: T; status: number; [apiResponseMarker]: true }>;

export function apiResponse<T>(body: T, status = 200): ApiResponse<T> {
  return { body, status, [apiResponseMarker]: true };
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return Boolean(
    value &&
    typeof value === "object" &&
    apiResponseMarker in value &&
    (value as ApiResponse<T>)[apiResponseMarker] === true,
  );
}

const uuidSchema = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).max(2_147_483_647);
const pageSizeSchema = z.coerce.number().int().min(1).max(100);
const searchSchema = z.string().trim().min(1).max(100);

function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
}

function configuredOrigin() {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is required for API mutation origin validation");
  return new URL(url).origin;
}

function isUnsafe(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

export function assertRequestSecurity(request: Request) {
  if (!isUnsafe(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin || origin !== configuredOrigin())
    throw new AuthorizationError("Invalid request origin");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (request.method !== "DELETE" && contentType !== "application/json")
    throw new ValidationError("INVALID_CONTENT_TYPE", "Content-Type must be application/json");
}

/** Parses only the small, bounded list contract approved for Phase 3A.3. */
export function parseOffsetPage(query: URLSearchParams): OffsetPage {
  const page = pageSchema.safeParse(query.get("page") ?? "1");
  const pageSize = pageSizeSchema.safeParse(query.get("pageSize") ?? "25");
  if (!page.success || !pageSize.success)
    throw new ValidationError("INVALID_PAGINATION", "Pagination input is invalid");
  return { number: page.data, pageSize: pageSize.data };
}

export function parseOptionalSearch(query: URLSearchParams) {
  const value = query.get("q");
  if (value === null || value.trim() === "") return undefined;
  const parsed = searchSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError("INVALID_SEARCH", "Search input is invalid");
  return parsed.data;
}

export function parseOptionalBoolean(query: URLSearchParams, name: string) {
  const value = query.get(name);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ValidationError("INVALID_FILTER", `${name} must be true or false`);
}

export function parseOptionalUuid(query: URLSearchParams, name: string) {
  const value = query.get(name);
  if (value === null) return undefined;
  if (!uuidSchema.safeParse(value).success)
    throw new ValidationError("INVALID_FILTER", `${name} must be a UUID`);
  return value;
}

export function parseOptionalEnum<const T extends readonly [string, ...string[]]>(
  query: URLSearchParams,
  name: string,
  values: T,
): T[number] | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  if (!(values as readonly string[]).includes(value))
    throw new ValidationError("INVALID_FILTER", `${name} is invalid`);
  return value as T[number];
}

export async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > jsonLimitBytes)
    throw new ValidationError("REQUEST_BODY_TOO_LARGE", "Request body is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > jsonLimitBytes)
    throw new ValidationError("REQUEST_BODY_TOO_LARGE", "Request body is too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("INVALID_JSON", "Request body must be valid JSON");
  }
}

function domainStatus(error: DomainError) {
  if (error instanceof TenantRecordNotFoundError) return 404;
  if (error instanceof TenantResourceNotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (
    [
      "INVALID_JSON",
      "INVALID_CONTENT_TYPE",
      "INVALID_PATH",
      "INVALID_PAGINATION",
      "INVALID_FILTER",
      "INVALID_SEARCH",
      "MISSING_REGISTRATION",
    ].includes(error.code)
  )
    return 400;
  if (error.code === "REQUEST_BODY_TOO_LARGE") return 413;
  if (error instanceof ValidationError) return 422;
  return 422;
}

export function errorResponse(error: unknown, id: string) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred";
  if (error instanceof AuthenticationError) {
    status = 401;
    code = "AUTHENTICATION_REQUIRED";
    message = "Authentication is required";
  } else if (error instanceof AuthorizationError) {
    status = 403;
    code = "PERMISSION_DENIED";
    message = "Access is denied";
  } else if (error instanceof DomainError) {
    status = domainStatus(error);
    code = error.code;
    message = error.message;
  } else if (error instanceof ZodError) {
    status = 400;
    code = "INVALID_REQUEST";
    message = "Request input is invalid";
  }
  return NextResponse.json(
    { error: { code, message, requestId: id } },
    { status, headers: { "x-request-id": id } },
  );
}

export async function tenantRoute<T>(
  request: Request,
  params: { companyId: string },
  operation: (
    context: Awaited<ReturnType<typeof requireTenantContext>>,
    meta: ApiRouteContext,
  ) => Promise<T | ApiResponse<T>>,
) {
  const id = requestId(request);
  const started = Date.now();
  try {
    for (const [name, value] of Object.entries(params)) {
      if (name.endsWith("Id") && !uuidSchema.safeParse(value).success)
        throw new ValidationError("INVALID_PATH", `${name} must be a UUID`);
    }
    assertRequestSecurity(request);
    let context: Awaited<ReturnType<typeof requireTenantContext>>;
    try {
      context = await requireTenantContext(params.companyId);
    } catch (error) {
      // Only a failed Stage 1 membership bootstrap is concealed as tenant-not-found.
      // Capability/record checks happen after this point and remain 403.
      if (error instanceof TenantContextUnavailableError) throw new TenantResourceNotFoundError();
      throw error;
    }
    const result = await operation(context, { companyId: context.companyId, requestId: id });
    const body = isApiResponse<T>(result) ? result.body : result;
    const status = isApiResponse<T>(result) ? result.status : 200;
    console.info(
      JSON.stringify({
        requestId: id,
        method: request.method,
        status,
        durationMs: Date.now() - started,
        actorUserId: context.actorUserId,
        companyId: context.companyId,
      }),
    );
    return NextResponse.json(body, { status, headers: { "x-request-id": id } });
  } catch (error) {
    const response = errorResponse(error, id);
    console.info(
      JSON.stringify({
        requestId: id,
        method: request.method,
        status: response.status,
        durationMs: Date.now() - started,
        errorCode: response.status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
      }),
    );
    return response;
  }
}
