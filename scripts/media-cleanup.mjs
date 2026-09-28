if (!process.argv.includes("--apply"))
  throw new Error("Media cleanup changes database/storage; pass --apply explicitly");
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.env.NODE_ENV ??= "development";
const { createMediaService } = await import("../src/modules/media/server.ts");
const { installShutdownHandlers, shutdownResources } =
  await import("../src/server/lifecycle/index.ts");
installShutdownHandlers();
try {
  const result = await (await createMediaService()).cleanup();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} finally {
  if (!(await shutdownResources())) process.exitCode = 1;
}
