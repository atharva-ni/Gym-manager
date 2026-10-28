"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

const MAX_SIDE = 600;

/**
 * Shrink a phone photo (often 3 to 8 MB) to a small JPEG before upload.
 * Returns the original file when the browser can't read it (e.g. some HEIC).
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Member photo: take one with the camera or pick from the gallery, with a preview. */
export function PhotoField({ name, currentUrl }: { name: string; currentUrl?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  // Free the preview's memory when it changes or the form closes
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    const small = await shrink(picked);
    // Swap the small copy into the input so the form uploads it
    const dt = new DataTransfer();
    dt.items.add(small);
    e.target.files = dt.files;
    setPreview(URL.createObjectURL(small));
    setRemove(false);
    setBusy(false);
  };

  const clear = () => {
    if (input.current) input.current.value = "";
    setPreview(null);
  };

  const shown = preview ?? (remove ? null : currentUrl);
  return (
    <div className="flex items-center gap-4">
      <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 text-muted">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview / signed URL
          <img src={shown} alt="Member photo" className="size-full object-cover" />
        ) : (
          <Camera size={24} aria-hidden />
        )}
      </span>
      <div className="min-w-0 space-y-1.5">
        <label className="btn-secondary btn-sm cursor-pointer">
          <Camera size={14} /> {busy ? "Preparing..." : shown ? "Change photo" : "Take / choose photo"}
          {/* No `capture`: phones then offer both the camera and the gallery */}
          <input ref={input} type="file" name={name} accept="image/*" className="sr-only" onChange={onPick} />
        </label>
        {preview ? (
          <button type="button" onClick={clear} className="btn-ghost btn-sm">
            <X size={14} /> Undo
          </button>
        ) : (
          currentUrl && (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" name="remove_photo" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
              Remove photo
            </label>
          )
        )}
        <p className="text-xs text-muted">Optional. Helps the desk recognise members at check-in.</p>
      </div>
    </div>
  );
}
