"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

/** Book a member into a class on a date (capacity is checked in the database). */
export async function bookClass(classId: string, classDate: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runMutation((sb) => {
    const f = parseForm(fd, { member_id: "uuid!" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate)) throw new FormError("Invalid class date");
    return sb.rpc("book_class", { p_class_id: classId, p_member_id: f.member_id, p_date: classDate });
  });
  return res?.ok ? { ...res, message: "Booked" } : res;
}

export async function setBookingStatus(bookingId: string, status: "attended" | "cancelled" | "no_show" | "booked"): Promise<ActionState> {
  const res = await runMutation((sb) => sb.from("class_bookings").update({ status }).eq("id", bookingId));
  return res?.ok ? { ...res, message: status === "attended" ? "Marked attended" : status === "cancelled" ? "Booking cancelled" : "Updated" } : res;
}
