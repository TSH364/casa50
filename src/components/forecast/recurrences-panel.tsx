"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  acceptDetectedRecurrence,
  confirmRecurrencePayment,
  deleteRecurrence,
  setRecurrenceActive,
} from "@/actions/recurrences";
import { RecurrenceFormDialog } from "./recurrence-form";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { Input } from "@/components/ui/field";
import { formatCents, parseAmountCents } from "@/lib/money";
import { monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { RecurrenceCandidate, RecurrenceMatch } from "@/domain/forecast";
import type { Card, Category, MonthKey, Recurrence } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const STATUS = {
  confirmed: {
    label: "Apareceu",
    Icon: Check,
    tone: "text-positive",
    chip: "bg-positive-soft text-positive",
  },
  divergent: {
    label: "Valor diferente",
    Icon: AlertTriangle,
    tone: "text-attention",
    chip: "bg-attention-soft text-attention",
  },
  missing: {
    label: "Não apareceu",
    Icon: AlertTriangle,
    tone: "text-danger",
    chip: "bg-danger-soft text-danger",
  },
  pending: {
    label: "Ainda não venceu",
    Icon: CircleDashed,
    tone: "text-ink-faint",
    chip: "bg-surface-3 text-ink-muted",
  },
  /**
   * Conta que não passa no cartão, esperando confirmação.
   *
   * Tom de atenção e não de perigo: há algo a fazer, mas nada deu errado. O
   * vermelho de "não apareceu" acusa falta; aqui não falta nada — a conta
   * simplesmente não chega por fatura, e quem diz quanto foi pago é a casa.
   */
  to_confirm: {
    label: "Confirmar pagamento",
    Icon: CircleDashed,
    tone: "text-attention",
    chip: "bg-attention-soft text-attention",
  },
} as const;

export function RecurrencesPanel({
  matches,
  candidates,
  month,
  categories,
  cards,
  members,
}: {
  matches: RecurrenceMatch[];
  candidates: RecurrenceCandidate[];
  month: MonthKey;
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Recurrence | undefined>();
  const [deleting, setDeleting] = useState<Recurrence | undefined>();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });
  }

  function accept(candidate: RecurrenceCandidate) {
    startTransition(async () => {
      const result = await acceptDetectedRecurrence({
        description: candidate.description,
        merchant: candidate.merchantNormalized || null,
        amountCents: candidate.amountCents,
        expectedDay: candidate.expectedDay,
        categoryId: candidate.categoryId,
        cardId: candidate.cardId,
      });
      if (result.error) toast.error(result.error);
      else toast.success("Recorrência cadastrada.");
    });
  }

  const missing = matches.filter((m) => m.status === "missing");
  const aConfirmar = matches.filter((m) => m.status === "to_confirm");
  const divergent = matches.filter((m) => m.status === "divergent");
  const visibleCandidates = candidates.filter(
    (c) => !dismissed.has(c.merchantNormalized),
  );

  return (
    <>
      {missing.length > 0 || divergent.length > 0 || aConfirmar.length > 0 ? (
        <Panel>
          <CardHeader
            title="Conferir neste mês"
            description={`O que estava previsto para ${monthLabel(month)} e não bateu.`}
          />
          <ul className="space-y-2">
            {[...aConfirmar, ...missing, ...divergent].map((match) => {
              const meta = STATUS[match.status];
              return (
                <li
                  key={match.recurrence.id}
                  className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
                >
                  <meta.Icon
                    className={cn("size-4 shrink-0", meta.tone)}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {match.recurrence.description}
                    </p>
                    <p className="truncate text-[12px] text-ink-faint">
                      {match.status === "to_confirm"
                        ? `${formatCents(match.expectedCents)} combinados — não chega pela fatura`
                        : match.status === "missing"
                        ? `Esperado ${formatCents(match.expectedCents)}${
                            match.recurrence.expectedDay
                              ? ` até o dia ${match.recurrence.expectedDay}`
                              : ""
                          }`
                        : `Esperado ${formatCents(match.expectedCents)}, veio ${formatCents(match.actualCents ?? 0)}`}
                    </p>
                  </div>
                  {match.status === "to_confirm" ? (
                    <ConfirmarPagamento
                      recurrenceId={match.recurrence.id}
                      month={month}
                      expectedCents={match.expectedCents}
                    />
                  ) : null}
                  {match.status === "divergent" ? (
                    <span
                      className={cn(
                        "tabular shrink-0 text-sm font-medium",
                        match.differenceCents > 0 ? "text-danger" : "text-positive",
                      )}
                    >
                      {match.differenceCents > 0 ? "+" : "−"}
                      {formatCents(Math.abs(match.differenceCents))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <CardHeader
          title="Recorrências"
          description="O que se repete todo mês. Serve para prever e para avisar quando falta."
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden /> Nova
            </Button>
          }
        />

        {matches.length === 0 ? (
          <EmptyState
            title="Nenhuma recorrência"
            description="Cadastre aluguel, assinaturas e mensalidades para o app prever os próximos meses."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus aria-hidden /> Criar recorrência
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {matches.map((match) => {
              const meta = STATUS[match.status];
              const r = match.recurrence;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {r.description}
                      {r.source === "detected" ? (
                        <span className="ml-1.5 text-[11px] text-ink-faint">
                          detectada
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[12px] text-ink-faint">
                      {formatCents(match.expectedCents)}
                      {r.expectedDay ? ` · dia ${r.expectedDay}` : ""}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                      meta.chip,
                    )}
                  >
                    {meta.label}
                  </span>

                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${r.description}`}
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={
                        r.isActive
                          ? `Pausar ${r.description}`
                          : `Retomar ${r.description}`
                      }
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => setRecurrenceActive(r.id, !r.isActive),
                          r.isActive ? "Recorrência pausada." : "Recorrência retomada.",
                        )
                      }
                    >
                      {r.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir ${r.description}`}
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {visibleCandidates.length > 0 ? (
        <Panel>
          <CardHeader
            title="Talvez sejam recorrências"
            description="Encontradas no histórico. São sugestões — nada é cadastrado sem você aceitar."
          />
          <ul className="space-y-2">
            {visibleCandidates.map((candidate) => (
              <li
                key={candidate.merchantNormalized}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
              >
                <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {candidate.description}
                  </p>
                  <p className="truncate text-[12px] text-ink-faint">
                    {formatCents(candidate.amountCents)} em{" "}
                    {candidate.months.length} meses seguidos
                    {candidate.expectedDay
                      ? `, sempre por volta do dia ${candidate.expectedDay}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => accept(candidate)}
                >
                  Cadastrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Dispensar sugestão ${candidate.description}`}
                  onClick={() =>
                    setDismissed((prev) =>
                      new Set(prev).add(candidate.merchantNormalized),
                    )
                  }
                >
                  Dispensar
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <RecurrenceFormDialog
        key={editing?.id ?? "nova"}
        open={formOpen}
        onOpenChange={setFormOpen}
        recurrence={editing}
        categories={categories}
        cards={cards}
        members={members}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Excluir recorrência"
        itemLabel={deleting?.description ?? ""}
        description="Os lançamentos que já existem continuam onde estão. Some só a expectativa e o aviso de ausência."
        pending={pending}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deleteRecurrence(deleting.id);
            if (result.error) toast.error(result.error);
            else toast.success("Recorrência excluída.");
            setDeleting(undefined);
          });
        }}
      />
    </>
  );
}


/**
 * Lança a conta que não passa no cartão, com o valor conferido.
 *
 * O VALOR VEM PREENCHIDO E EDITÁVEL, e isso é o ponto: parcela de
 * financiamento muda com juros, seguro e TR, e um botão que gravasse o valor
 * combinado registraria errado em silêncio — justo no lançamento que ninguém
 * vai reconferir, porque "é sempre o mesmo".
 */
function ConfirmarPagamento({
  recurrenceId,
  month,
  expectedCents,
}: {
  recurrenceId: string;
  month: MonthKey;
  expectedCents: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(
    String(expectedCents / 100).replace(".", ","),
  );
  const [enviando, startTransition] = useTransition();

  function confirmar() {
    const cents = parseAmountCents(valor);
    if (cents === null) {
      toast.error("Valor inválido.");
      return;
    }
    startTransition(async () => {
      const r = await confirmRecurrencePayment({
        recurrenceId,
        month,
        amountCents: cents,
      });
      if (r.error) toast.error(r.error);
      else {
        toast.success("Pagamento lançado.");
        setAberto(false);
      }
    });
  }

  if (!aberto) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        Lançar
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        inputMode="decimal"
        className="w-24"
        aria-label="Valor pago"
      />
      <Button size="sm" disabled={enviando} onClick={confirmar}>
        Confirmar
      </Button>
    </div>
  );
}
