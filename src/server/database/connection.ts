import "server-only";

import mongoose, { type Connection } from "mongoose";

import { getServerConfig } from "../secrets/config.ts";
import { ConnectionCache } from "./connection-cache.ts";

type GlobalDatabaseCache = typeof globalThis & {
  __armaniDatabaseCache?: { uri: string; cache: ConnectionCache<Connection> };
};

export function getDatabaseConnection(): Promise<Connection> {
  const uri = getServerConfig().mongodbUri;
  const store = globalThis as GlobalDatabaseCache;
  if (store.__armaniDatabaseCache && store.__armaniDatabaseCache.uri !== uri) {
    throw new Error("MongoDB URI changed during this process; restart the process");
  }
  if (!store.__armaniDatabaseCache) {
    store.__armaniDatabaseCache = {
      uri,
      cache: new ConnectionCache(async () => {
        const connection = mongoose.createConnection(uri, {
          autoCreate: false,
          autoIndex: false,
          bufferCommands: false,
          serverSelectionTimeoutMS: 5000,
        });
        try {
          await connection.asPromise();
          return connection;
        } catch (error) {
          await connection.close().catch(() => undefined);
          throw error;
        }
      }),
    };
  }
  return store.__armaniDatabaseCache.cache.get();
}

export async function closeDatabaseConnection(): Promise<void> {
  const store = globalThis as GlobalDatabaseCache;
  const cache = store.__armaniDatabaseCache?.cache;
  if (cache) await cache.close();
  delete store.__armaniDatabaseCache;
}
