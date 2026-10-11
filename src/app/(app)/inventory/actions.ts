"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      name: "text!",
      sku: "text",
      category: "text!",
      price: "number!",
      cost: "number",
      stock: "int",
      low_stock_level: "int",
      is_active: "bool",
    });
    row.cost ??= 0;
    row.stock ??= 0;
    row.low_stock_level ??= 5;
    return saveRow(sb, "products", fd.get("id"), row);
  });
}

/** Add stock; optionally book the purchase as a "supplies" expense. */
export async function restockProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const f = parseForm(fd, { quantity: "int!", unit_cost: "number", record_expense: "bool", spent_on: "date!" });
    const qty = Number(f.quantity);
    if (qty <= 0) throw new FormError("Quantity must be at least 1");
    const id = String(fd.get("id"));
    const { data: p, error } = await sb.from("products").select("name, stock, cost").eq("id", id).single();
    if (error) return { error };
    const unitCost = f.unit_cost !== null ? Number(f.unit_cost) : Number(p.cost);
    const upd = await sb.from("products").update({ stock: p.stock + qty, cost: unitCost }).eq("id", id);
    if (upd.error) return upd;
    if (f.record_expense && unitCost > 0) {
      return sb.from("expenses").insert({
        category: "supplies",
        amount: unitCost * qty,
        spent_on: f.spent_on,
        description: `Restock: ${qty} × ${p.name}`,
      });
    }
  });
}

export async function recordSale(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const f = parseForm(fd, {
      product_id: "uuid!",
      quantity: "int!",
      unit_price: "number",
      member_id: "uuid",
      method: "text!",
      sold_on: "date!",
    });
    if (Number(f.quantity) <= 0) throw new FormError("Quantity must be at least 1");
    const { data: p, error } = await sb.from("products").select("name, price, cost, stock").eq("id", f.product_id as string).single();
    if (error) return { error };
    if (p.stock < Number(f.quantity)) throw new FormError(`Only ${p.stock} of ${p.name} in stock`);
    return sb.from("sales").insert({
      product_id: f.product_id,
      product_name: p.name,
      member_id: f.member_id,
      quantity: f.quantity,
      unit_price: f.unit_price ?? p.price,
      unit_cost: p.cost,
      method: f.method,
      sold_on: f.sold_on,
    });
  });
}
