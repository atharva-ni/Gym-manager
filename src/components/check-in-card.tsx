"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { LogIn } from "lucide-react";
import { memberStatus, type MemberStatus } from "@/app/actions";
import { fmtDate, money } from "@/lib/format";
import { MemberSelect } from "@/components/member-select";
import { Avatar } from "@/components/ui";
import { toast } from "@/components/toaster";
import type { ActionState } from "@/lib/types";

const STATE_TEXT: Record<MemberStatus["state"], { text: (s: MemberStatus) => string; tone: string; blocks: boolean }> = {
  active: { text: (s) => `Active till ${fmtDate(s.membership_end)}`, tone: "bg-good-soft text-good", blocks: false },
  expiring: { text: (s) => `Ends ${fmtDate(s.membership_end)}: renewal due`, tone: "bg-warn-soft text-warn", blocks: false },
  expired: { text: (s) => `Expired ${fmtDate(s.membership_end)}`, tone: "bg-bad-soft text-bad", blocks: true },
  frozen: { text: (s) => (s.freeze_end ? `Frozen till ${fmtDate(s.freeze_end)}` : "Frozen"), tone: "bg-bad-soft text-bad", blocks: true },
  none: { text: () => "No membership", tone: "bg-bad-soft text-bad", blocks: true },
  inactive: { text: () => "Marked inactive", tone: "bg-bad-soft text-bad", blocks: true },
};

/**
 * Quick check-in: pick a member and see who it is (photo), their plan and
 * dues before letting them in. Expired, frozen or no plan turns the button
 * red ("Check in anyway"), so the desk decides knowingly.
 */
export function CheckInCard({
  action,
  currency,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  currency: string;
}) {
  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [loading, startLoading] = useTransition();
  const [round, setRound] = useState(0); // remounts the picker after a check-in
  const [, formAction, saving] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await action(prev, fd);
    if (res?.ok) {
      toast(res.message ?? "Checked in", res.tone ?? "good");
      setStatus(null);
      setRound((r) => r + 1);
    } else if (res?.error) toast(res.error, "bad");
    return res;
  }, null);

  const info = status ? STATE_TEXT[status.state] : null;
  const blocked = !!info?.blocks;

  return (
    <form action={formAction} className="space-y-4">
      <MemberSelect
        key={round}
        required
        onChange={(m) => {
          setStatus(null);
          if (m) startLoading(async () => setStatus(await memberStatus(m.id)));
        }}
      />
      {loading && <p className="text-sm text-muted">Checking membership…</p>}
      {status && info && !loading && (
        <div className="flex gap-3 rounded-lg border border-line p-3">
          <Avatar name={status.full_name} size="lg" src={status.photo_url} />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold text-ink">
              {status.full_name} <span className="font-normal text-muted">{status.member_code}</span>
            </p>
            {status.plan_name && <p className="text-ink-2">{status.plan_name}</p>}
            <p className="flex flex-wrap gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.tone}`}>{info.text(status)}</span>
              {status.balance_due > 0 && (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">{money(status.balance_due, currency)} due</span>
              )}
              {status.inside && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2">Already inside</span>}
            </p>
            {(blocked || status.balance_due > 0) && (
              <Link href={`/members/${status.id}`} className="inline-block text-xs text-brand hover:underline">
                {blocked ? "Renew or resume on their profile" : "Collect fee on their profile"}
              </Link>
            )}
          </div>
        </div>
      )}
      <button type="submit" disabled={saving || status?.inside} className={`w-full ${blocked ? "btn-danger border border-bad/40" : "btn-primary"}`}>
        <LogIn size={16} /> {saving ? "Checking in…" : blocked ? "Check in anyway" : "Check in"}
      </button>
    </form>
  );
}
