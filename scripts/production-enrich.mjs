import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import sharp from "sharp";

import { additionsFor, categoryArtwork, recipes, stock } from "./production-enrichment-data.mjs";

const apply = process.argv.includes("--apply");
const mediaDirectory = path.resolve(process.env.CATALOG_MEDIA_DIR ?? "../catalog-media");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const id = (value) =>
  new mongoose.Types.ObjectId(sha(`armani-production-enrichment-v1:${value}`).slice(0, 24));
const stamp = (date) => ({ createdAt: date, updatedAt: date, __v: 0 });
const menu = JSON.parse(await readFile("data/catalog.production.json", "utf8"));
const allProducts = menu.categories.flatMap((category) => category.products);
if (menu.categories.length !== 13 || allProducts.length !== 84 || categoryArtwork.length !== 13)
  throw new Error("Unexpected source menu size");
if (
  new Set(allProducts.map((p) => p.name)).size !== 84 ||
  allProducts.some((p) => !recipes[p.name]) ||
  Object.keys(recipes).length !== 84
)
  throw new Error("Every product must have one exact recipe");
for (const [name, recipe] of Object.entries(recipes)) {
  const keys = new Set();
  for (const part of recipe.split(",")) {
    const [sku, raw] = part.split(":");
    if (!stock[sku] || keys.has(sku) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)
      throw new Error(`Invalid recipe for ${name}: ${part}`);
    keys.add(sku);
  }
}
for (const [sku, [name, unit, initial, reorder]] of Object.entries(stock)) {
  if (
    !name ||
    !["gram", "milliliter", "piece"].includes(unit) ||
    !Number.isSafeInteger(initial) ||
    initial < 1 ||
    !Number.isSafeInteger(reorder) ||
    reorder < 0 ||
    reorder >= initial
  )
    throw new Error(`Invalid stock item ${sku}`);
}

process.loadEnvFile(".env");
if (new URL(process.env.APP_URL).hostname !== "cafe-armani.ir")
  throw new Error("Refusing to use a different APP_URL");
const connection = await mongoose
  .createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    bufferCommands: false,
  })
  .asPromise();
