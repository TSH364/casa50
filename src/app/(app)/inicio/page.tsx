import { Suspense } from "react";
import type { Metadata } from "next";
import { PersonFilterNote } from "@/components/person-filter-note";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { TotalsNote } from "@/components/totals-note";
import { listCards, listCategories, listMonthsWithData } from "@/data/queries";
import { currentMonth, isMonthKey, monthLabel } from "@/domain/month";
import { MonthPanels, PanelsSkeleton } from "@/components/dashboard/month-panels";
import { FlowMap, FlowMapSkeleton } from "@/components/dashboard/flow-map";
import {
  MonthCalendar,
  MonthCalendarSkeleton,
} from "@/components/dashboard/month-calendar";
import { MonthSwitcher } from "@/components/month-switcher";
import { FilterChips } from "@/components/filter-chips";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { FiltrosInicio } from "@/components/home/filtros-inicio";
import { InicioPainel, InicioPainelSkeleton } from "@/components/home/inicio-painel";
import { getCurrentUser } from "@/lib/supabase/server";
import type { MonthKey } from "@/domain/types";

export const metadata: Metadata = { title: "Início · Fluxo" };

/**
 * Escolhe o mês a exibir.
 *
 * A secao 7 proíbe abrir numa tela vazia sem explicação: quando o mês
 * corrente não tem lançamento nenhum, o app abre no último mês com dados e
 * avisa que fez isso.
 */
function resolveMonth(
  requested: string | undefined,
  withData: MonthKey[],
): { month: MonthKey; redirected: boolean } {
  if (requested && isMonthKey(requested)) {
    return { month: requested, redirected: false };
  }
  const now = currentMonth();
  if (withData.length === 0 || withData.includes(now)) {
    return { month: now, redirected: false };
  }
  return { month: withData[0] ?? now, redirected: true };
}

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    membro?: string;
    cartao?: string;
    totais?: string;
  }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const [members, cards, view, monthsWithData, user] = await Promise.all([
    listMembers(active.id),
    listCards(active.id),
    houseView(active.id, params.totais),
    listMonthsWithData(active.id),
    getCurrentUser(),
  ]);
  const categories = view.categories;
  const excludeCategoryIds = view.excludeCategoryIds;

  const { month, redirected } = resolveMonth(params.mes, monthsWithData);
  const memberId = params.membro ?? null;
  const cardId = params.cartao ?? null;

  // A chave muda com os filtros, então o Suspense volta a suspender e os
  // cards caem em skeleton — nunca exibem o número do mês anterior sob o
  // título do mês novo (secao 20).
  // A lente de totais entra na chave: trocar de "só a casa" para "tudo" tem
  // de fazer os cards suspenderem, e não mostrar o número antigo sob o
  // rótulo novo.
  const key = `${month}:${memberId ?? "todos"}:${cardId ?? "todos"}:${
    view.showingAll ? "tudo" : "casa"
  }`;

  const eu = members.find((m) => m.userId === user?.id);
  const hora = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }),
  );
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  // O recorte em uso, numa linha: pessoa, cartao e o que esta fora dos totais.
  const cartoesAtivos = cards.filter((c) => c.isActive);
  const temFiltros = members.length > 1 || cartoesAtivos.length > 1 || view.excluded.length > 0;
  const partes = [
    memberId ? (members.find((m) => m.userId === memberId)?.fullName.split(" ")[0] ?? "Uma pessoa") : "Todos",
    cardId ? (cards.find((c) => c.id === cardId)?.name ?? "Um cartão") : null,
    view.excluded.length === 0
      ? null
      : view.showingAll
        ? "tudo"
        : `sem ${view.excluded.map((c) => c.name).join(", ")}`,
  ].filter(Boolean);
  const resumoFiltros = partes.join(" · ");
  const filtroAtivo = memberId !== null || cardId !== null || view.showingAll;
  const filtros = temFiltros ? (
    <FiltrosInicio resumo={resumoFiltros} ativo={filtroAtivo}>
      {members.length > 1 ? (
        <FilterChips
          param="membro"
          label="Filtrar por pessoa"
          active={memberId}
          options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
        />
      ) : null}
      {cartoesAtivos.length > 1 ? (
        <FilterChips
          param="cartao"
          label="Filtrar por cartão"
          active={cardId}
          allLabel="Todos os cartões"
          options={cartoesAtivos.map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : null}
      <TotalsNote view={view} month={month} extraParams={{ membro: memberId, cartao: cardId }} />
    </FiltrosInicio>
  ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="truncate text-corpo text-ink-muted">
          {saudacao}
          {eu ? `, ${eu.fullName.split(" ")[0]}` : ""}
        </p>
        <h1 className="sr-only">Início</h1>
        <div className="-ml-3 flex items-center justify-between gap-2">
          <MonthSwitcher month={month} />
          <NewTransactionButton
            categories={categories}
            cards={cards}
            members={members}
            defaultMonth={month}
            label="Lançar"
            iconOnly
          />
        </div>
      </header>

      {redirected ? (
        <p className="rounded-(--radius-control) bg-attention-soft px-3.5 py-2.5 text-corpo text-attention">
          {monthLabel(currentMonth())} ainda não tem lançamentos. Mostrando{" "}
          {monthLabel(month)}, o mês mais recente com dados.
        </p>
      ) : null}

      {memberId ? <PersonFilterNote cards={cards} houseWidePanels /> : null}

      <Suspense key={`painel:${key}`} fallback={<InicioPainelSkeleton />}>
        <InicioPainel
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
          excludeCategoryIds={excludeCategoryIds}
          categories={view.categories}
          hasData={monthsWithData.length > 0}
          filtros={filtros}
        />
      </Suspense>

      <h2 className="pt-2 text-titulo font-semibold tracking-tight text-ink">O mês em detalhe</h2>

      <Suspense key={`fluxo:${key}`} fallback={<FlowMapSkeleton />}>
        <FlowMap
          houseId={active.id}
          month={month}
          excludeCategoryIds={excludeCategoryIds}
          memberId={memberId}
          memberName={members.find((m) => m.userId === memberId)?.fullName.split(" ")[0] ?? null}
        />
      </Suspense>

      <Suspense key={`calendario:${key}`} fallback={<MonthCalendarSkeleton />}>
        <MonthCalendar
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
          excludeCategoryIds={excludeCategoryIds}
          categories={view.categories}
        />
      </Suspense>

      <Suspense key={`paineis:${key}`} fallback={<PanelsSkeleton />}>
        <MonthPanels
          houseId={active.id}
          month={month}
          excludeCategoryIds={excludeCategoryIds}
        />
      </Suspense>

    </div>
  );
}
