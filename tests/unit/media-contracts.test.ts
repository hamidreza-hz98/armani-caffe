import { expect, test } from "vitest";

import {
  idempotencyKey,
  mediaId,
  parseInitiation,
  parseMediaList,
  parseMetadata,
} from "../../src/modules/media/index.ts";

const metadata = {
  title: "قهوه",
  altText: "فنجان",
  caption: "",
  visibility: "private",
  seo: { title: "", description: "", keywords: ["قهوه", "قهوه"] },
};
test("metadata is bounded plain text with normalized keywords and no hidden fields", () => {
  expect(parseMetadata(metadata).seo.keywords).toEqual(["قهوه"]);
  for (const value of [
    { ...metadata, title: " " },
    { ...metadata, caption: "<img src=x>" },
    { ...metadata, altText: "a".repeat(201) },
    { ...metadata, visibility: "everyone" },
    { ...metadata, ownerId: "injected" },
    { ...metadata, seo: { ...metadata.seo, keywords: Array(11).fill("too many") } },
    { ...metadata, seo: { ...metadata.seo, canonicalUrl: "javascript:alert(1)" } },
  ])
    expect(() => parseMetadata(value)).toThrow();
});
test("upload initiation validates filename, MIME, size and strict keys", () => {
  const value = { filename: "قهوه.jpg", byteSize: 100, mimeType: "image/jpeg", metadata };
  expect(parseInitiation(value).filename).toBe("قهوه.jpg");
  for (const input of [
    { ...value, filename: "../a.jpg" },
    { ...value, filename: "C:\\a.jpg" },
    { ...value, mimeType: "image/svg+xml" },
    { ...value, byteSize: "100" },
    { ...value, objectKey: "external" },
  ])
    expect(() => parseInitiation(input)).toThrow();
});
test("list queries reject arbitrary sorts, operators, deep pagination and repeated fields", () => {
  expect(parseMediaList(new URLSearchParams("q=قهوه&sort=title&direction=asc")).filters.q).toBe(
    "قهوه",
  );
  for (const query of [
    "sort=objectKey",
    "q=",
    "page=100000",
    "pageSize=101",
    "status=unknown",
    "visibility=everyone",
    "uploaderId[$ne]=x",
    "sort=title&sort=createdAt",
    "q=%3Cscript%3E",
  ])
    expect(() => parseMediaList(new URLSearchParams(query))).toThrow();
});
test("IDs and idempotency keys cannot carry database operators or paths", () => {
  expect(mediaId("000000000000000000000001")).toBe("000000000000000000000001");
  for (const input of [null, { $ne: null }, "../secret", "short"]) {
    expect(() => mediaId(input)).toThrow();
    expect(() => idempotencyKey(input)).toThrow();
  }
});
