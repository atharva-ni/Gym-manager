import "server-only";

type FieldType = "text" | "number" | "int" | "date" | "time" | "bool" | "uuid";
type Spec = Record<string, FieldType | `${FieldType}!`>;
export type Row = Record<string, string | number | boolean | null>;

export class FormError extends Error {}

/**
 * Turn FormData into a typed row. `"text!"` marks a field required.
 * Empty strings become null so optional columns stay clean.
 */
export function parseForm(fd: FormData, spec: Spec): Row {
  const out: Row = {};
  for (const [key, rawType] of Object.entries(spec)) {
    const required = rawType.endsWith("!");
    const type = rawType.replace("!", "") as FieldType;
    const raw = fd.get(key);
    const str = typeof raw === "string" ? raw.trim() : "";
    const name = key.replace(/_/g, " ");

    if (type === "bool") {
      out[key] = raw === "on" || raw === "true";
      continue;
    }
    if (str === "") {
      if (required) throw new FormError(`${name[0].toUpperCase()}${name.slice(1)} is required`);
      out[key] = null;
      continue;
    }
    if (type === "number" || type === "int") {
      const n = Number(str);
      if (!Number.isFinite(n)) throw new FormError(`${name} must be a number`);
      out[key] = type === "int" ? Math.trunc(n) : n;
    } else {
      out[key] = str;
    }
  }
  return out;
}

export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
