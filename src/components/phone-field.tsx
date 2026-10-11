"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { membersWithPhone } from "@/app/actions";

type Match = { id: string; full_name: string; member_code: string };

/**
 * Mobile number input that warns when another member already uses the
 * number. Saving is blocked server-side unless "Different person, same
 * number" is ticked (e.g. family members sharing a phone).
 */
export function PhoneField({ defaultValue, excludeId }: { defaultValue?: string | null; excludeId?: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [checking, start] = useTransition();

  const check = (phone: string) =>
    start(async () => {
      setMatches(await membersWithPhone(phone, excludeId));
    });

  return (
    <div>
      <label className="block">
        <span className="label">
          Mobile number<span className="text-bad"> *</span>
        </span>
        <input
          className="input"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="98765 43210"
          defaultValue={defaultValue ?? ""}
          required
          onBlur={(e) => check(e.target.value)}
          onChange={() => matches.length && setMatches([])}
        />
      </label>
      {checking ? (
        <span className="mt-1 block text-xs text-muted">Checking…</span>
      ) : matches.length ? (
        <div className="mt-2 rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">
          <p>
            Already registered to{" "}
            {matches.map((m, i) => (
              <span key={m.id}>
                {i > 0 && ", "}
                <Link href={`/members/${m.id}`} target="_blank" className="font-medium underline">
                  {m.full_name} ({m.member_code})
                </Link>
              </span>
            ))}
            .
          </p>
          <label className="mt-1.5 flex items-center gap-2 text-ink-2">
            <input type="checkbox" name="allow_duplicate" className="size-3.5 accent-[var(--brand)]" />
            Different person, same number (e.g. family)
          </label>
        </div>
      ) : (
        <span className="mt-1 block text-xs text-muted">Used for WhatsApp reminders.</span>
      )}
    </div>
  );
}
