import Link from "next/link";
import { PackagePlus, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, money, todayISO } from "@/lib/format";
import { label, options, PAYMENT_METHODS, PRODUCT_CATEGORIES } from "@/lib/constants";
import { getMemberOptions, rangeParams } from "@/lib/queries";
import type { Product, Sale } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap, Tabs } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField } from "@/components/fields";
import { MemberSelect } from "@/components/member-select";
import { DateRangeFilter } from "@/components/date-range";
import { deleteRecord } from "@/app/actions";
import { recordSale, restockProduct, saveProduct } from "./actions";

export const metadata = { title: "Inventory & POS · SetFit Fitness" };

function ProductFields({ p }: { p?: Product }) {
  return (
    <>
      <Hidden name="id" value={p?.id} />
      <Grid>
        <Field label="Product name" name="name" defaultValue={p?.name} required />
        <Field label="SKU / barcode" name="sku" defaultValue={p?.sku ?? ""} />
        <SelectField label="Category" name="category" defaultValue={p?.category ?? "supplement"} options={options(PRODUCT_CATEGORIES)} />
        <Field label="Selling price" name="price" type="number" step="0.01" min={0} defaultValue={p?.price} required />
        <Field label="Unit cost" name="cost" type="number" step="0.01" min={0} defaultValue={p?.cost ?? 0} />
        <Field label={p ? "Stock on hand" : "Opening stock"} name="stock" type="number" defaultValue={p?.stock ?? 0} />
        <Field label="Low-stock alert at" name="low_stock_level" type="number" min={0} defaultValue={p?.low_stock_level ?? 5} />
      </Grid>
      <Checkbox label="Available for sale" name="is_active" defaultChecked={p?.is_active ?? true} />
    </>
  );
}

