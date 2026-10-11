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

/**
 * Counter sale with its own receipt number (S-00001). "Add to dues" puts the
 * amount on the member's pending fees instead of taking payment now.
 */
export async function recordSale(_: ActionState, fd: FormData): Promise<ActionState> {
  const out = { no: "" };
  const res = await runMutation(async (sb) => {
    const f = parseForm(fd, {
      product_id: "uuid!",
      quantity: "int!",
      unit_price: "number",
      member_id: "uuid",
      method: "text!",
      sold_on: "date!",
      on_credit: "bool",
      due_on: "date",
    });
    if (Number(f.quantity) <= 0) throw new FormError("Quantity must be at least 1");
    if (f.on_credit && !f.member_id) throw new FormError("Pick the member to add this sale to their dues");
    const { data: p, error } = await sb.from("products").select("price").eq("id", f.product_id as string).single();
    if (error) return { error };
    const { data, error: saleErr } = await sb.rpc("pos_sale", {
      p_product_id: f.product_id,
      p_quantity: f.quantity,
      p_unit_price: f.unit_price ?? p.price,
      p_member_id: f.member_id,
      p_method: f.method,
      p_sold_on: f.sold_on,
      p_on_credit: !!f.on_credit,
      p_due_on: f.due_on,
    });
    if (saleErr) return { error: saleErr };
    out.no = data as string;
  });
  return res?.ok ? { ...res, message: `Sale saved. Receipt ${out.no}.` } : res;
}
