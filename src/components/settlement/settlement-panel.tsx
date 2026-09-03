"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, CircleAlert, Handshake, Trash2 } from "lucide-react";
import { deleteSettlement, recordSettlement } from "@/actions/settlements";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { formatBRL, formatCents } from "@/lib/money";
import { monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { MonthSettlement } from "@/domain/settlement";
import type { SettlementRecord } from "@/data/queries";
import type { MonthKey } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function SettlementPanel({
  settlement,
  records,
  members,
  month,
}: {
  settlement: MonthSettlement;
  records: SettlementRecord[];
  members: MemberSummary[];
  month: MonthKey;
}) {
  const [pending, startTransition] = useTransition();
  const [justSettled, setJustSettled] = useState<Set<string>>(new Set());

  const nameOf = (id: string) =>
    members.find((m) => m.userId === id)?.fullName ?? "alguém";

  function register(
    fromMemberId: string,
    toMemberId: string,
    amountCents: number,
    key: string,
  ) {
    startTransition(async () => {
      const result = await recordSettlement({
        month,
        fromMemberId,
        toMemberId,
        amountCents,
        note: null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setJustSettled((prev) => new Set(prev).add(key));
      toast.success("Acerto registrado.");
    });
  }

  return (
    <>
      <Panel>
        <CardHeader
          title={`Acerto de ${monthLabel(month)}`}
          description="Divide o que é da casa. O que está marcado como individual fica fora."
        />

        {settlement.sharedCents === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-faint">
            Nenhuma despesa compartilhada com responsável definido neste mês.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-baseline justify-between rounded-[--radius-control] bg-surface-3 px-3 py-2.5">
              <span className="text-[13px] text-ink-muted">
                Total compartilhado
              </span>
              <span className="tabular text-sm font-semibold text-ink">
                {formatCents(settlement.sharedCents)}
              </span>
            </div>

            <ul className="space-y-2">
              {settlement.balances.map((balance) => (
                <li
                  key={balance.memberId}
                  className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {nameOf(balance.memberId)}
                    </p>
                    <p className="truncate text-[12px] text-ink-faint">
                      Pagou {formatCents(balance.paidCents)} · cabia{" "}
                      {formatCents(balance.shareCents)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "tabular shrink-0 text-sm font-medium",
                      balance.balanceCents > 0
                        ? "text-positive"
                        : balance.balanceCents < 0
                          ? "text-danger"
                          : "text-ink-muted",
                    )}
                  >
                    {balance.balanceCents === 0
                      ? "—"
                      : `${balance.balanceCents > 0 ? "+" : "−"}${formatCents(Math.abs(balance.balanceCents))}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {settlement.unassignedCount > 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-[--radius-control] bg-attention-soft px-3 py-2.5 text-[13px] text-attention">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {formatCents(settlement.unassignedCents)} em{" "}
              {settlement.unassignedCount} lançamento(s) sem responsável ficaram
              fora da divisão. Defina quem gastou para o acerto ficar completo.
            </span>
          </p>
        ) : null}
      </Panel>

      {settlement.transfers.length > 0 ? (
        <Panel>
          <CardHeader
            title="Para empatar"
            description="Registrar não movimenta dinheiro nem cria lançamento — só anota que foi acertado."
          />
          <ul className="space-y-2">
            {settlement.transfers.map((transfer) => {
              const key = `${transfer.fromMemberId}:${transfer.toMemberId}`;
              const done = justSettled.has(key);
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-3"
                >
                  <Handshake className="size-4 shrink-0 text-brand" aria-hidden />
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span className="truncate text-ink">
                      {nameOf(transfer.fromMemberId)}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                    <span className="truncate text-ink">
                      {nameOf(transfer.toMemberId)}
                    </span>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">
                    {formatCents(transfer.amountCents)}
                  </span>
                  <Button
                    variant={done ? "ghost" : "outline"}
                    size="sm"
                    disabled={pending || done}
                    onClick={() =>
                      register(
                        transfer.fromMemberId,
                        transfer.toMemberId,
                        transfer.amountCents,
                        key,
                      )
                    }
                  >
                    {done ? (
                      <>
                        <Check aria-hidden /> Registrado
                      </>
                    ) : (
                      "Marcar pago"
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : settlement.sharedCents > 0 ? (
        <Panel>
          <div className="flex items-center gap-3 py-2">
            <Check className="size-5 shrink-0 text-positive" aria-hidden />
            <p className="text-sm text-ink">
              As contas do mês estão empatadas. Nada a acertar.
            </p>
          </div>
        </Panel>
      ) : null}

      {records.length > 0 ? (
        <Panel>
          <CardHeader
            title="Acertos registrados"
            description={`O que já foi marcado como pago em ${monthLabel(month)}.`}
          />
          <ul className="space-y-2">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {nameOf(record.fromMember)} pagou {nameOf(record.toMember)}
                  </p>
                  <p className="text-[12px] text-ink-faint">
                    {record.paidAt
                      ? dateFormat.format(new Date(record.paidAt))
                      : "sem data"}
                    {record.note ? ` · ${record.note}` : ""}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm text-ink">
                  {formatBRL(record.amount)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Excluir acerto"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteSettlement(record.id);
                      if (result.error) toast.error(result.error);
                      else toast.success("Acerto excluído.");
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
