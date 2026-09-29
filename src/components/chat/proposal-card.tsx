"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { applyProposal } from "@/actions/chat";
import type { Proposal } from "@/domain/chat";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";

/**
 * Uma mudanca que a IA propos, esperando o toque (secao 16).
 *
 * O cartao mostra EXATAMENTE o que vai mudar - quantos lancamentos, quanto
 * somam, para qual categoria, alguns exemplos -, porque e isso que a pessoa
 * esta autorizando. Texto da IA dizendo "vou classificar" nao basta: o
 * cartao e o contrato.
 */

export type ProposalStatus = "pendente" | "feito" | "descartado";

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaAno = (iso: string) => `${dia(iso)}/${iso.slice(0, 4)}`;
const mesAno = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const INTERVALO = { weekly: "toda semana", monthly: "todo mês", yearly: "todo ano" } as const;

type Simples = Exclude<Proposal, { kind: "classificar" } | { kind: "lancar" }>;

/** Titulo, linhas e a frase de "feito" das propostas sem controle extra no cartao. */
function descrever(p: Simples): { titulo: string; linhas: string[]; feito: string } {
  switch (p.kind) {
    case "tarefa":
      return {
        titulo: `Nova tarefa: ${p.fields.title}`,
        linhas: [
          [
            p.fields.expectedCents !== null ? `Previsto ${formatCents(p.fields.expectedCents)}` : null,
            "na primeira coluna do quadro de Tarefas",
            p.fields.notes,
          ]
            .filter(Boolean)
            .join(" · "),
        ],
        feito: `Tarefa criada: ${p.fields.title}.`,
      };
    case "meta":
      return {
        titulo: `Nova meta: ${p.fields.name}`,
        linhas: [
          `Juntar ${formatCents(p.fields.targetCents)}${p.fields.targetDate ? ` até ${diaAno(p.fields.targetDate)}` : ""}`,
          [
            p.fields.monthlyCents !== null ? `guardar ${formatCents(p.fields.monthlyCents)} por mês` : null,
            p.summary.ownerLabel ? `de ${p.summary.ownerLabel}` : "da casa",
          ]
            .filter(Boolean)
            .join(" · "),
        ],
        feito: `Meta criada: ${p.fields.name}.`,
      };
    case "orcamento":
      return {
        titulo:
          p.fields.limitCents === 0
            ? `Remover o orçamento de ${p.summary.categoryLabel} (${mesAno(p.fields.month)})`
            : `Orçamento de ${p.summary.categoryLabel}: ${formatCents(p.fields.limitCents)} (${mesAno(p.fields.month)})`,
        linhas: [
          [
            p.summary.currentCents !== null ? `hoje ${formatCents(p.summary.currentCents)}` : "hoje sem limite",
            p.summary.averageCents !== null ? `média de gasto ${formatCents(p.summary.averageCents)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ],
        feito:
          p.fields.limitCents === 0
            ? `Orçamento de ${p.summary.categoryLabel} removido.`
            : `Orçamento de ${p.summary.categoryLabel} definido em ${formatCents(p.fields.limitCents)}.`,
      };
    case "conta_fixa":
      return {
        titulo: `Nova conta fixa: ${p.fields.description}`,
        linhas: [
          [
            formatCents(p.fields.amountCents),
            p.fields.expectedDay ? `todo dia ${p.fields.expectedDay}` : INTERVALO[p.fields.interval],
            p.summary.categoryLabel ?? "sem categoria",
            p.fields.merchant ? `na fatura: ${p.fields.merchant}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          "Entra na previsão; não cria lançamento.",
        ],
        feito: `Conta fixa criada: ${p.fields.description}.`,
      };
    case "mudar_tarefa":
      return {
        titulo: `Tarefa: ${p.summary.title}`,
        linhas: [p.summary.changes.join(" · ")],
        feito: `Tarefa atualizada: ${p.summary.title} (${p.summary.changes.join(", ")}).`,
      };
  }
}

export function ProposalCard({
  proposal,
  status,
  onResolve,
}: {
  proposal: Proposal;
  status: ProposalStatus;
  onResolve: (status: ProposalStatus, note: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  // Aprender a regra: ligado por padrao quando a proposta e de UMA loja - e o
  // que faz a proxima fatura ja chegar classificada.
  const [aprender, setAprender] = useState(true);

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r =
        proposal.kind === "classificar"
          ? await applyProposal({
              kind: "classificar",
              transactionIds: proposal.transactionIds,
              categoryId: proposal.categoryId,
              subcategoryId: proposal.subcategoryId,
              learnMerchant: proposal.learnMerchant,
              learn: aprender,
            })
          : await applyProposal({ kind: proposal.kind, fields: proposal.fields });
      if (r.error) {
        setErro(r.error);
        return;
      }
      onResolve(
        "feito",
        proposal.kind === "classificar"
          ? `${r.count ?? 0} lançamento(s) classificados em ${proposal.summary.categoryLabel}.`
          : proposal.kind === "lancar"
            ? `Lançado: ${proposal.fields.description}, ${formatCents(proposal.fields.amountCents)}.`
            : descrever(proposal).feito,
      );
    });
  }

  const simples = proposal.kind === "classificar" || proposal.kind === "lancar" ? null : descrever(proposal);
  const titulo =
    proposal.kind === "classificar"
      ? `Classificar ${proposal.summary.count} lançamento(s) em ${proposal.summary.categoryLabel}`
      : proposal.kind === "lancar"
        ? `Lançar ${proposal.fields.description}`
        : simples!.titulo;

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] text-ink">
      <p className="font-medium">{titulo}</p>

      {proposal.kind === "classificar" ? (
        <>
          <p className="tabular text-[12px] text-ink-muted">Total {formatCents(proposal.summary.totalCents)}</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-muted">
            {proposal.summary.examples.map((e, i) => (
              <li key={i} className="tabular break-words">
                {dia(e.date)} · {e.label} · {formatCents(e.cents)}
              </li>
            ))}
            {proposal.summary.count > proposal.summary.examples.length ? (
              <li>e mais {proposal.summary.count - proposal.summary.examples.length}</li>
            ) : null}
          </ul>
          {proposal.learnMerchant && status === "pendente" ? (
            <label className="mt-1.5 flex min-h-9 items-center gap-2 text-[12px] text-ink-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-brand)]"
                checked={aprender}
                onChange={(e) => setAprender(e.target.checked)}
              />
              As próximas faturas já chegam assim
            </label>
          ) : null}
        </>
      ) : simples ? (
        <>
          {simples.linhas.filter(Boolean).map((l, i) => (
            <p key={i} className="tabular break-words text-[12px] text-ink-muted">
              {l}
            </p>
          ))}
        </>
      ) : proposal.kind === "lancar" ? (
        <p className="tabular text-[12px] text-ink-muted">
          {formatCents(proposal.fields.amountCents)} · {dia(proposal.fields.date)}
          {proposal.summary.categoryLabel ? ` · ${proposal.summary.categoryLabel}` : " · sem categoria"}
          {proposal.summary.personLabel ? ` · ${proposal.summary.personLabel}` : ""}
        </p>
      ) : null}

      {erro ? <p className="mt-1 text-[12px] text-danger">{erro}</p> : null}

      {status === "pendente" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={confirmar} disabled={pending}>
            <Check aria-hidden /> {pending ? "Gravando…" : "Confirmar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onResolve("descartado", "Proposta descartada.")} disabled={pending}>
            <X aria-hidden /> Descartar
          </Button>
        </div>
      ) : (
        <p className={status === "feito" ? "mt-1.5 text-[12px] text-positive" : "mt-1.5 text-[12px] text-ink-muted"}>
          {status === "feito" ? "Feito." : "Descartada."}
        </p>
      )}
    </div>
  );
}
