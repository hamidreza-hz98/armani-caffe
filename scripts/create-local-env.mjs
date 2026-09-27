import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const template = await readFile(".env.example", "utf8");
const replacements = {
  AUTH_SESSION_SECRET: randomBytes(48).toString("base64url"),
  AUTH_ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url"),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  PRINTER_BRIDGE_TOKEN: randomBytes(48).toString("base64url"),
};

let contents = template;
for (const [name, value] of Object.entries(replacements)) {
  const line = new RegExp(`^${name}=$`, "m");
  if (!line.test(contents)) throw new Error(`Missing empty ${name} placeholder in .env.example`);
  contents = contents.replace(line, `${name}=${value}`);
}

try {
  await writeFile(".env.local", contents, { flag: "wx", mode: 0o600 });
  console.log(
    "Created .env.local with new local-only secrets. Review service settings before use.",
  );
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(".env.local already exists; refusing to overwrite it.");
    process.exitCode = 1;
  } else {
    throw error;
  }
}
