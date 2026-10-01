import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AdditionsEditor } from "@/dashboard/products/editor-additions";
import { RulesEditor } from "@/dashboard/products/editor-rules";

test("addition order changes with keyboard-operable controls", () => {
  const change = vi.fn();
  const additions = [
    { id: "a", name: "شیر", priceToman: 1000, available: true, mediaId: null },
    { id: "b", name: "شات", priceToman: 2000, available: true, mediaId: null },
  ];
  render(<AdditionsEditor value={additions} onChange={change} onPickMedia={vi.fn()} />);
  const down = screen.getByRole("button", { name: "انتقال افزودنی 1 به پایین" });
  down.focus();
  fireEvent.click(down);
  expect(change).toHaveBeenCalledWith([additions[1], additions[0]]);
  expect(screen.getByRole("button", { name: "انتقال افزودنی 1 به بالا" })).toBeDisabled();
});

test("stock rule selection fixes the compatible inventory unit", () => {
  const change = vi.fn();
  render(
    <RulesEditor
      value={[{ inventoryItemId: "", quantity: "1", unit: "" }]}
      inventory={[{ id: "a", name: "شیر", unit: "milliliter" }]}
      onChange={change}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "قلم انبار" }), { target: { value: "a" } });
  expect(change).toHaveBeenCalledWith([
    { inventoryItemId: "a", quantity: "1", unit: "milliliter" },
  ]);
});
