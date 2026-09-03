import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campos de formulario.
 *
 * `text-base` (16px) no input nao e escolha estetica: abaixo disso o Safari
 * no iPhone dá zoom automatico ao focar, o que quebra o layout da secao 21.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "min-h-11 w-full rounded-[--radius-control] border border-line bg-surface-2 px-3 text-base text-ink",
      "placeholder:text-ink-faint transition-colors",
      "focus:border-brand focus:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "aria-[invalid=true]:border-danger",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full rounded-[--radius-control] border border-line bg-surface-2 px-3 py-2 text-base text-ink",
      "placeholder:text-ink-faint focus:border-brand focus:outline-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-[13px] font-medium text-ink-muted", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  /*
   * O rotulo sozinho nao basta: sem `aria-describedby`, quem usa leitor de
   * tela ouve "E-mail, campo de edicao" e nunca a dica nem o motivo do erro,
   * porque esses textos ficam fora do campo. `aria-invalid` e o que faz o
   * leitor anunciar o campo como invalido ao receber foco.
   *
   * O clone respeita o que o filho ja definiu: um campo que traga o proprio
   * `aria-describedby` nao e sobrescrito aqui.
   */
  const field = React.isValidElement<Record<string, unknown>>(children)
    ? React.cloneElement(children, {
        "aria-describedby":
          (children.props["aria-describedby"] as string | undefined) ??
          describedBy,
        "aria-invalid":
          (children.props["aria-invalid"] as boolean | undefined) ??
          (error ? true : undefined),
      })
    : children;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {field}
      {/* role="alert" faz o leitor de tela anunciar o erro assim que aparece. */}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
