const client = db.getMongo();
const session = client.startSession();
const collection = session.getDatabase("armani_caffe").getCollection("_infra_smoke");
const id = "transaction-check";

try {
  await session.withTransaction(async () => {
    await collection.replaceOne({ _id: id }, { _id: id, passed: true }, { upsert: true });
  });
  if ((await collection.findOne({ _id: id }))?.passed !== true) {
    throw new Error("Transaction did not commit the expected document.");
  }
  print("MongoDB transaction committed successfully.");
} finally {
  await collection.deleteOne({ _id: id });
  await session.endSession();
}
