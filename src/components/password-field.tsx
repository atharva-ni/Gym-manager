"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Password input with a show / hide toggle (easier to type correctly on a phone). */
export function PasswordField({
  label,
  name,
  autoComplete = "current-password",
  minLength,
}: {
  label: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="label">
        {label}
        <span className="text-bad"> *</span>
      </span>
      <span className="relative block">
        <input
          className="input pr-12"
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}
