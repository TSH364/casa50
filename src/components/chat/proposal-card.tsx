"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { applyProposal } from "@/actions/chat";
import type { Proposal } from "@/domain/chat";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { descrever, proposalDoneNote, proposalPayload, proposalTitle } from "./proposal-apply";

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
      const r = await applyProposal(proposalPayload(proposal, aprender));
      if (r.error) {
        setErro(r.error);
        return;
      }
      onResolve("feito", proposalDoneNote(proposal, r.count));
    });
  }

  const simples = proposal.kind === "classificar" || proposal.kind === "lancar" ? null : descrever(proposal);
  const titulo = proposalTitle(proposal);

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-corpo text-ink">
      <p className="font-medium">{titulo}</p>

      {proposal.kind === "classificar" ? (
        <>
          <p className="tabular text-legenda text-ink-muted">Total {formatCents(proposal.summary.totalCents)}</p>
          <ul className="mt-1 space-y-0.5 text-legenda text-ink-muted">
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
            <label className="mt-1.5 flex min-h-9 items-center gap-2 text-legenda text-ink-muted">
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
            <p key={i} className="tabular break-words text-legenda text-ink-muted">
              {l}
            </p>
          ))}
        </>
      ) : proposal.kind === "lancar" ? (
        <p className="tabular text-legenda text-ink-muted">
          {proposal.fields.type === "income" ? (
            // Receita marcada: confirmar uma entrada achando que e gasto era o erro.
            <span className="font-medium text-positive">Receita +{formatCents(proposal.fields.amountCents)}</span>
          ) : (
            formatCents(proposal.fields.amountCents)
          )}{" "}
          · {dia(proposal.fields.date)}
          {proposal.summary.categoryLabel ? ` · ${proposal.summary.categoryLabel}` : " · sem categoria"}
          {proposal.summary.personLabel ? ` · ${proposal.summary.personLabel}` : ""}
        </p>
      ) : null}

      {erro ? <p className="mt-1 text-legenda text-danger">{erro}</p> : null}

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
        <p className={status === "feito" ? "mt-1.5 text-legenda text-positive" : "mt-1.5 text-legenda text-ink-muted"}>
          {status === "feito" ? "Feito." : "Descartada."}
        </p>
      )}
    </div>
  );
}
