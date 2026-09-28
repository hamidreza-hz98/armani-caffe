import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import {
  parseCategoryCreate,
  parseCategoryReorder,
  parseCategoryUpdate,
} from "@/modules/catalog/categories/contracts/category";
import { categorySlugBase } from "@/modules/catalog/categories/domain/slug";
import { categorySchema } from "@/modules/catalog/categories/server";

describe("category contracts and slugs", () => {
  it("generates Persian-aware, canonical slugs on the backend", () => {
    expect(categorySlugBase("  قهوهٔ عربی ۱۲۳! ")).toBe("قهوه-عربی-123");
    expect(categorySlugBase("كيك و چاي")).toBe("کیک-و-چای");
    expect(categorySlugBase("Cafe & Tea")).toBe("cafe-tea");
  });
  it("rejects caller slugs, invalid revisions and duplicate reorder IDs", () => {
    expect(() => parseCategoryCreate({ name: "قهوه", slug: "manual" })).toThrow();
    expect(() => parseCategoryUpdate({ revision: 0, sortOrder: 9 })).toThrow();
    const id = new mongoose.Types.ObjectId().toString();
    expect(() => parseCategoryReorder({ revision: 0, ids: [id, id] })).toThrow();
    expect(parseCategoryCreate({ name: "قهوه" })).toMatchObject({ status: "draft", mediaId: null });
  });
  it("schema allows Persian slugs but not unsafe characters", async () => {
    const Category =
      mongoose.models.CategoryContractTest ??
      mongoose.model("CategoryContractTest", categorySchema);
    await expect(
      new Category({ name: "قهوه", slug: "قهوه-2", sortOrder: 0 }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new Category({ name: "قهوه", slug: "قهوه/2", sortOrder: 0 }).validate(),
    ).rejects.toThrow();
  });
});
