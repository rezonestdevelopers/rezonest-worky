"use client";

import { Controller, type FieldPath, type FieldValues, type Path, type PathValue, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

export const NONE = "__none";

export function FieldNote({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <p className="text-xs text-tone-red" role="alert">{error}</p>;
  if (hint) return <p className="text-xs text-muted-foreground">{hint}</p>;
  return null;
}

type Common<T extends FieldValues, O extends FieldValues> = {
  form: UseFormReturn<T, unknown, O>;
  name: FieldPath<T>;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
};

function errorOf<T extends FieldValues, O extends FieldValues>(form: UseFormReturn<T, unknown, O>, name: string) {
  return (form.formState.errors as Record<string, { message?: string } | undefined>)[name]?.message;
}

function FieldLabel({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <Label htmlFor={htmlFor}>
      {label}
      {required && <span className="text-tone-red" aria-hidden>*</span>}
    </Label>
  );
}

export function TextField<T extends FieldValues, O extends FieldValues>({
  form, name, label, hint, required, className, ...rest
}: Common<T, O> & Omit<React.ComponentProps<"input">, "form" | "name" | "required">) {
  const error = errorOf(form, name);
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={name} label={label} required={required} />
      <Input id={name} aria-invalid={!!error} aria-required={required} {...form.register(name)} {...rest} />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

export function TextAreaField<T extends FieldValues, O extends FieldValues>({
  form, name, label, hint, required, className, ...rest
}: Common<T, O> & Omit<React.ComponentProps<"textarea">, "form" | "name" | "required">) {
  const error = errorOf(form, name);
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={name} label={label} required={required} />
      <Textarea id={name} aria-invalid={!!error} {...form.register(name)} {...rest} />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

export function SelectField<T extends FieldValues, O extends FieldValues>({
  form, name, label, hint, required, className, options, noneLabel,
}: Common<T, O> & { options: { value: string; label: string }[]; noneLabel?: string }) {
  const error = errorOf(form, name);
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={name} label={label} required={required} />
      <Controller
        control={form.control}
        name={name as Path<T>}
        render={({ field }) => (
          <Select
            value={field.value ? String(field.value) : noneLabel ? NONE : undefined}
            onValueChange={(v) => field.onChange((v === NONE ? "" : v) as PathValue<T, Path<T>>)}
          >
            <SelectTrigger id={name} className="w-full" aria-invalid={!!error}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
              {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

/** Puts server validation messages back on the matching form fields. */
export function applyFieldErrors<T extends FieldValues, O extends FieldValues>(form: UseFormReturn<T, unknown, O>, result: ActionResult) {
  if (result.ok || !result.fieldErrors) return;
  for (const [name, message] of Object.entries(result.fieldErrors)) form.setError(name as FieldPath<T>, { message });
}
