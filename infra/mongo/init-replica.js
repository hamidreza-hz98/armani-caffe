const config = { _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] };

try {
  const current = rs.conf();
  if (current._id !== config._id || current.members[0].host !== config.members[0].host) {
    throw new Error("Existing replica-set configuration differs from the local stack.");
  }
  print("Replica set already initialized.");
} catch (error) {
  if (error.codeName !== "NotYetInitialized") throw error;
  rs.initiate(config);
  print("Replica set initiated.");
}

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (db.adminCommand({ hello: 1 }).isWritablePrimary) {
    print("MongoDB is primary and ready for transactions.");
    quit(0);
  }
  sleep(1000);
}

throw new Error("MongoDB did not become primary within 60 seconds.");
