import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const readyTimeoutMs = 20_000;

export type ApiAcceptanceServer = Readonly<{
  baseUrl: string;
  stop: () => Promise<void>;
  logs: () => string;
}>;

export type StartApiAcceptanceServerInput = Readonly<{
  databaseUrl: string;
  port?: number;
  fileStorageAcceptanceFake?: boolean;
}>;

function randomServerSecret() {
  return randomBytes(32).toString("base64url");
}

async function waitForHealth(baseUrl: string, child: ChildProcessWithoutNullStreams) {
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("API server exited before readiness");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The application is still binding its local-only acceptance port.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("API server readiness timed out");
}

async function stopChild(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

/**
 * Runs the production Next.js build on a loopback-only port. The isolated
 * acceptance database runtime role is the only database identity supplied to it.
 */
export async function startApiAcceptanceServer(
  input: StartApiAcceptanceServerInput,
): Promise<ApiAcceptanceServer> {
  const port = input.port ?? 3_100;
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const child = spawn(
    process.execPath,
    [
      ...(input.fileStorageAcceptanceFake
        ? ["--import", "./poc/file-storage-acceptance-preload.ts"]
        : []),
      "./node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: input.databaseUrl,
        APP_URL: baseUrl,
        AUTH_URL: baseUrl,
        NEXTAUTH_URL: baseUrl,
        AUTH_SECRET: process.env.AUTH_SECRET ?? randomServerSecret(),
        OIS_LICENCE_ENCRYPTION_KEY: randomServerSecret(),
        OIS_LICENCE_ENCRYPTION_KEY_VERSION: "acceptance-v1",
        OIS_ODOMETER_CONFIRMATION_KEY: randomServerSecret(),
        ...(input.fileStorageAcceptanceFake ? { OIS_FILE_STORAGE_ACCEPTANCE_FAKE: "true" } : {}),
      },
      stdio: "pipe",
    },
  );
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  try {
    await waitForHealth(baseUrl, child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { baseUrl, stop: () => stopChild(child), logs: () => output.join("") };
}
