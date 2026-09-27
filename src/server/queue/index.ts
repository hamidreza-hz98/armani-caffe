import "server-only";

// Queue producers and consumers belong in this server-only boundary.

// Queue adapters register their close functions with the lifecycle registry when started.
export async function closeQueueResources(): Promise<void> {}
