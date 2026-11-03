"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

// No look-alike characters (0/O, 1/l/I), so it's easy to read out or type
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function makePassword() {
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  const s = Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/**
 * A temporary password made for the owner, shown in plain text so it can be
 * copied and sent to the staff member. Posted as `name`; still editable.
 * Filled in the browser (not during server rendering), so each form gets a
 * fresh one.
 */
export function GeneratedPassword({ name, label = "Temporary password" }: { name: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (input.current && !input.current.value) input.current.value = makePassword();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(input.current?.value ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the password is visible, so it can still be copied by hand
    }
  };

  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex gap-2">
        <input ref={input} className="input font-mono tracking-wide" name={name} minLength={8} required autoComplete="off" spellCheck={false} />
        <button type="button" className="btn-secondary shrink-0" onClick={copy} aria-label="Copy password">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => input.current && (input.current.value = makePassword())}
          aria-label="Make a new password"
          title="Make a new password"
        >
          <RefreshCw size={16} />
        </button>
      </span>
      <span className="mt-1 block text-xs text-muted">Made for you. Send it to them; they can change it under My account.</span>
    </label>
  );
}
