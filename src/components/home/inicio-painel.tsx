import Link from "next/link";
import { listBudgets, listGoals, listRecurrences, listTransactions } from "@/data/queries";
import { budgetProgress, spendingCents, summarizeMonth, totalsByCategory } from "@/domain/finance";
import { forecastMonths, goalProgress, reconcileRecurrences, recurrencesFor } from "@/domain/forecast";
import { doriBarra, escolherAvisos, montarRamos } from "@/domain/home";
import { ehProvisorio } from "@/domain/provisorios";
import { addMonths, currentMonth, monthLabel } from "@/domain/month";
import { formatCents, formatCentsCompact, toCents } from "@/lib/money";
import { Skeleton } from "@/components/states";
import type { Category, MonthKey } from "@/domain/types";
import { DoriRitmo } from "./dori-ritmo";
import { AvisoAba } from "./aviso-aba";
import { Ramos } from "./ramos";
import { Barras, type BarraItem } from "./barras";

/** As metas usam cores de estado, fixas nos dois temas (texto escuro sobre elas). */
const COR_META = "#7c86ff";
const COR_META_FEITA = "#35d29a";

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-titulo font-semibold tracking-tight text-ink">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function LinkSecao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-corpo font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}

export function InicioPainelSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-[20px] bg-surface p-5 shadow-[0_8px_24px_rgba(20,23,40,0.08)]">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-10 w-44" />
        <Skeleton className="mt-5 h-8 w-full rounded-full" />
        <Skeleton className="mt-6 h-10 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * O Inicio da nova interface: o gasto do mes com a Dori, o que pede atencao
 * (logo abaixo, e so quando ha), para onde foi o dinheiro e as metas.
 *
 * Busca tudo de uma vez e calcula com as regras de `domain/home.ts`; os
 * componentes so desenham.
 */
