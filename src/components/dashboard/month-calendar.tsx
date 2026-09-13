import { listCalendarEvents, listTransactions } from "@/data/queries";
import { dailySpending, itemsByCategory } from "@/domain/finance";
import { merchantKey } from "@/domain/merchants";
import { fixedChargeMerchants } from "@/domain/recurring";
import { addMonths, daysInMonth, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { CalendarGrid, type CalendarDay } from "./calendar-grid";
import type { Category, MonthKey } from "@/domain/types";

export function MonthCalendarSkeleton() {
  return (
    <Card>
      <CardHeader title="Dia a dia" />
      <Skeleton className="h-56 w-full" />
    </Card>
  );
}

/**
 * Meses de historico para reconhecer cobranca fixa.
 *
 * Doze porque o sinal e anual no pior caso - a anuidade do cartao cobra uma
 * vez por ano - e porque `fixedChargeMerchants` exige tres a quatro
 * ocorrencias antes de julgar qualquer coisa. Uma janela curta nao erra: ela
 * simplesmente nao reconhece, e a assinatura volta a inflar o dia.
 */
const HISTORICO = 12;

/**
 * O mes visto dia a dia (secao 7).
 *
 * O mapa de fluxo compara meses; este mostra o DESENHO de um mes por dentro.
 * Sao perguntas diferentes: "gastamos mais que em julho?" e "o que aconteceu
 * na terceira semana?" - e a segunda nenhuma barra mensal responde.
 */
export async function MonthCalendar({
  houseId,
  month,
  memberId,
  cardId,
  excludeCategoryIds,
  categories,
}: {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
  /** Todas as categorias da casa, para colorir os lançamentos do dia. */
  categories: Category[];
}) {
  // Duas buscas com papeis distintos. O mes desenha a grade; o HISTORICO e o
  // unico jeito de saber o que e assinatura, porque "cobra sempre o mesmo
  // valor" e "cai sempre no mesmo dia" so existem ao longo de varios meses.
  // Reconhecer isso dentro de um mes so e impossivel: ali cada assinatura
  // aparece uma vez.
  //
  // `MonthPanels` faz esta MESMA busca de historico, na mesma pagina, e as
  // duas nao se aproveitam: `listTransactions` nao passa por `cache()`, e
  // passar nao resolveria sozinho porque o filtro vai num objeto novo a cada
  // chamada e `cache` compara por referencia. Fica repetida de proposito: os
  // dois paineis sao fronteiras de Suspense independentes, e junta-las faria
  // o calendario esperar o painel vizinho para aparecer. A janela e a mesma
  // dos dois lados para que dedupli-las depois seja so isso, e nao uma
  // mudanca de comportamento.
  const [transactions, historico] = await Promise.all([
    listTransactions(houseId, { month, excludeCategoryIds }),
    listTransactions(houseId, {
      fromMonth: addMonths(month, -HISTORICO),
      toMonth: month,
      excludeCategoryIds,
      limit: 3000,
    }),
  ]);

  // Uma leitura só do histórico, usada nos dois lugares que precisam dela: o
  // número do dia e a marca na lista. Reconhecer duas vezes abriria caminho
  // para as duas divergirem, que é como o total da fatura já saiu errado
  // antes neste projeto.
  const fixas = fixedChargeMerchants(historico);

  const diario = dailySpending(transactions, month, {
    memberId,
    cardId,
    fixedCharges: fixas,
  });
  // O mes DESENHADO e o das compras, que na fatura de cartao e anterior ao mes
  // dela. Tudo daqui para baixo usa este, e nao `month`.
  const gridMonth = diario.month;

  // Os compromissos saem do mes DESENHADO, e por isso esta busca vem depois de
  // saber qual e. Buscar pelo mes da fatura traria agosto para uma grade de
  // julho, e a bolinha de compromisso nao apareceria em dia nenhum.
  const events = await listCalendarEvents(houseId, {
    from: `${gridMonth}-01`,
    to: `${gridMonth}-${String(daysInMonth(gridMonth)).padStart(2, "0")}`,
  });

  // Os lancamentos de cada dia, sob o mesmo filtro que somou os totais - uma
  // lista que nao fecha com o numero ao lado dela nao serve.
  // A chave do mapa JA e a categoria - a cor sai daí sem consulta extra.
  // Subcategoria herda a cor da mãe, então o ponto continua dizendo "isto é
  // Alimentação" mesmo quando o lançamento está numa subcategoria dela.
  const porCategoria = new Map(categories.map((c) => [c.id, c]));
  // A assinatura sai do NUMERO do dia, mas continua na lista dele, marcada.
  // Tirá-la dos dois lugares apagaria do app um gasto que existe, e a pessoa
  // que abre o dia 20 procurando a cobrança do streaming não a acharia em
  // lugar nenhum — o oposto de uma tela honesta.
  const ehFixa = new Map(
    transactions.map((t) => {
      const chave = merchantKey(t);
      return [t.id, chave !== null && fixas.has(chave)];
    }),
  );

  const porDia = new Map<string, CalendarDay["items"]>();
  for (const [categoryId, lista] of itemsByCategory(transactions, month, {
    memberId,
    cardId,
  })) {
    const categoria = categoryId ? porCategoria.get(categoryId) : undefined;
    for (const item of lista) {
      const atual = porDia.get(item.date) ?? [];
      atual.push({
        id: item.id,
        description: item.description,
        spendCents: item.spendCents,
        categoryColor: categoria?.color ?? null,
        categoryName: categoria?.name ?? null,
        isFixed: ehFixa.get(item.id) ?? false,
      });
      porDia.set(item.date, atual);
    }
  }

  const days: CalendarDay[] = diario.days.map((d) => ({
    ...d,
    events: events
      .filter((e) => d.date >= e.startsOn && d.date <= e.endsOn)
      .map((e) => e.title),
    // A cobrança fixa desce para o fim da lista, abaixo do que foi escolhido
    // naquele dia: ela está lá para ser conferida, não para ser o assunto.
    items: (porDia.get(d.date) ?? []).sort(
      (a, b) =>
        Number(a.isFixed) - Number(b.isFixed) || b.spendCents - a.spendCents,
    ),
  }));

  const comGasto = days.filter((d) => d.totalCents > 0);
  const maior = comGasto.reduce(
    (a, d) => (d.totalCents > (a?.totalCents ?? 0) ? d : a),
    comGasto[0],
  );

  return (
    <Card>
      <CardHeader
        title="Dia a dia"
        description={
          comGasto.length > 0
            ? `${comGasto.length} de ${days.length} dias com gasto. O maior foi o dia ${maior?.day}, com ${formatCents(maior?.totalCents ?? 0)}.`
            : `Nenhum gasto registrado em ${monthLabel(gridMonth)}.`
        }
      />

      {/* Qual mes esta na tela, dito sempre - nao so quando difere.
          A fatura de um mes cobra compras do mes anterior, e um calendario que
          nao diz de quando sao os dias faz o casal procurar no dia errado. */}
      <p className="mb-2.5 text-[12px] text-ink-faint">
        Compras de <span className="text-ink-muted">{monthLabel(gridMonth)}</span>
        {gridMonth === month ? null : (
          <> — é o que a fatura de {monthLabel(month)} cobra.</>
        )}
      </p>

      <CalendarGrid days={days} month={gridMonth} />

      {/* O que ficou fora da grade, discriminado.
          Sao duas coisas diferentes e o texto nao pode juntar: a compra do mes
          anterior entrou na MESMA fatura porque o cartao fecha no meio do mes;
          a de um ano atras e parcela, que guarda a data da compra original. */}
      {diario.outsideCount > 0 || diario.fixedCount > 0 ? (
        <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-[12px] text-ink-faint">
          {/* A assinatura sai da grade mas é DECLARADA, e com o porquê junto.
              Um número que encolhe sem explicação vira desconfiança na tela
              inteira; dito assim, o casal sabe exatamente o que está vendo. */}
          {diario.fixedCount > 0 ? (
            <li>
              Fora dos dias: {formatCents(diario.fixedCents)} em{" "}
              {diario.fixedCount} cobrança{diario.fixedCount === 1 ? "" : "s"} de
              assinatura — caem num dia qualquer do calendário de cobrança, e não
              foram uma escolha daquele dia. Continuam no total do mês e na lista
              de cada dia.
            </li>
          ) : null}
          {diario.outsideByMonth.map((fora) => (
            <li key={fora.month}>
              Mais {formatCents(fora.totalCents)} em {fora.count} compra(s) de{" "}
              {monthLabel(fora.month)}
              {fora.month === addMonths(gridMonth, -1)
                ? " — o cartão fecha no meio do mês, e elas caem nesta mesma fatura."
                : " — parcela guarda a data da compra original."}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
