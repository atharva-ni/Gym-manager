"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type MemberOption = { id: string; member_code: string; full_name: string; phone: string | null };

/** Searchable member picker that submits `name` (default `member_id`) as a hidden input. */
export function MemberSelect({
  members,
  name = "member_id",
  label = "Member",
  required,
  defaultId,
  onChange,
}: {
  members: MemberOption[];
  name?: string;
  label?: string;
  required?: boolean;
  defaultId?: string | null;
  onChange?: (member: MemberOption | null) => void;
}) {
  // Keep an existing link even when that member isn't in the picker list (e.g. inactive).
  const initial =
    members.find((m) => m.id === defaultId) ??
    (defaultId ? { id: defaultId, member_code: "linked", full_name: "Current member", phone: null } : null);
  const [selected, setSelected] = useState<MemberOption | null>(initial);
  const [query, setQuery] = useState(initial ? display(initial) : "");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Clear the picker when its form is reset (e.g. after a successful check-in).
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setSelected(null);
      setQuery("");
      onChangeRef.current?.(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? members.filter(
          (m) =>
            m.full_name.toLowerCase().includes(q) ||
            m.member_code.toLowerCase().includes(q) ||
            (m.phone ?? "").includes(q),
        )
      : members;
    return list.slice(0, 8);
  }, [members, query]);

  return (
    <div className="relative">
      <label className="block">
        <span className="label">
          {label}
          {required && <span className="text-bad"> *</span>}
        </span>
        <input
          ref={inputRef}
          className="input"
          value={query}
          placeholder="Search by name, code or phone"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) onChange?.(null);
            setSelected(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </label>
      {/* Validation proxy: required fails until a member is picked */}
      <input
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
        name={name}
        value={selected?.id ?? ""}
        required={required}
        onChange={() => {}}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(m);
                  setQuery(display(m));
                  setOpen(false);
                  onChange?.(m);
                }}
              >
                <span className="text-ink">{m.full_name}</span>
                <span className="text-xs text-muted">
                  {m.member_code}
                  {m.phone ? ` · ${m.phone}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function display(m: MemberOption) {
  return `${m.full_name} (${m.member_code})`;
}
