export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerConfig } = await import("@/server/secrets/config");
    getServerConfig();
  }
}