export async function InicioPainel({
  houseId,
  month,
  memberId,
  cardId,
  excludeCategoryIds,
  categories,
  hasData,
  filtros = null,
}: {
  /** O botao dos filtros: fica no cartao do gasto, que e o numero que eles recortam. */
  filtros?: React.ReactNode;
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  excludeCategoryIds: string[];
  categories: Category[];
  hasData: boolean;
}) {
  const [txs, recorrentes, orcamentos, { goals }] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: addMonths(month, -3),
      toMonth: month,
      memberId,
      excludeCategoryIds,
      limit: 5000,
    }),
    listRecurrences(houseId),
    listBudgets(houseId, month),
    listGoals(houseId),
  ]);

  const agora = new Date();
  const resumo = summarizeMonth(txs, month, { memberId, cardId });
  const [previsao] = forecastMonths({
    transactions: txs,
    recurrences: recurrencesFor(recorrentes, memberId),
    fromMonth: addMonths(month, -1),
    months: 1,
  });
  const esperado = previsao && previsao.totalCents > 0 ? previsao.totalCents : null;
  const barra = doriBarra({ spentCents: resumo.spentCents, expectedCents: esperado, month, hasData, now: agora });

  // O que entrou durante o mes e ainda espera a fatura: o numero do dia 15
  // depende disso, e a casa precisa saber que ele ainda vai ser conferido.
  const aguardandoCents = txs
    .filter((t) => t.invoiceMonth === month && (cardId === null || t.cardId === cardId) && ehProvisorio(t))
    .reduce((soma, t) => soma + Math.max(0, spendingCents(t)), 0);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const totais = totalsByCategory(txs, month, { memberId, cardId });
  const porCategoria = new Map(totais.map((t) => [t.categoryId, t.totalCents]));

  // Avisos: so do mes corrente - de um mes passado ja nao ha o que fazer.
  const avisos =
    month === currentMonth(agora)
      ? escolherAvisos({
          orcamentos: orcamentos
            .filter((b) => b.limitAmount > 0)
            .map((b) => {
              const p = budgetProgress(porCategoria.get(b.categoryId) ?? 0, toCents(b.limitAmount), month, agora);
              return {
                nome: byId.get(b.categoryId)?.name ?? "Categoria",
                categoryId: b.categoryId,
                ratio: p.ratio,
                overCents: p.overCents,
              };
            }),
          contasFaltando: reconcileRecurrences(recurrencesFor(recorrentes, memberId), txs, month, agora)
            .filter((m) => m.status === "missing")
            .map((m) => ({ nome: m.recurrence.description })),
        })
      : [];

  const { ramos, totalCents } = montarRamos(
    totais.map((t) => {
      const c = t.categoryId ? byId.get(t.categoryId) : undefined;
      return { nome: c?.name ?? "Sem categoria", cor: c?.color ?? "#8B8B94", cents: t.totalCents };
    }),
  );
  const iconePorNome = new Map(categories.map((c) => [c.name, c.icon]));

  const metas: BarraItem[] = goals
    .filter((g) => g.status === "active" || g.status === "completed")
    .map((g) => ({
      g,
      p: goalProgress(toCents(g.currentAmount), toCents(g.targetAmount), {
        targetDate: g.targetDate,
        monthlyContributionCents: g.monthlyContribution === null ? null : toCents(g.monthlyContribution),
        today: agora,
      }),
    }))
    // As em andamento primeiro, as ja alcancadas depois; tres no maximo.
    .sort((a, b) => Number(a.p.isComplete) - Number(b.p.isComplete) || b.p.ratio - a.p.ratio)
    .slice(0, 3)
    .map(({ g, p }) => ({
      id: g.id,
      nome: g.name,
      razao: p.ratio,
      detalhe: `${formatCentsCompact(p.currentCents)} de ${formatCentsCompact(p.targetCents)}`,
      cor: p.isComplete ? COR_META_FEITA : COR_META,
      situacao: p.isComplete
        ? { texto: "Meta alcançada", tom: "positive" as const }
        : p.onTrack === false
          ? { texto: "O aporte não alcança o prazo", tom: "attention" as const }
          : null,
    }));

  const mes = monthLabel(month).split(" ")[0]!.replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="space-y-7">
      <section
        aria-label="Gasto do mês"
        className="space-y-3 rounded-[20px] bg-surface p-5 shadow-[0_8px_24px_rgba(20,23,40,0.08)]"
      >
        <div>
          <div className="flex min-h-9 items-center justify-between gap-3">
            <p className="text-corpo text-ink-muted">Gasto do mês</p>
            {filtros}
          </div>
          <p className="tabular text-principal font-bold tracking-tight text-ink">{formatCents(resumo.spentCents)}</p>
        </div>
        <DoriRitmo barra={barra} />
        {esperado !== null ? (
          <p className="text-corpo text-ink-muted">
            de <span className="tabular font-medium text-ink">{formatCents(esperado)}</span> previstos.
            {barra.ritmo !== null ? " A setinha marca onde ela deveria estar hoje." : null}
          </p>
        ) : null}
        {aguardandoCents > 0 ? (
          <p className="text-legenda text-ink-faint">
            Inclui <span className="tabular">{formatCents(aguardandoCents)}</span> lançados no mês, aguardando a fatura.
          </p>
        ) : null}
        <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3.5">
          <div>
            <dt className="text-legenda text-ink-faint">Receitas</dt>
            <dd className="tabular text-destaque font-semibold text-positive">{formatCentsCompact(resumo.incomeCents)}</dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">Saldo</dt>
            <dd className={`tabular text-destaque font-semibold ${resumo.balanceCents < 0 ? "text-danger" : "text-ink"}`}>
              {formatCentsCompact(resumo.balanceCents)}
            </dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">Em parcelas</dt>
            <dd className="tabular text-destaque font-semibold text-ink">{formatCentsCompact(resumo.installmentCents)}</dd>
          </div>
        </dl>
      </section>

      {avisos.length > 0 ? (
        <Secao titulo="Pede atenção">
          <div className="space-y-3">
            {avisos.map((a) => (
              <AvisoAba key={a.texto} aviso={a} />
            ))}
          </div>
        </Secao>
      ) : null}

      {ramos.length > 0 ? (
        <Secao titulo="Para onde foi" acao={<LinkSecao href="/analise">Ver tudo</LinkSecao>}>
          <Ramos ramos={ramos.map((r) => ({ ...r, icone: iconePorNome.get(r.nome) ?? null }))} totalCents={totalCents} mes={mes} />
        </Secao>
      ) : null}

      <Secao
        titulo="Metas"
        acao={<LinkSecao href="/metas">{metas.length > 0 ? "Ver metas" : "Criar meta"}</LinkSecao>}
      >
        {metas.length > 0 ? (
          <Barras itens={metas} />
        ) : (
          <p className="text-corpo text-ink-muted">Nenhuma meta ainda. Viagem, reserva, reforma: dá para guardar para cada uma.</p>
        )}
      </Secao>
    </div>
  );
}
