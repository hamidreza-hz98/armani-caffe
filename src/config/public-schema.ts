import { EnvironmentReader, type EnvSource } from "./validation.ts";

export type PublicConfig = Readonly<{
  appUrl: string;
  webSocketUrl: string;
}>;

export function readPublicConfig(reader: EnvironmentReader): PublicConfig {
  return {
    appUrl: reader.url("NEXT_PUBLIC_APP_URL", ["http:", "https:"], true),
    webSocketUrl: reader.url("NEXT_PUBLIC_WS_URL", ["ws:", "wss:"]),
  };
}

export function parsePublicConfig(env: EnvSource): PublicConfig {
  const reader = new EnvironmentReader(env);
  const config = readPublicConfig(reader);
  reader.finish();
  return Object.freeze(config);
}
