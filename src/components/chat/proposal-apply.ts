import type { Proposal } from "@/domain/chat";
import { formatCents } from "@/lib/money";

/**
 * O que confirmar uma proposta manda ao servidor, e a frase de "feito".
 *
 * Vive fora do cartao porque ha dois jeitos de confirmar: o toque no cartao
 * e o "pode" no modo conversa por voz. Os dois tem de mandar a MESMA coisa.
 */

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaAno = (iso: string) => `${dia(iso)}/${iso.slice(0, 4)}`;
const mesAno = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const INTERVALO = { weekly: "toda semana", monthly: "todo mês", yearly: "todo ano" } as const;

export type Simples = Exclude<Proposal, { kind: "classificar" } | { kind: "lancar" }>;

/** Titulo, linhas e a frase de "feito" das propostas sem controle extra no cartao. */
export function descrever(p: Simples): { titulo: string; linhas: string[]; feito: string } {
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


/** O corpo de `applyProposal` para a proposta. */
export function proposalPayload(p: Proposal, learn = true): unknown {
  if (p.kind === "classificar") {
    return {
      kind: "classificar",
      transactionIds: p.transactionIds,
      categoryId: p.categoryId,
      subcategoryId: p.subcategoryId,
      learnMerchant: p.learnMerchant,
      learn,
    };
  }
  return { kind: p.kind, fields: p.fields };
}

/** A frase que fica no historico (e volta ao modelo) depois de confirmar. */
export function proposalDoneNote(p: Proposal, count: number | undefined): string {
  if (p.kind === "classificar") return `${count ?? 0} lançamento(s) classificados em ${p.summary.categoryLabel}.`;
  if (p.kind === "lancar") return `Lançado: ${p.fields.description}, ${formatCents(p.fields.amountCents)}.`;
  return descrever(p).feito;
}

/** O titulo do cartao, tambem usado para falar a proposta. */
export function proposalTitle(p: Proposal): string {
  if (p.kind === "classificar") return `Classificar ${p.summary.count} lançamento(s) em ${p.summary.categoryLabel}`;
  if (p.kind === "lancar") return `Lançar ${p.fields.description}`;
  return descrever(p).titulo;
}