export default async function InventoryPage(props: PageProps<"/inventory">) {
  const sp = await props.searchParams;
  const tab = sp.tab === "sales" ? "sales" : "products";
  const settings = await getSettings();
  const { currency } = settings;
  const today = todayISO(settings.timezone);
  const { from, to } = rangeParams(sp, today);

  const sb = await createClient();
  const [{ data: productRows }, { data: saleRows }, members] = await Promise.all([
    sb.from("products").select("*").order("name"),
    sb
      .from("sales")
      .select("*, members(full_name)")
      .gte("sold_on", from)
      .lte("sold_on", to)
      .order("sold_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    getMemberOptions(sb),
  ]);
  const products = (productRows ?? []) as Product[];
  const sales = (saleRows ?? []) as Sale[];
  const sellable = products.filter((p) => p.is_active && p.stock > 0);
  const lowStock = products.filter((p) => p.is_active && p.stock <= p.low_stock_level);
  const stockValue = products.reduce((s, p) => s + Math.max(p.stock, 0) * Number(p.cost), 0);
  const salesTotal = sales.reduce((s, x) => s + Number(x.total), 0);
  const profit = sales.reduce((s, x) => s + Number(x.total) - x.quantity * Number(x.unit_cost), 0);

  return (
    <>
      <PageHeader
        title="Inventory & POS"
        description="Track stock of supplements, drinks and merchandise, and ring up sales at the front desk."
        actions={
          <>
            <FormDialog title="New sale" trigger={<><ShoppingCart size={16} /> New sale</>} action={recordSale}>
              {sellable.length ? (
                <>
                  <SelectField
                    label="Product"
                    name="product_id"
                    required
                    placeholder="Select a product"
                    options={sellable.map((p) => ({ value: p.id, label: `${p.name} · ${money(p.price, currency)} (${p.stock} left)` }))}
                  />
                  <Grid>
                    <Field label="Quantity" name="quantity" type="number" min={1} defaultValue={1} required />
                    <Field label="Unit price" name="unit_price" type="number" step="0.01" min={0} placeholder="Product price" hint="Leave blank to use the listed price." />
                    <SelectField label="Method" name="method" defaultValue="cash" options={options(PAYMENT_METHODS)} />
                    <Field label="Date" name="sold_on" type="date" defaultValue={today} required />
                  </Grid>
                  <MemberSelect members={members} label="Member (optional)" />
                </>
              ) : (
                <p className="text-sm text-muted">No products in stock. Add products or restock first.</p>
              )}
            </FormDialog>
            <FormDialog title="New product" trigger={<><Plus size={16} /> Product</>} triggerClass="btn-secondary" action={saveProduct}>
              <ProductFields />
            </FormDialog>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Products" value={products.filter((p) => p.is_active).length} />
        <Stat label="Low stock" value={lowStock.length} tone={lowStock.length ? "warn" : "neutral"} hint={lowStock.slice(0, 2).map((p) => p.name).join(", ") || "All good"} />
        <Stat label="Stock value (cost)" value={money(stockValue, currency)} />
        <Stat label="Sales this period" value={money(salesTotal, currency)} hint={`Profit ${money(profit, currency)}`} />
      </div>

      <Tabs
        current={tab}
        items={[
          { key: "products", label: "Products", href: "/inventory" },
          { key: "sales", label: "Sales", href: `/inventory?tab=sales&from=${from}&to=${to}` },
        ]}
      />

      {tab === "products" ? (
        <Card bodyClass="">
          {!products.length ? (
            <Empty>No products yet.</Empty>
          ) : (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th className="num">Price</th>
                    <th className="num">Cost</th>
                    <th className="num">Margin</th>
                    <th className="num">Stock</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const margin = Number(p.price) > 0 ? ((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100 : 0;
                    return (
                      <tr key={p.id} className={p.is_active ? "" : "opacity-60"}>
                        <td>
                          <p className="font-medium text-ink">{p.name}</p>
                          {p.sku && <p className="text-xs text-muted">{p.sku}</p>}
                        </td>
                        <td>{label(p.category)}</td>
                        <td className="num">{money(p.price, currency)}</td>
                        <td className="num">{money(p.cost, currency)}</td>
                        <td className="num">{margin.toFixed(0)}%</td>
                        <td className="num">
                          {p.stock <= 0 ? (
                            <Badge tone="bad">Out · {p.stock}</Badge>
                          ) : p.stock <= p.low_stock_level ? (
                            <Badge tone="warn">Low · {p.stock}</Badge>
                          ) : (
                            p.stock
                          )}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <FormDialog title={`Restock ${p.name}`} trigger={<PackagePlus size={14} />} triggerClass="btn-ghost btn-sm" action={restockProduct} submitLabel="Add stock">
                              <Hidden name="id" value={p.id} />
                              <Grid>
                                <Field label="Quantity received" name="quantity" type="number" min={1} required />
                                <Field label="Unit cost" name="unit_cost" type="number" step="0.01" min={0} defaultValue={p.cost} />
                                <Field label="Date" name="spent_on" type="date" defaultValue={today} required />
                              </Grid>
                              <Checkbox label="Record the purchase as an expense" name="record_expense" defaultChecked />
                            </FormDialog>
                            <FormDialog title="Edit product" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveProduct}>
                              <ProductFields p={p} />
                            </FormDialog>
                            <ActionButton action={deleteRecord.bind(null, "products", p.id)} confirmLabel="Delete product" confirmText={`Delete ${p.name}? Past sales are kept.`} successMessage="Product deleted">
                              <Trash2 size={14} />
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : (
        <>
          <DateRangeFilter action="/inventory" from={from} to={to}>
            <input type="hidden" name="tab" value="sales" />
          </DateRangeFilter>
          <Card bodyClass="">
            {!sales.length ? (
              <Empty>No sales in this period.</Empty>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Customer</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit price</th>
                      <th>Method</th>
                      <th className="num">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap">{fmtDate(s.sold_on)}</td>
                        <td className="font-medium text-ink">{s.product_name}</td>
                        <td>
                          {s.member_id && s.members ? (
                            <Link href={`/members/${s.member_id}`} className="hover:text-brand">{s.members.full_name}</Link>
                          ) : (
                            <span className="text-muted">Walk-in</span>
                          )}
                        </td>
                        <td className="num">{s.quantity}</td>
                        <td className="num">{money(s.unit_price, currency)}</td>
                        <td>{label(s.method)}</td>
                        <td className="num font-medium text-ink">{money(s.total, currency)}</td>
                        <td>
                          <ActionButton action={deleteRecord.bind(null, "sales", s.id)} confirmLabel="Void sale" confirmText={`Void the sale of ${s.quantity} × ${s.product_name}? Stock will be returned.`} successMessage="Sale voided">
                            <Trash2 size={14} />
                          </ActionButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}
