import { readPublicConfig } from "./public-schema.ts";
import { EnvironmentReader, type EnvSource } from "./validation.ts";

export type NodeMode = "development" | "production" | "test";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

export type ServerConfig = Readonly<{
  mode: NodeMode;
  public: ReturnType<typeof readPublicConfig>;
  appUrl: string;
  adminUrl: string;
  mongodbUri: string;
  redisUrl: string;
  minio: Readonly<{
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  }>;
  auth: Readonly<{
    sessionSecret: string;
    adminSessionSecret: string;
  }>;
  sms: Readonly<{
    apiKey?: string;
    loginTemplateId?: number;
    signupTemplateId?: number;
    codeParameter: string;
  }>;
  encryption: Readonly<{
    key: string;
    previousKey?: string;
  }>;
  paymentCallbackBaseUrl: string;
  webSocket: Readonly<{
    port: number;
    path: string;
    heartbeatMs: number;
  }>;
  printerBridge: Readonly<{
    id: string;
    token: string;
  }>;
  logLevel: LogLevel;
  logFormat: LogFormat;
  test: Readonly<{ fixedTime: string; randomSeed: number }> | null;
}>;

export function parseServerConfig(env: EnvSource, mode: NodeMode): ServerConfig {
  const reader = new EnvironmentReader(env);
  const publicConfig = readPublicConfig(reader);
  const appUrl = reader.url("APP_URL", ["http:", "https:"], true);
  const adminUrl = reader.url("ADMIN_URL", ["http:", "https:"], true);
  const mongodbUri = reader.connectionUrl("MONGODB_URI", ["mongodb:", "mongodb+srv:"]);
  const redisUrl = reader.connectionUrl("REDIS_URL", ["redis:", "rediss:"]);
  const endpoint = reader.url("MINIO_ENDPOINT", ["http:", "https:"], true);
  const region = reader.text("MINIO_REGION");
  const bucket = reader.text("MINIO_BUCKET");
  if (
    bucket &&
    !/^(?!.*\.\.)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
  ) {
    reader.issues.push("MINIO_BUCKET must be a valid S3 bucket name (3-63 lowercase characters)");
  }
  const accessKey = reader.text("MINIO_ACCESS_KEY");
  const secretKey = reader.text("MINIO_SECRET_KEY");
  const sessionSecret = reader.secret("AUTH_SESSION_SECRET");
  const adminSessionSecret = reader.secret("AUTH_ADMIN_SESSION_SECRET");
  const smsApiKey = reader.optionalText("SMSIR_API_KEY");
  const loginTemplate = reader.optionalText("SMSIR_LOGIN_TEMPLATE_ID");
  const signupTemplate = reader.optionalText("SMSIR_SIGNUP_TEMPLATE_ID");
  const codeParameter = reader.optionalText("SMSIR_CODE_PARAMETER") ?? "CODE";
  for (const [name, value] of [
    ["SMSIR_LOGIN_TEMPLATE_ID", loginTemplate],
    ["SMSIR_SIGNUP_TEMPLATE_ID", signupTemplate],
  ] as const) {
    if (
      value &&
      (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    )
      reader.issues.push(`${name} must be a positive integer`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(codeParameter))
    reader.issues.push("SMSIR_CODE_PARAMETER must be a template parameter name");
  if (
    [smsApiKey, loginTemplate, signupTemplate].some(Boolean) &&
    ![smsApiKey, loginTemplate, signupTemplate].every(Boolean)
  )
    reader.issues.push("SMS.ir requires API key and both template IDs together");
  if (sessionSecret && sessionSecret === adminSessionSecret) {
    reader.issues.push("AUTH_SESSION_SECRET and AUTH_ADMIN_SESSION_SECRET must differ");
  }
  const key = reader.hexKey("ENCRYPTION_KEY") ?? "";
  const previousKey = reader.hexKey("ENCRYPTION_KEY_PREVIOUS", true);
  if (key && previousKey === key) {
    reader.issues.push("ENCRYPTION_KEY_PREVIOUS must differ from ENCRYPTION_KEY");
  }
  const paymentCallbackBaseUrl = reader.url("PAYMENT_CALLBACK_BASE_URL", ["http:", "https:"], true);
  const port = reader.integer("WEBSOCKET_PORT", 1, 65535);
  const webSocketPath = reader.text("WEBSOCKET_PATH");
  if (webSocketPath && (!webSocketPath.startsWith("/") || /[?#]/.test(webSocketPath))) {
    reader.issues.push("WEBSOCKET_PATH must start with / and contain no query or fragment");
  }
  const heartbeatMs = reader.integer("WEBSOCKET_HEARTBEAT_MS", 1000, 60000);
  const printerId = reader.text("PRINTER_BRIDGE_ID");
  if (printerId && !/^[a-zA-Z0-9_-]{3,64}$/.test(printerId)) {
    reader.issues.push("PRINTER_BRIDGE_ID must contain 3-64 letters, digits, _ or -");
  }
  const printerToken = reader.secret("PRINTER_BRIDGE_TOKEN");
  const logLevel = reader.oneOf("LOG_LEVEL", ["debug", "info", "warn", "error"] as const);
  const logFormat = reader.oneOf("LOG_FORMAT", ["pretty", "json"] as const);

  let test: ServerConfig["test"] = null;
  if (mode === "test") {
    const fixedTime = reader.optionalText("TEST_FIXED_TIME") ?? "2025-01-01T00:00:00.000Z";
    if (
      !Number.isFinite(Date.parse(fixedTime)) ||
      new Date(fixedTime).toISOString() !== fixedTime
    ) {
      reader.issues.push("TEST_FIXED_TIME must be an ISO-8601 UTC timestamp with milliseconds");
    }
    test = {
      fixedTime,
      randomSeed: reader.integer("TEST_RANDOM_SEED", 0, 2147483647, 42),
    };
  } else if (reader.optionalText("TEST_FIXED_TIME") || reader.optionalText("TEST_RANDOM_SEED")) {
    reader.issues.push("TEST_FIXED_TIME and TEST_RANDOM_SEED are allowed only in test mode");
  }

  reader.finish();
  return Object.freeze({
    mode,
    public: Object.freeze(publicConfig),
    appUrl,
    adminUrl,
    mongodbUri,
    redisUrl,
    minio: Object.freeze({ endpoint, region, bucket, accessKey, secretKey }),
    auth: Object.freeze({ sessionSecret, adminSessionSecret }),
    sms: Object.freeze({
      apiKey: smsApiKey,
      loginTemplateId: loginTemplate ? Number(loginTemplate) : undefined,
      signupTemplateId: signupTemplate ? Number(signupTemplate) : undefined,
      codeParameter,
    }),
    encryption: Object.freeze({ key, previousKey }),
    paymentCallbackBaseUrl,
    webSocket: Object.freeze({ port, path: webSocketPath, heartbeatMs }),
    printerBridge: Object.freeze({ id: printerId, token: printerToken }),
    logLevel,
    logFormat,
    test: test && Object.freeze(test),
  });
}
