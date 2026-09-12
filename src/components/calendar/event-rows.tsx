"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, MapPin, Minus, Undo2 } from "lucide-react";
import {
  clearTransactionEventLink,
  setTransactionEventLink,
} from "@/actions/calendar";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EVENT_KIND_LABEL, type EventCandidate } from "@/domain/calendar";
import type { NotEventReason } from "@/domain/recurring";
import type { EventKind } from "@/domain/types";

/**
 * Por que o app deixou um lançamento de fora, em palavras que se conferem.
 *
 * A parcela é o caso que motivou isto: ela guarda a data da COMPRA original,
 * então todas as parcelas caem no mesmo dia do calendário e um compromisso
 * naquele dia somava a mesma compra várias vezes.
 */
const MOTIVO_FORA: Record<NotEventReason, string> = {
  installment: "parcela de uma compra anterior — guarda a data da compra",
  same_amount: "cobrança fixa, sempre do mesmo valor",
  same_day: "cobrança mensal, sempre no mesmo dia",
};

export interface EventRow {
  id: string;
  title: string;
  location: string | null;
  kind: EventKind;
  isCostly: boolean;
  periodo: string;
  daysInMonth: number;
  totalCents: number;
  confirmedCount: number;
  candidates: EventCandidate[];
}

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/**
 * Os compromissos do mês, abertos para confirmar o que foi gasto em cada um.
 *
 * Até aqui o app só sabia coincidência de data, e dizia isso com todas as
 * letras: "gasto NOS DIAS dele". Honesto, mas impreciso — a assinatura que
 * cobra dia 12 entrava na conta da viagem que começou dia 11, e a estimativa
 * da próxima viagem herdava o erro.
 *
 * Cada linha aqui corrige o palpite, e a correção vale para frente: é dela
 * que sai "quanto custa uma viagem desta casa".
 */
export function EventRows({ rows }: { rows: EventRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <EventItem
          key={row.id}
          row={row}
          isOpen={open === row.id}
          onToggle={() => setOpen(open === row.id ? null : row.id)}
        />
      ))}
    </ul>
  );
}

function EventItem({
  row,
  isOpen,
  onToggle,
}: {
  row: EventRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function decidir(transactionId: string, eventId: string | null) {
    startTransition(async () => {
      const result = await setTransactionEventLink(transactionId, eventId);
      if (result.error) toast.error(result.error);
    });
  }

  function limpar(transactionId: string) {
    startTransition(async () => {
      const result = await clearTransactionEventLink(transactionId);
      if (result.error) toast.error(result.error);
    });
  }

  const confirmados = row.confirmedCount;

  return (
    <li className="rounded-[--radius-control] bg-surface-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{row.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-faint">
            <span className={row.isCostly ? "text-attention" : undefined}>
              {EVENT_KIND_LABEL[row.kind]}
            </span>
            {row.daysInMonth > 1 ? <span>{row.daysInMonth} dias no mês</span> : null}
            {row.location ? (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{row.location}</span>
              </span>
            ) : null}
            {row.totalCents > 0 ? (
              <span className="tabular text-ink-muted">
                {formatCents(row.totalCents)}
                {confirmados > 0 ? " confirmado" : " nos dias"}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular text-[12px] text-ink-faint">{row.periodo}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 text-ink-faint transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-line px-3 py-2.5">
          {row.candidates.length === 0 ? (
            <p className="text-[12px] text-ink-faint">
              Nenhum lançamento nos dias deste compromisso.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-ink-faint">
                O que saiu nesses dias. Dizer o que é (e o que não é) deste
                compromisso melhora a estimativa do próximo.
              </p>
              <ul className="space-y-1.5">
                {row.candidates.map((c) => (
                  /*
                    Data + descrição + valor numa linha, botões na de baixo.
                    Tudo junto, os botões roubavam a largura do nome e
                    "MERCADOLIVRE MERCADOL" quebrava em três linhas de duas
                    palavras — e o nome é o que faz a pessoa lembrar se aquilo
                    foi da festa ou não. A altura extra é o preço certo.
                  */
                  <li key={c.id} className="rounded-[--radius-control] px-1 py-1">
                    <div className="flex items-baseline gap-2">
                      <span className="tabular shrink-0 text-[11px] text-ink-faint">
                        {DIA.format(new Date(`${c.date}T00:00:00Z`))}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 break-words text-[13px] leading-snug",
                          c.state === "excluded" || c.autoExcluded
                            ? "text-ink-faint"
                            : "text-ink-muted",
                          c.state === "excluded" && "line-through",
                        )}
                      >
                        {c.description}
                      </span>
                      <span
                        className={cn(
                          "tabular shrink-0 text-[13px]",
                          c.state === "excluded" || c.autoExcluded
                            ? "text-ink-faint"
                            : "text-ink",
                        )}
                      >
                        {formatCents(c.spendCents)}
                      </span>
                    </div>

                    {/* O motivo, escrito. "Isto é parcela" se confere olhando o
                        lançamento; "o app achou melhor" não se confere. */}
                    {c.autoExcluded ? (
                      <p className="mt-0.5 pl-7 text-[11px] text-ink-faint">
                        {MOTIVO_FORA[c.autoExcluded]}
                      </p>
                    ) : null}

                    {/* Três botões seriam demais: o estado decidido mostra só
                        o caminho de volta. */}
                    <span className="mt-1 flex items-center justify-end gap-1">
                      {c.state === "guess" ? (
                        <>
                          <Acao
                            label="É deste compromisso"
                            disabled={pending}
                            onClick={() => decidir(c.id, row.id)}
                          >
                            <Check aria-hidden /> É
                          </Acao>
                          {/* O "não é" some no que o app já deixou de fora: ele
                              já está fora. O "é" continua, porque uma passagem
                              parcelada PODE ser da viagem, e só a pessoa sabe. */}
                          {c.autoExcluded ? null : (
                            <Acao
                              label="Não é deste compromisso"
                              disabled={pending}
                              onClick={() => decidir(c.id, null)}
                            >
                              <Minus aria-hidden /> Não é
                            </Acao>
                          )}
                        </>
                      ) : (
                        <Acao
                          label="Desfazer a decisão"
                          disabled={pending}
                          onClick={() => limpar(c.id)}
                        >
                          <Undo2 aria-hidden />
                          {c.state === "linked" ? "confirmado" : "fora"}
                        </Acao>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Acao({
  label,
  children,
  disabled,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1 rounded-[--radius-control] border border-line px-2 text-[11px] text-ink-muted transition-colors hover:bg-surface-3 disabled:opacity-50 [&_svg]:size-3"
    >
      {children}
    </button>
  );
}
