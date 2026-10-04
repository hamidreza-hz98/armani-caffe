import { setTimeout as delay } from "node:timers/promises";

import { MongoClient } from "mongodb";

const uri = "mongodb://127.0.0.1:27018/admin?directConnection=true";
let lastError;
for (let attempt = 0; attempt < 40; attempt++) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1000 });
  try {
    await client.connect();
    const admin = client.db("admin");
    const hello = await admin.command({ hello: 1 });
    if (hello.setName && hello.setName !== "rsowner")
      throw new Error("Unexpected replica-set name on port 27018");
    if (!hello.setName) {
      await admin.command({
        replSetInitiate: { _id: "rsowner", members: [{ _id: 0, host: "127.0.0.1:27018" }] },
      });
    }
    for (let election = 0; election < 40; election++) {
      if ((await admin.command({ hello: 1 })).isWritablePrimary) {
        console.log("Project replica set rsowner is writable.");
        process.exit(0);
      }
      await delay(250);
    }
    throw new Error("Replica-set primary election timed out");
  } catch (error) {
    lastError = error;
    await delay(250);
  } finally {
    await client.close();
  }
}
console.error(`Project MongoDB failed to initialize: ${lastError?.message ?? "unknown error"}`);
process.exitCode = 1;
