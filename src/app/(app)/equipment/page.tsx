import { History, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, fmtDate, money, todayISO } from "@/lib/format";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, label, options } from "@/lib/constants";
import type { Equipment, EquipmentService } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { ActionButton, FormDialog, ViewDialog } from "@/components/forms";
import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { deleteRecord } from "@/app/actions";
import { logService, saveEquipment } from "./actions";

export const metadata = { title: "Equipment · SetFit Fitness" };

function EquipmentFields({ e }: { e?: Equipment }) {
  return (
    <>
      <Hidden name="id" value={e?.id} />
      <Grid>
        <Field label="Name" name="name" defaultValue={e?.name} placeholder="Treadmill T5" required />
        <SelectField label="Category" name="category" defaultValue={e?.category ?? "cardio"} options={options(EQUIPMENT_CATEGORIES)} />
        <Field label="Brand / model" name="brand" defaultValue={e?.brand ?? ""} />
        <Field label="Serial no." name="serial_no" defaultValue={e?.serial_no ?? ""} />
        <Field label="Quantity" name="quantity" type="number" min={1} defaultValue={e?.quantity ?? 1} required />
        <SelectField label="Condition" name="status" defaultValue={e?.status ?? "working"} options={options(EQUIPMENT_STATUSES)} />
        <Field label="Purchase date" name="purchase_date" type="date" defaultValue={e?.purchase_date ?? ""} />
        <Field label="Purchase cost" name="purchase_cost" type="number" step="0.01" min={0} defaultValue={e?.purchase_cost ?? 0} />
        <Field label="Last service" name="last_service" type="date" defaultValue={e?.last_service ?? ""} />
        <Field label="Next service due" name="next_service" type="date" defaultValue={e?.next_service ?? ""} />
      </Grid>
      <TextArea label="Notes" name="notes" rows={2} defaultValue={e?.notes} />
    </>
  );
}

export default async function EquipmentPage() {
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const soon = addDays(today, 7);
  const sb = await createClient();
  const [{ data }, { data: serviceRows }] = await Promise.all([
    sb.from("equipment").select("*").order("status").order("name"),
    sb.from("equipment_services").select("*").order("serviced_on", { ascending: false }).limit(2000),
  ]);
  const services = (serviceRows ?? []) as EquipmentService[];
  const servicesOf = (id: string) => services.filter((x) => x.equipment_id === id);
  const items = (data ?? []) as Equipment[];
  const inUse = items.filter((e) => e.status !== "retired");
  const attention = inUse.filter(
    (e) => e.status === "needs_service" || e.status === "out_of_order" || (e.next_service && e.next_service <= soon),
  );
  const value = inUse.reduce((s, e) => s + Number(e.purchase_cost), 0);

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Asset register and maintenance schedule."
        actions={
          <FormDialog title="Add equipment" trigger={<><Plus size={16} /> Add equipment</>} action={saveEquipment} wide>
            <EquipmentFields />
          </FormDialog>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Machines & items" value={inUse.reduce((s, e) => s + e.quantity, 0)} hint={`${inUse.length} line items`} />
        <Stat label="Needs attention" value={attention.length} tone={attention.length ? "warn" : "neutral"} hint="Faulty or service due within 7 days" />
        <Stat label="Out of order" value={inUse.filter((e) => e.status === "out_of_order").length} tone="bad" />
        <Stat label="Asset value" value={money(value, settings.currency)} hint="At purchase cost" />
      </div>
      <Card bodyClass="">
        {!items.length ? (
          <Empty>No equipment registered.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">Qty</th>
                  <th>Condition</th>
                  <th>Last service</th>
                  <th>Next service</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className={e.status === "retired" ? "opacity-60" : ""}>
                    <td>
                      <p className="font-medium text-ink">{e.name}</p>
                      <p className="text-xs text-muted">{[e.brand, e.serial_no].filter(Boolean).join(" · ") || "-"}</p>
                    </td>
                    <td>{label(e.category)}</td>
                    <td className="num">{e.quantity}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>{fmtDate(e.last_service)}</td>
                    <td>
                      {e.next_service ? (
                        e.next_service < today ? (
                          <Badge tone="bad">Overdue · {fmtDate(e.next_service)}</Badge>
                        ) : e.next_service <= soon ? (
                          <Badge tone="warn">Due {fmtDate(e.next_service)}</Badge>
                        ) : (
                          fmtDate(e.next_service)
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {servicesOf(e.id).length > 0 && (
                          <ViewDialog title={`Service history: ${e.name}`} trigger={<History size={14} />}>
                            <ul className="divide-y divide-line text-sm">
                              {servicesOf(e.id).map((x) => (
                                <li key={x.id} className="flex items-start justify-between gap-3 py-2">
                                  <span>
                                    {fmtDate(x.serviced_on)}
                                    {x.notes && <span className="block text-xs text-muted">{x.notes}</span>}
                                    {x.next_service && <span className="block text-xs text-muted">Next due {fmtDate(x.next_service)}</span>}
                                  </span>
                                  <span className="tabular-nums text-ink">{Number(x.cost) > 0 ? money(x.cost, settings.currency) : "No cost"}</span>
                                </li>
                              ))}
                            </ul>
                          </ViewDialog>
                        )}
                        <FormDialog title={`Log service: ${e.name}`} trigger={<Wrench size={14} />} triggerClass="btn-ghost btn-sm" action={logService} submitLabel="Log service">
                          <Hidden name="id" value={e.id} />
                          <Grid>
                            <Field label="Serviced on" name="serviced_on" type="date" defaultValue={today} required />
                            <Field label="Next service due" name="next_service" type="date" defaultValue={addDays(today, 90)} />
                            <Field label="Cost" name="cost" type="number" step="0.01" min={0} hint="Booked as a maintenance expense." />
                            <Field label="Work done" name="notes" />
                          </Grid>
                        </FormDialog>
                        <FormDialog title="Edit equipment" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveEquipment} wide>
                          <EquipmentFields e={e} />
                        </FormDialog>
                        <ActionButton action={deleteRecord.bind(null, "equipment", e.id)} confirmLabel="Delete equipment" confirmText={`Delete ${e.name} from the register?`} successMessage="Equipment deleted">
                          <Trash2 size={14} />
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
