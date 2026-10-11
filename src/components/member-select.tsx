"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { searchMembers } from "@/app/actions";

export type MemberOption = { id: string; member_code: string; full_name: string; phone: string | null };

/**
 * Searchable member picker. Searches the database as you type (name, member
 * code or mobile), so it works for any number of members. Submits `name`
 * (default `member_id`) as a hidden input.
 */
export function MemberSelect({
  name = "member_id",
  label = "Member",
  required,
  defaultMember,
  onChange,
}: {
  name?: string;
  label?: string;
  required?: boolean;
  defaultMember?: MemberOption | null;
  onChange?: (member: MemberOption | null) => void;
}) {
  const [selected, setSelected] = useState<MemberOption | null>(defaultMember ?? null);
  const [query, setQuery] = useState(defaultMember ? display(defaultMember) : "");
  const [results, setResults] = useState<MemberOption[]>([]);
  const [searched, setSearched] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setResults([]);
      onChangeRef.current?.(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      setSearched("");
      return;
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const found = await searchMembers(q);
        setResults(found);
        setSearched(q);
      });
    }, 200);
  };

  const pick = (m: MemberOption) => {
    setSelected(m);
    setQuery(display(m));
    setOpen(false);
    onChange?.(m);
  };

  const showList = open && !selected && query.trim().length >= 2;

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
          placeholder="Type a name, member code or mobile"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) onChange?.(null);
            setSelected(null);
            setOpen(true);
            search(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && showList && results[0]) {
              e.preventDefault();
              pick(results[0]);
            }
          }}
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
      {showList && (
        <ul id={listId} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg" role="listbox">
          {pending && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          ) : results.length === 0 && searched ? (
            <li className="px-3 py-2 text-sm text-muted">No member found for “{searched}”</li>
          ) : (
            results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                >
                  <span className="text-ink">{m.full_name}</span>
                  <span className="text-xs text-muted">
                    {m.member_code}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function display(m: MemberOption) {
  return `${m.full_name} (${m.member_code})`;
}
