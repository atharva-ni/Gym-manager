import type { InputHTMLAttributes, ReactNode } from "react";

type Opt = { value: string; label: string };

export function Field({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; name: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {props.required && <span className="text-bad"> *</span>}
      </span>
      <input className="input" {...props} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  required,
  placeholder,
  className = "",
}: {
  label: string;
  name: string;
  options: Opt[];
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      <select name={name} defaultValue={defaultValue ?? ""} required={required} className="input">
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 3,
  className = "",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} placeholder={placeholder} className="input" />
    </label>
  );
}

export function Checkbox({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--brand)]" />
      {label}
    </label>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-4 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>;
}

export function Hidden({ name, value }: { name: string; value?: string | null }) {
  return value ? <input type="hidden" name={name} value={value} /> : null;
}
