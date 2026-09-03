"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal do Fluxo.
 *
 * No celular vira uma folha ancorada embaixo; no desktop, uma caixa centrada.
 * A estrutura resolve os pontos que a secao 10 cobra:
 *
 *   * `max-h-[85dvh]` usa altura *dinâmica* da viewport, então a folha
 *     encolhe quando o teclado do celular abre em vez de ficar por baixo dele;
 *   * o corpo é a única parte que rola (`overflow-y-auto`), enquanto cabeçalho
 *     e rodapé ficam fixos — assim "Salvar" e "Cancelar" nunca saem da tela;
 *   * o rodapé respeita `safe-area-inset-bottom`, para não ficar sob a barra
 *     de gestos do iPhone.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
  description?: string;
  footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
          "data-[state=open]:fluxo-fade-in data-[state=closed]:fluxo-fade-out",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-line bg-surface text-ink",
          // Celular: folha colada embaixo, cantos superiores arredondados.
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl",
          // Desktop: caixa centrada.
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          "data-[state=open]:fluxo-sheet-in",
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-ink-faint">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // O Radix avisa no console quando falta Description; o elemento
              // oculto satisfaz o leitor de tela sem poluir o layout.
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="-mr-2 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </header>

        {/* Única região que rola. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer ? (
          <footer
            className="shrink-0 border-t border-line bg-surface px-5 py-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </footer>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Confirmacao de exclusao (secoes 10 e 11): identifica o item, exige um
 * clique explícito e deixa "Cancelar" como a saída óbvia.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  itemLabel,
  description,
  confirmLabel = "Excluir",
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemLabel: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        footer={
          <div className="flex gap-2">
            <DialogPrimitive.Close
              className="min-h-11 flex-1 rounded-[--radius-control] border border-line-strong text-sm text-ink transition-colors hover:bg-surface-2"
              disabled={pending}
            >
              Cancelar
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending}
              className="min-h-11 flex-1 rounded-[--radius-control] bg-danger text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
            >
              {pending ? "Excluindo…" : confirmLabel}
            </button>
          </div>
        }
      >
        <p className="text-sm text-ink">
          {description ?? "Esta ação não pode ser desfeita."}
        </p>
        <p className="mt-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5 text-sm font-medium text-ink">
          {itemLabel}
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
