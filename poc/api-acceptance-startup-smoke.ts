import { startApiAcceptanceServer } from "./api-acceptance-server";

async function main() {
  const server = await startApiAcceptanceServer({
    // The health endpoint is database-free; this value must never be connected to.
    databaseUrl: "postgresql://unused:unused@127.0.0.1:1/unused",
    port: 3_101,
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    if (!response.ok) throw new Error("API health endpoint did not return success");
    console.log("phase3a3_api_acceptance_startup_smoke: PASS");
  } finally {
    await server.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API startup smoke failed");
  process.exitCode = 1;
});
