"use client";

import { Fragment, isValidElement, useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ActionState } from "@/lib/types";
import { toast } from "@/components/toaster";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, className = "btn-primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Saving…" : children}
    </button>
  );
}

function ErrorNote({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {state.error}
    </p>
  );
}

/** An icon on its own (not text, not icon + text in a fragment) needs a label. */
const isIconOnly = (node: ReactNode) => isValidElement(node) && node.type !== Fragment;

/**
 * A modal form. Opens from `trigger`, submits a server action, closes on
 * success and shows a toast (the action's `message`, or `successMessage`).
 */
export function FormDialog({
  title,
  trigger,
  triggerClass = "btn-primary",
  action,
  submitLabel = "Save",
  successMessage = "Saved",
  children,
  wide,
}: {
  title: string;
  trigger: ReactNode;
  triggerClass?: string;
  action: FormAction;
  submitLabel?: string;
  successMessage?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, null);
  const [formKey, setFormKey] = useState(0);
  // The result already seen when the dialog was last opened; older errors stay hidden.
  const [seen, setSeen] = useState<ActionState>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state?.ok) return;
    ref.current?.close();
    toast(state.message ?? successMessage, state.tone ?? "good");
    if (state.href) router.push(state.href);
  }, [state, router, successMessage]);

  const open = () => {
    setFormKey((k) => k + 1); // fresh defaults each time it opens
    setSeen(state);
    ref.current?.showModal();
  };

  const iconOnly = isIconOnly(trigger);
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={open}
        aria-label={iconOnly ? title : undefined}
        title={iconOnly ? title : undefined}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl`}
      >
        <form key={formKey} action={formAction} className="flex max-h-[88vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Close">
              <X size={16} />
            </button>
          </header>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {state !== seen && <ErrorNote state={state} />}
            {children}
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className="btn-secondary" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <SubmitButton>{submitLabel}</SubmitButton>
          </footer>
        </form>
      </dialog>
    </>
  );
}

/** An inline form bound to a server action, with error + success feedback. */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
  successMessage,
  resetOnSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    const text = state.message ?? successMessage;
    if (text) toast(text, state.tone ?? "good");
  }, [state, resetOnSuccess, successMessage]);

  return (
    <form ref={ref} action={formAction} className={className}>
      <ErrorNote state={state} />
      {children}
    </form>
  );
}

/**
 * A button that runs a bound server action. With `confirmText` it first asks
 * in an in-app dialog. Results are reported with a toast.
 */
export function ActionButton({
  action,
  confirmText,
  confirmLabel = "Delete",
  successMessage,
  children,
  className = "btn-danger btn-sm",
  title,
}: {
  action: () => Promise<ActionState>;
  confirmText?: string;
  confirmLabel?: string;
  successMessage?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const danger = className.includes("btn-danger");
  const label = title ?? (typeof children === "string" ? undefined : danger ? "Delete" : undefined);

  const run = () =>
    start(async () => {
      const res = await action();
      dialog.current?.close();
      if (res?.error) toast(res.error, "bad");
      else if (res?.message) toast(res.message, res.tone ?? "good");
      else if (successMessage) toast(successMessage);
    });

  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={pending}
        className={className}
        onClick={() => (confirmText ? dialog.current?.showModal() : run())}
      >
        {children}
      </button>
      {confirmText && (
        <dialog ref={dialog} aria-label={confirmLabel} className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl">
          <div className="p-5">
            <p className="font-semibold">{confirmLabel}?</p>
            <p className="mt-2 text-sm text-ink-2">{confirmText}</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              className={danger ? "btn bg-bad text-white hover:brightness-110" : "btn-primary"}
              onClick={run}
            >
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

/** A read-only modal (history lists etc.) opened from a trigger button. */
export function ViewDialog({
  title,
  trigger,
  triggerClass = "btn-ghost btn-sm",
  children,
  wide,
}: {
  title: string;
  trigger: ReactNode;
  triggerClass?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const iconOnly = isIconOnly(trigger);
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={() => ref.current?.showModal()}
        aria-label={iconOnly ? title : undefined}
        title={iconOnly ? title : undefined}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl`}
      >
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Close">
              <X size={16} />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}
