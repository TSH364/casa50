import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards, listCategories, listMonthsWithData } from "@/data/queries";
import { currentMonth, isMonthKey, monthLabel } from "@/domain/month";
import { Card, CardHeader, InDevelopment } from "@/components/ui/card";
import { MonthSwitcher } from "@/components/month-switcher";
import { FilterChips } from "@/components/filter-chips";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { Summary, SummarySkeleton } from "@/components/dashboard/summary";
import { ByCategory, ByCategorySkeleton } from "@/components/dashboard/by-category";
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
  searchParams: Promise<{ mes?: string; membro?: string; cartao?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const [members, cards, categories, monthsWithData] = await Promise.all([
    listMembers(active.id),
    listCards(active.id),
    listCategories(active.id),
    listMonthsWithData(active.id),
  ]);

  const { month, redirected } = resolveMonth(params.mes, monthsWithData);
  const memberId = params.membro ?? null;
  const cardId = params.cartao ?? null;

  // A chave muda com os filtros, então o Suspense volta a suspender e os
  // cards caem em skeleton — nunca exibem o número do mês anterior sob o
  // título do mês novo (secao 20).
  const key = `${month}:${memberId ?? "todos"}:${cardId ?? "todos"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-faint">{active.name}</p>
          <MonthSwitcher month={month} />
        </div>
        <NewTransactionButton
          categories={categories}
          cards={cards}
          members={members}
          defaultMonth={month}
        />
      </header>

      {redirected ? (
        <p className="rounded-[--radius-control] bg-attention-soft px-3.5 py-2.5 text-[13px] text-attention">
          {monthLabel(currentMonth())} ainda não tem lançamentos. Mostrando{" "}
          {monthLabel(month)}, o mês mais recente com dados.
        </p>
      ) : null}

      {members.length > 1 ? (
        <FilterChips
          param="membro"
          label="Filtrar por pessoa"
          active={memberId}
          options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
        />
      ) : null}

      {cards.filter((c) => c.isActive).length > 1 ? (
        <FilterChips
          param="cartao"
          label="Filtrar por cartão"
          active={cardId}
          allLabel="Todos os cartões"
          options={cards
            .filter((c) => c.isActive)
            .map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : null}

      <Suspense key={`resumo:${key}`} fallback={<SummarySkeleton />}>
        <Summary
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
        />
      </Suspense>

      <Card>
        <CardHeader
          title="Mapa de fluxo"
          description="Meses passados como realizado, próximos como previsão."
        />
        <InDevelopment note="Depende das recorrências e parcelas — Etapa 5." />
      </Card>

      <Suspense key={`categorias:${key}`} fallback={<ByCategorySkeleton />}>
        <ByCategory
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
        />
      </Suspense>

      <Card>
        <CardHeader title="Assinaturas e recorrências" />
        <InDevelopment note="Etapa 5." />
      </Card>

      <Card>
        <CardHeader title="Parcelas comprometidas" description="Próximos três meses." />
        <InDevelopment note="Etapa 5." />
      </Card>

      <Card>
        <CardHeader title="Conciliação" description="Estornos, IOF, tarifas e anuidade." />
        <InDevelopment note="Etapa 5." />
      </Card>

      <Card>
        <CardHeader title="Orçamentos" />
        <InDevelopment note="Etapa 6." />
      </Card>

      <Card>
        <CardHeader
          title="Cartões"
          description="Cadastre os cartões para que cada lançamento saiba de onde veio."
          action={
            <Link href="/cartoes" className="text-[13px] text-brand hover:underline">
              Gerenciar
            </Link>
          }
        />
        {cards.length === 0 ? (
          <p className="text-[13px] text-ink-faint">Nenhum cartão cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {cards
              .filter((c) => c.isActive)
              .map((c) => (
                <li
                  key={c.id}
                  className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] text-ink-muted"
                >
                  {c.name}
                  {c.lastFour ? ` ···· ${c.lastFour}` : ""}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
