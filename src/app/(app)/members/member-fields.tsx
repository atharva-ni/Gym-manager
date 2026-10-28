import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { options, MEMBER_STATUSES } from "@/lib/constants";
import type { Member } from "@/lib/types";
import { PhoneField } from "@/components/phone-field";
import { PhotoField } from "@/components/photo-field";

/**
 * Member details. Only the essentials are shown up front; everything else
 * sits under "More details" (open when editing an existing member).
 */
export function MemberFields({
  member,
  defaults,
  trainers,
  today,
  photoUrl,
}: {
  member?: Member;
  /** Pre-filled values for a new member (e.g. converted from a lead). */
  defaults?: Pick<Partial<Member>, "full_name" | "phone" | "email" | "notes">;
  trainers: { id: string; full_name: string }[];
  today: string;
  /** Signed link to the member's current photo, when editing. */
  photoUrl?: string | null;
}) {
  const d = member ?? defaults;
  return (
    <>
      <Hidden name="id" value={member?.id} />
      <PhotoField name="photo" currentUrl={photoUrl} />
      <Grid>
        <Field label="Full name" name="full_name" defaultValue={d?.full_name ?? ""} autoComplete="off" required />
        <PhoneField defaultValue={d?.phone} excludeId={member?.id} />
        <SelectField
          label="Gender"
          name="gender"
          placeholder="-"
          defaultValue={member?.gender}
          options={options(["male", "female", "other"])}
        />
        <Field label="Date of birth" name="date_of_birth" type="date" max={today} defaultValue={member?.date_of_birth ?? ""} />
      </Grid>

      <details className="group rounded-lg border border-line" open={!!member}>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">
          More details <span className="text-xs font-normal text-muted">(email, address, emergency contact, medical notes)</span>
        </summary>
        <div className="space-y-4 border-t border-line p-3">
          <Grid>
            <Field label="Email" name="email" type="email" defaultValue={d?.email ?? ""} />
            <Field label="Joined on" name="joined_on" type="date" defaultValue={member?.joined_on ?? today} required />
            <SelectField
              label="Floor trainer"
              name="trainer_id"
              placeholder="None"
              defaultValue={member?.trainer_id}
              options={trainers.map((t) => ({ value: t.id, label: t.full_name }))}
            />
            {member && (
              <SelectField
                label="Status"
                name="status"
                defaultValue={member.status}
                hint="To pause a membership, use Freeze on the plan instead."
                options={options(MEMBER_STATUSES.filter((st) => st !== "frozen" || member.status === "frozen"))}
              />
            )}
            <Field label="Emergency contact" name="emergency_name" defaultValue={member?.emergency_name ?? ""} />
            <Field label="Emergency phone" name="emergency_phone" type="tel" defaultValue={member?.emergency_phone ?? ""} />
          </Grid>
          <TextArea label="Address" name="address" rows={2} defaultValue={member?.address} />
          <TextArea
            label="Medical notes / injuries"
            name="medical_notes"
            rows={2}
            defaultValue={member?.medical_notes}
            placeholder="Allergies, injuries, conditions trainers should know about"
          />
          <TextArea label="Notes" name="notes" rows={2} defaultValue={d?.notes} />
        </div>
      </details>
    </>
  );
}