const db = connection.db;
const collections = [
  "categories",
  "products",
  "product_additions",
  "inventory_items",
  "inventory_movements",
  "product_consumption_rules",
  "media_assets",
  "media_references",
  "settings",
];
const collection = (name) => db.collection(name);
const oid = (value) => String(value);
const now = new Date();
try {
  const [
    categories,
    products,
    additions,
    items,
    rules,
    assets,
    references,
    settings,
    owners,
  ] = await Promise.all([
    collection("categories").find({ deletedAt: null }).toArray(),
    collection("products").find({ deletedAt: null }).toArray(),
    collection("product_additions").find({}).toArray(),
    collection("inventory_items").find({}).toArray(),
    collection("product_consumption_rules").find({}).toArray(),
    collection("media_assets").find({}).toArray(),
    collection("media_references").find({}).toArray(),
    collection("settings").find({}).toArray(),
    collection("admins")
      .find({ role: "OWNER", status: "active" }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  if (categories.length !== 13 || products.length !== 84 || owners.length < 1)
    throw new Error("Production catalog or active owner does not match the expected baseline");
  const categoryByName = new Map(categories.map((row) => [row.name, row]));
  const productByName = new Map(products.map((row) => [row.name, row]));
  if (
    categoryByName.size !== 13 ||
    productByName.size !== 84 ||
    menu.categories.some((c) => !categoryByName.has(c.name)) ||
    allProducts.some((p) => !productByName.has(p.name))
  )
    throw new Error("Production menu names differ from the source manifest");
  const ownerId = owners[0]._id;
  const itemByName = new Map(items.map((row) => [row.name, row]));
  const newItems = [];
  const newMovements = [];
  for (const [sku, [name, unit, initial, reorderLevel]] of Object.entries(stock)) {
    let item = itemByName.get(name);
    if (item && item.unit !== unit) throw new Error(`Unit conflict for ${name}`);
    if (!item) {
      item = {
        _id: id(`stock:${sku}`),
        name,
        unit,
        onHand: initial,
        reorderLevel,
        status: "active",
        ...stamp(now),
      };
      newItems.push(item);
      itemByName.set(name, item);
      newMovements.push({
        _id: id(`movement:${sku}`),
        inventoryItemId: item._id,
        delta: initial,
        reason: "initial",
        before: 0,
        after: initial,
        unit,
        reversalOf: null,
        requestId: null,
        orderId: null,
        actorKind: "admin",
        actorId: ownerId,
        idempotencyKey: `production-initial-stock-v1:${sku}`,
        fingerprint: sha(JSON.stringify({ sku, initial, unit })),
        ...stamp(now),
      });
    }
  }
  const ruleKeys = new Set(rules.map((row) => `${oid(row.productId)}:${oid(row.inventoryItemId)}`));
  const newRules = [];
  for (const product of allProducts) {
    const row = productByName.get(product.name);
    for (const part of recipes[product.name].split(",")) {
      const [sku, raw] = part.split(":");
      const item = itemByName.get(stock[sku][0]);
      const key = `${oid(row._id)}:${oid(item._id)}`;
      if (!ruleKeys.has(key)) {
        newRules.push({
          _id: id(`rule:${product.name}:${sku}`),
          productId: row._id,
          inventoryItemId: item._id,
          quantityPerUnit: Number(raw),
          active: true,
          ...stamp(now),
        });
        ruleKeys.add(key);
      }
    }
  }
  const additionKeys = new Set(additions.map((row) => `${oid(row.productId)}:${row.name}`));
  const newAdditions = [];
  menu.categories.forEach((category, index) => {
    for (const product of category.products) {
      const row = productByName.get(product.name);
      additionsFor(index, product.name).forEach(([name, priceToman], sortOrder) => {
        const key = `${oid(row._id)}:${name}`;
        if (!additionKeys.has(key)) {
          newAdditions.push({
            _id: id(`addition:${product.name}:${name}`),
            productId: row._id,
            mediaId: null,
            name,
            priceToman,
            available: true,
            sortOrder,
            ...stamp(now),
          });
          additionKeys.add(key);
        }
      });
    }
  });
  const mediaByKey = new Map(assets.map((row) => [row.initiationKey, row]));
  const newMedia = [];
  const mediaLinks = [];
  const uploads = [];
  for (let index = 0; index < menu.categories.length; index++) {
    const category = categoryByName.get(menu.categories[index].name);
    if (category.mediaId) continue;
    const artwork = categoryArtwork[index];
    const filename = `${artwork}.webp`;
    const bytes = await readFile(path.join(mediaDirectory, "categories", filename));
    const originalHash = sha(bytes);
    const imageId = id(`category-media:${artwork}`);
    const initiationKey = `production-category-art-v1:${artwork}`;
    const existing = mediaByKey.get(initiationKey);
    if (existing) {
      mediaLinks.push({ categoryId: category._id, mediaId: existing._id });
      continue;
    }
    const versionHex = sha(`category-art-version:${artwork}`);
    const objectVersion = `${versionHex.slice(0, 8)}-${versionHex.slice(8, 12)}-${versionHex.slice(12, 16)}-${versionHex.slice(16, 20)}-${versionHex.slice(20, 32)}`;
    const small = await sharp(bytes).resize(320, 320).webp({ quality: 80 }).toBuffer();
    const variants = [
      ["original", bytes, 1024],
      ["small", small, 320],
      ["large", bytes, 1024],
    ].map(([variant, content, width]) => {
      const hash = sha(content);
      const key = `media/v1/${oid(ownerId)}/${objectVersion}/${hash}-${variant}.webp`;
      uploads.push({ key, bytes: content });
      return {
        key,
        variant,
        byteSize: content.length,
        sha256: hash,
        mimeType: "image/webp",
        width,
        height: width,
      };
    });
    newMedia.push({
      _id: imageId,
      objectKey: variants[0].key,
      bucket: process.env.MINIO_BUCKET,
      mimeType: "image/webp",
      byteSize: bytes.length,
      sha256: originalHash,
      filename,
      objectVersion,
      title: category.name,
      altText: `تصویر دسته ${category.name}`,
      caption: "",
      seo: {
        title: category.name,
        description: `دسته ${category.name} در منوی آرمانی کافه`,
        keywords: [],
      },
      visibility: "public",
      width: 1024,
      height: 1024,
      variants,
      uploaderId: ownerId,
      ownerId,
      initiationKey,
      fingerprint: originalHash,
      ticketCiphertext: "production-seed-ready-asset",
      stagingKey: `seed/category/${artwork}`,
      expiresAt: now,
      referenceGuard: 1,
      status: "ready",
      deletedAt: null,
      ...stamp(now),
    });
    mediaLinks.push({ categoryId: category._id, mediaId: imageId });
  }
  const referenceKeys = new Set(
    references.map((row) => `${oid(row.entityId)}:${oid(row.mediaId)}`),
  );
  const newReferences = mediaLinks
    .filter(({ categoryId, mediaId }) => !referenceKeys.has(`${oid(categoryId)}:${oid(mediaId)}`))
    .map(({ categoryId, mediaId }) => ({
      _id: id(`category-reference:${oid(categoryId)}:${oid(mediaId)}`),
      mediaId,
      entityKind: "category",
      entityId: categoryId,
      field: "mediaId",
      ...stamp(now),
    }));
  const settingByKind = new Map(settings.map((row) => [row.kind, row]));
  const business = settingByKind.get("business");
  const businessDescription =
    "قهوه، نوشیدنی، صبحانه و دسر تازه در آرمانی کافه؛ سفارش آنلاین از منوی کامل کافه.";
  const businessUpdate =
    business && !business.values?.description
      ? {
          ...business.values,
          description: businessDescription,
        }
      : null;
  const defaults = {
    business: {
      title: "آرمانی کافه",
      legalName: "",
      description: businessDescription,
      currency: "TOMAN",
      timezone: "Asia/Tehran",
      minimumOrderToman: 0,
      logoMediaId: null,
      faviconMediaId: null,
    },
    contact: {
      phone: "",
      email: "",
      address: "",
      instagramUrl: "",
      telegramUrl: "",
      mapProvider: "none",
      latitude: null,
      longitude: null,
    },
    seo: {
      title: "آرمانی کافه | منوی آنلاین و سفارش",
      description: businessDescription,
      titleTemplate: "%s | آرمانی کافه",
      indexable: true,
    },
    payment: {
      defaultProvider: null,
      fakeEnabled: false,
      fakePriority: 0,
      gatewayEnabled: false,
      gatewayPriority: 1,
      gatewayMode: "sandbox",
    },
    printing: {
      enabled: false,
      bridgeId: "",
      paperWidthMm: 80,
      copies: 1,
      automaticPrint: false,
      footer: "از همراهی شما سپاسگزاریم — آرمانی کافه",
    },
  };
  const newSettings = Object.entries(defaults)
    .filter(([kind]) => !settingByKind.has(kind))
    .map(([kind, values]) => ({
      _id: id(`settings:${kind}`),
      kind,
      revision: 1,
      values,
      encryptedPayload: null,
      formatVersion: 1,
      credentialConfigured: false,
      encryptionKeyId: null,
      encryptedAt: null,
      ...stamp(now),
    }));
  const summary = {
    existing: {
      categories: categories.length,
      products: products.length,
      additions: additions.length,
      inventoryItems: items.length,
      rules: rules.length,
      settings: settings.map((s) => s.kind),
    },
    create: {
      categoryMedia: newMedia.length,
      categoryLinks: mediaLinks.length,
      additions: newAdditions.length,
      inventoryItems: newItems.length,
      initialMovements: newMovements.length,
      consumptionRules: newRules.length,
      settings: newSettings.map((s) => s.kind),
      businessDescription: Boolean(businessUpdate),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) process.exit(0);

  const backupDir = path.join(
    "data",
    "production-backups",
    now.toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(backupDir, { recursive: true });
  for (const name of collections) {
    const rows = await collection(name).find({}).toArray();
    await writeFile(
      path.join(backupDir, `${name}.ejson`),
      mongoose.mongo.BSON.EJSON.stringify(rows, { relaxed: false }),
      { flag: "wx" },
    );
  }
  console.log(`Backup written to ${backupDir}`);
  if (uploads.length) {
    const s3 = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY,
      },
    });
    try {
      for (const { key, bytes } of uploads) {
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.MINIO_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: "image/webp",
            CacheControl: "private, max-age=31536000, immutable",
          }),
        );
      }
    } finally {
      s3.destroy();
    }
  }
  await connection.transaction(
    async (session) => {
      const insert = async (name, rows) => {
        if (rows.length) await collection(name).insertMany(rows, { session, ordered: true });
      };
      await insert("media_assets", newMedia);
      await insert("media_references", newReferences);
      for (const { categoryId, mediaId } of mediaLinks) {
        await collection("categories").updateOne(
          { _id: categoryId, mediaId: null },
          { $set: { mediaId, updatedAt: now }, $inc: { __v: 1 } },
          { session },
        );
      }
      await insert("inventory_items", newItems);
      await insert("inventory_movements", newMovements);
      await insert("product_consumption_rules", newRules);
      await insert("product_additions", newAdditions);
      await insert("settings", newSettings);
      if (businessUpdate)
        await collection("settings").updateOne(
          { _id: business._id, revision: business.revision },
          { $set: { values: businessUpdate, updatedAt: now }, $inc: { revision: 1, __v: 1 } },
          { session },
        );
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 },
  );
  console.log("Production enrichment committed.");
} finally {
  await connection.close();
}
