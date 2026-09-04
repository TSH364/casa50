"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, RotateCcw, Trash2 } from "lucide-react";
import { reclassifyInvoice, revertImport } from "@/actions/import";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { InvoiceSummary } from "@/data/queries";
import type { MemberSummary } from "@/lib/houses";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  imported: "Importada",
  failed: "Falhou",
  reverted: "Desfeita",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function InvoiceList({
  invoices,
  members,
}: {
  invoices: InvoiceSummary[];
  members: MemberSummary[];
}) {
  const [reverting, setReverting] = useState<InvoiceSummary | undefined>();
  const [pending, startTransition] = useTransition();

  /**
   * Reanalisa sem confirmação: a ação não apaga nada, só preenche categoria
   * vazia. Pedir "tem certeza?" para algo reversível e inofensivo é ruído.
   */
  function reclassify(invoice: InvoiceSummary) {
    startTransition(async () => {
      const result = await reclassifyInvoice(invoice.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (!result.updated) {
        toast.info(
          result.remaining
            ? `Nada novo a classificar. ${result.remaining} lançamento(s) continuam sem categoria — a categoria do arquivo não fica guardada, então para esses vale importar a fatura de novo.`
            : "Todos os lançamentos desta fatura já estão categorizados.",
        );
        return;
      }
      toast.success(
        `${result.updated} lançamento(s) categorizados.` +
          (result.remaining ? ` ${result.remaining} continuam sem categoria.` : ""),
      );
    });
  }

  const importedBy = (id: string | null) =>
    members.find((m) => m.userId === id)?.fullName ?? "alguém";

  function confirmRevert() {
    if (!reverting) return;
    startTransition(async () => {
      const result = await revertImport(reverting.id);
      if (result.error) toast.error(result.error);
      else
        toast.success(
          `Importação desfeita. ${result.removed ?? 0} lançamento(s) removidos.`,
        );
      setReverting(undefined);
    });
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        title="Nenhuma fatura importada"
        description="Importe um CSV para ver o histórico de importações aqui."
      />
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {invoices.map((invoice) => {
          const isReverted = invoice.status === "reverted";
          // A divergência da secao 6: o que o banco imprimiu contra o que o
          // sistema somou. Só existe quando o arquivo traz o total.
          const divergence =
            invoice.reportedTotal === null
              ? null
              : invoice.reportedTotal - invoice.computedTotal;

          return (
            /*
             * Empilhado, e não tudo lado a lado: com o nome do arquivo, o
             * total e dois botões competindo pela mesma faixa, num celular
             * sobrava "F.." para o nome. Mesma decisão da lista de
             * lançamentos.
             */
            <li
              key={invoice.id}
              className={cn(
                "flex items-start gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-3",
                isReverted && "opacity-55",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                <FileSpreadsheet className="size-4" aria-hidden />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm text-ink">
                    {invoice.fileName ?? "Importação manual"}
                  </p>
                  <span className="tabular shrink-0 text-sm font-medium text-ink">
                    {formatBRL(invoice.computedTotal)}
                  </span>
                </div>

                <p className="truncate text-[12px] text-ink-faint">
                  {[
                    invoice.institution,
                    `${invoice.transactionCount} lançamento(s)`,
                    `por ${importedBy(invoice.createdBy)}`,
                    dateFormatter.format(new Date(invoice.createdAt)),
                    isReverted ? STATUS_LABEL[invoice.status] : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {divergence !== null && Math.abs(divergence) >= 0.01 ? (
                  <p className="mt-1 text-[12px] text-attention">
                    Diferença de {formatBRL(Math.abs(divergence))} entre o total
                    do banco e a soma dos lançamentos.
                  </p>
                ) : null}

                {!isReverted && invoice.transactionCount > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {/* A seta de voltar fica com a reanálise: é o que ela
                        sugere. Desfazer apaga lançamentos, e para isso o
                        ícone honesto é a lixeira. Com texto ao lado, porque
                        duas ações parecidas em ícone puro se confundem. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      aria-label={`Reanalisar categorias de ${invoice.fileName ?? "fatura"}`}
                      onClick={() => reclassify(invoice)}
                    >
                      <RotateCcw aria-hidden /> Reanalisar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Desfazer importação de ${invoice.fileName ?? "fatura"}`}
                      onClick={() => setReverting(invoice)}
                    >
                      <Trash2 aria-hidden /> Desfazer
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={reverting !== undefined}
        onOpenChange={(open) => {
          if (!open) setReverting(undefined);
        }}
        title="Desfazer importação"
        confirmLabel="Desfazer"
        itemLabel={`${reverting?.fileName ?? "fatura"} · ${reverting?.transactionCount ?? 0} lançamento(s)`}
        description="Os lançamentos criados por esta importação serão apagados. A fatura fica marcada como desfeita no histórico, e o arquivo pode ser importado de novo."
        pending={pending}
        onConfirm={confirmRevert}
      />
    </>
  );
}
