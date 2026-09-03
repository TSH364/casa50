"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, CreditCard, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { archiveCard, deleteCard, restoreCard } from "@/actions/cards";
import { CardFormDialog } from "./card-form";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { formatBRL } from "@/lib/money";
import type { Card } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export function CardsManager({
  cards,
  members,
}: {
  cards: Card[];
  members: MemberSummary[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Card | undefined>();
  const [deleting, setDeleting] = useState<Card | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const ownerName = (id: string | null) =>
    members.find((m) => m.userId === id)?.fullName ?? "sem dono definido";

  const active = cards.filter((c) => c.isActive);
  const archived = cards.filter((c) => !c.isActive);

  function openNew() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(card: Card) {
    setEditing(card);
    setFormOpen(true);
  }

  function run(action: () => Promise<{ error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    setDeleteError(undefined);
    startTransition(async () => {
      const result = await deleteCard(deleting.id);
      if (result.error) {
        // Erro esperado quando o cartão tem histórico: fica no diálogo,
        // explicando por que a exclusão foi recusada.
        setDeleteError(result.error);
        return;
      }
      toast.success("Cartão excluído.");
      setDeleting(undefined);
    });
  }

  return (
    <>
      <Panel>
        <CardHeader
          title="Cartões"
          description="Quem é dono do cartão é campo próprio, não é deduzido de quem importa a fatura."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus aria-hidden /> Novo
            </Button>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            title="Nenhum cartão ainda"
            description="Cadastre os cartões de vocês para que os lançamentos saibam de onde vieram."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus aria-hidden /> Adicionar cartão
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {active.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                  <CreditCard className="size-4" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {card.name}
                    {card.lastFour ? (
                      <span className="ml-1.5 font-normal text-ink-faint">
                        •••• {card.lastFour}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[13px] text-ink-faint">
                    {ownerName(card.ownerId)}
                    {card.closingDay
                      ? ` · fecha dia ${card.closingDay}`
                      : ""}
                    {card.dueDay ? ` · vence dia ${card.dueDay}` : ""}
                    {card.creditLimit
                      ? ` · limite ${formatBRL(card.creditLimit)}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${card.name}`}
                    onClick={() => openEdit(card)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Arquivar ${card.name}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => archiveCard(card.id), "Cartão arquivado.")
                    }
                  >
                    <Archive aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${card.name}`}
                    onClick={() => {
                      setDeleteError(undefined);
                      setDeleting(card);
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel>
          <CardHeader
            title="Arquivados"
            description="Não aparecem em novos lançamentos, mas o histórico segue intacto."
          />
          <ul className="space-y-2">
            {archived.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5 opacity-70"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {card.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => restoreCard(card.id), "Cartão restaurado.")}
                >
                  <RotateCcw aria-hidden /> Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <CardFormDialog
        key={editing?.id ?? "novo"}
        open={formOpen}
        onOpenChange={setFormOpen}
        card={editing}
        members={members}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Excluir cartão"
        itemLabel={deleting?.name ?? ""}
        description="Se o cartão já tem lançamentos, prefira arquivar — assim o histórico continua legível."
        pending={pending}
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </>
  );
}
