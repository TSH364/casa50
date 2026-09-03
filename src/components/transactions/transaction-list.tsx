"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { deleteTransaction } from "@/actions/transactions";
import { TransactionFormDialog } from "./transaction-form";
import { CategoryPicker } from "./category-picker";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/money";
import { spendingCents } from "@/domain/finance";
import { cn } from "@/lib/utils";
import type { Card, Category, Transaction } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const TYPE_LABEL: Record<Transaction["type"], string> = {
  expense: "Despesa",
  income: "Receita",
  payment: "Pagamento",
  refund: "Estorno",
  fee: "Tarifa",
  adjustment: "Ajuste",
};

const ORIGIN_LABEL: Record<Transaction["origin"], string> = {
  invoice: "Fatura",
  manual: "Manual",
  recurrence: "Recorrência",
  imported_statement: "Extrato",
};

const dayFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

/** `"2026-08-12"` -> `"12 ago"`, sem passar por fuso local. */
function shortDate(iso: string) {
  return dayFormatter.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
}

export function TransactionList({
  transactions,
  categories,
  cards,
  members,
  defaultMonth,
}: {
  transactions: Transaction[];
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
  defaultMonth: string;
}) {
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [deleting, setDeleting] = useState<Transaction | undefined>();
  const [pending, startTransition] = useTransition();

  const categoryColor = (id: string | null) =>
    (id ? categories.find((c) => c.id === id)?.color : null) ?? "#8B8B94";
  const cardName = (id: string | null) =>
    id ? (cards.find((c) => c.id === id)?.name ?? null) : null;
  const memberName = (id: string | null) =>
    id ? (members.find((m) => m.userId === id)?.fullName ?? null) : null;

  function confirmDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteTransaction(deleting.id);
      if (result.error) toast.error(result.error);
      else toast.success("Lançamento excluído.");
      setDeleting(undefined);
    });
  }

  if (transactions.length === 0) {
    return (
      <EmptyState
        title="Nenhum lançamento"
        description="Nada corresponde a estes filtros neste mês."
      />
    );
  }

  return (
    <>
      {/* Lista, não tabela: no celular uma tabela larga fica ilegível
          (secao 21), e a lista funciona igual bem no desktop. */}
      <ul className="divide-y divide-line">
        {transactions.map((t) => {
          const spend = spendingCents(t);
          // A categoria saiu daqui: virou seletor, logo ao lado.
          const details = [
            cardName(t.cardId),
            memberName(t.memberId),
            t.installment
              ? `parcela ${t.installment.current}/${t.installment.total}`
              : null,
            ORIGIN_LABEL[t.origin],
            t.status === "forecast" ? "previsto" : null,
          ].filter(Boolean);

          return (
            <li
              key={t.id}
              className={cn(
                "group flex items-center gap-3 py-2.5",
                t.isHidden && "opacity-45",
              )}
            >
              <span
                className="h-9 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor(t.categoryId) }}
                aria-hidden
              />

              <span className="tabular w-11 shrink-0 text-[12px] text-ink-faint">
                {shortDate(t.date)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {t.merchantAlias ?? t.description}
                </p>
                <div className="flex min-w-0 items-center gap-1.5">
                  <CategoryPicker
                    transactionId={t.id}
                    description={t.merchantAlias ?? t.description}
                    categories={categories}
                    categoryId={t.categoryId}
                    subcategoryId={t.subcategoryId}
                  />
                  {details.length > 0 ? (
                    <span className="truncate text-[12px] text-ink-faint">
                      · {details.join(" · ")}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "tabular text-sm font-medium",
                    // Verde para o que entra ou volta; branco para o que sai.
                    spend < 0 || t.type === "income" ? "text-positive" : "text-ink",
                    t.type === "payment" && "text-ink-muted",
                  )}
                >
                  {formatBRL(t.amount)}
                </p>
                <p className="text-[11px] text-ink-faint">{TYPE_LABEL[t.type]}</p>
              </div>

              {/* Sempre visíveis no toque; no desktop aparecem no hover. */}
              <div className="flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${t.description}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Excluir ${t.description}`}
                  onClick={() => setDeleting(t)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {editing ? (
        <TransactionFormDialog
          key={editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          transaction={editing}
          categories={categories}
          cards={cards}
          members={members}
          defaultMonth={defaultMonth}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Excluir lançamento"
        itemLabel={
          deleting
            ? `${shortDate(deleting.date)} · ${deleting.description} · ${formatBRL(deleting.amount)}`
            : ""
        }
        description="Os totais e os gráficos são recalculados na hora. A exclusão fica registrada na auditoria."
        pending={pending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
