import "server-only";

// Realtime transports register their close functions with the lifecycle registry when started.
export async function closeRealtimeResources(): Promise<void> {}
