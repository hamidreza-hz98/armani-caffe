export type EnvSource = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid application configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigurationError";
  }
}

export class EnvironmentReader {
  readonly issues: string[] = [];
  private readonly env: EnvSource;

  constructor(env: EnvSource) {
    this.env = env;
  }

  text(name: string): string {
    const value = this.env[name]?.trim();
    if (!value) {
      this.issues.push(`${name} is required`);
      return "";
    }
    return value;
  }

  optionalText(name: string): string | undefined {
    return this.env[name]?.trim() || undefined;
  }

  secret(name: string, minLength = 32): string {
    const value = this.text(name);
    if (value && value.length < minLength) {
      this.issues.push(`${name} must contain at least ${minLength} characters`);
    }
    return value;
  }

  hexKey(name: string, optional = false): string | undefined {
    const value = optional ? this.optionalText(name) : this.text(name);
    if (value && !/^[0-9a-fA-F]{64}$/.test(value)) {
      this.issues.push(`${name} must be a 32-byte key encoded as 64 hexadecimal characters`);
    }
    return value?.toLowerCase();
  }

  url(name: string, protocols: readonly string[], originOnly = false): string {
    const value = this.text(name);
    if (!value) return "";
    try {
      const url = new URL(value);
      if (!protocols.includes(url.protocol)) throw new Error("protocol");
      if (url.username || url.password || url.hash || url.search) throw new Error("components");
      if (originOnly && url.pathname !== "/") throw new Error("path");
      return originOnly ? url.origin : url.toString().replace(/\/$/, "");
    } catch {
      this.issues.push(
        `${name} must be a valid ${protocols.map((protocol) => protocol.slice(0, -1)).join("/")} URL${originOnly ? " without a path, query, or fragment" : ""}`,
      );
      return "";
    }
  }

  connectionUrl(name: string, protocols: readonly string[]): string {
    const value = this.text(name);
    if (!value) return "";
    try {
      const url = new URL(value);
      if (!protocols.includes(url.protocol) || !url.hostname) throw new Error("protocol or host");
      return value;
    } catch {
      this.issues.push(
        `${name} must be a valid ${protocols.map((protocol) => protocol.slice(0, -1)).join("/")} connection URL`,
      );
      return "";
    }
  }

  integer(name: string, min: number, max: number, fallback?: number): number {
    const raw = this.optionalText(name);
    if (raw === undefined && fallback !== undefined) return fallback;
    if (raw === undefined || !/^\d+$/.test(raw)) {
      this.issues.push(`${name} must be an integer from ${min} to ${max}`);
      return min;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      this.issues.push(`${name} must be an integer from ${min} to ${max}`);
      return min;
    }
    return value;
  }

  oneOf<const T extends readonly string[]>(name: string, choices: T): T[number] {
    const value = this.text(name);
    if (value && !choices.includes(value)) {
      this.issues.push(`${name} must be one of: ${choices.join(", ")}`);
    }
    return value as T[number];
  }

  finish(): void {
    if (this.issues.length > 0) throw new ConfigurationError(this.issues);
  }
}
