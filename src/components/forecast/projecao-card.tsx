import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { monthShortLabel } from "@/domain/month";
import { linhaDoTempo, type Projecao, type QuandoComprar } from "@/domain/projecao";
import type { MonthKey } from "@/domain/types";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ProjecaoBarras } from "./projecao-barras";

/**
 * A projecao na Analise, em tres camadas, da resposta ao detalhe:
 *
 *   1. quanto sobra no periodo - o numero que responde "estamos bem?";
 *   2. a sobra de cada mes, num grafico que mostra recebe/gasta a um toque;
 *   3. a reserva crescendo mes a mes, com as compras do Radar encaixadas
 *      onde cabem e o que fica livre depois - "quando da para comprar?".
 *
 * Os numeros mes a mes ficam recolhidos no fim: sao a mesma informacao do
 * grafico, para quem quiser conferir valor a valor.
 */
export function ProjecaoCard({
  projecao,
  atual,
  compras,
}: {
  projecao: Projecao;
  atual: MonthKey;
  compras: QuandoComprar[];
}) {
  const adiante = projecao.meses.filter((m) => m.tipo !== "realizado");
  const ultimo = adiante.at(-1);
  const sobra = projecao.sobraNoPeriodoCents;
  const porMes = adiante.length > 0 ? Math.round(sobra / adiante.length) : 0;
  const melhor = projecao.meses.find((m) => m.month === projecao.melhorMes);
  const previstos = adiante.filter((m) => m.tipo === "previsto").map((m) => m.sobraCents);
  // Sem parcela nem conta mudando de um mes para outro, todo mes previsto
  // sobra o mesmo - e apontar "o melhor" seria so escolher o primeiro.
  const parecidos =
    previstos.length > 1 && Math.max(...previstos) - Math.min(...previstos) <= Math.abs(Math.max(...previstos)) * 0.05;

  const linha = linhaDoTempo(projecao.meses, compras);
  const maxReserva = Math.max(1, ...linha.map((l) => l.acumuladoCents));
  const naoCabem = compras.filter((c) => c.mes === null);

  return (
    <Card>
      {/* 1. A resposta */}
      <header>
        <h2 className="text-destaque font-semibold tracking-tight text-ink">Projeção</h2>
        <p className="mt-3 text-corpo text-ink-muted">
          {sobra >= 0 ? "Deve sobrar" : "Deve faltar"} de {monthShortLabel(atual)} a {ultimo ? monthShortLabel(ultimo.month) : ""}
        </p>
        <p className={cn("tabular text-[2rem] font-semibold leading-tight tracking-tight", sobra >= 0 ? "text-ink" : "text-danger")}>
          {formatCents(Math.abs(sobra))}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2 text-legenda">
          <li className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted">
            ≈ <span className="tabular font-medium text-ink">{formatCentsCompact(Math.abs(porMes))}</span> por mês
          </li>
          {melhor && !parecidos ? (
            <li className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted">
              mais sobra em <span className="font-medium text-ink">{monthShortLabel(melhor.month)}</span>{" "}
              <span className="tabular text-positive">+{formatCentsCompact(melhor.sobraCents)}</span>
            </li>
          ) : null}
          {projecao.receitas.length > 0 ? (
            <li className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-muted">
              entra ≈{" "}
              <span className="tabular font-medium text-info">
                {formatCentsCompact(projecao.receitas.reduce((s, r) => s + r.cents, 0))}
              </span>{" "}
              por mês
            </li>
          ) : null}
        </ul>
      </header>

      {/* 2. Mes a mes */}
      <section className="mt-5">
        <h3 className="mb-2 text-corpo font-medium text-ink">Sobra por mês</h3>
        <ProjecaoBarras meses={projecao.meses} atual={atual} />
      </section>

      {/* 3. A reserva e as compras */}
      <section className="mt-6">
        <h3 className="text-corpo font-medium text-ink">
          {compras.length > 0 ? "A reserva e quando comprar" : "A reserva, mês a mês"}
        </h3>
        <p className="text-legenda text-ink-faint">
          {compras.length > 0
            ? "O que sobra vai somando. Cada item do Radar entra no primeiro mês em que cabe, do mais barato ao mais caro."
            : "O que sobra vai somando. Ponha no Radar o que querem comprar e ele aparece aqui, no mês em que cabe."}
        </p>
        <ol className="mt-3 space-y-3">
          {linha.map((l) => {
            const comprou = l.acumuladoCents - l.livreCents;
            return (
              <li key={l.month} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3">
                <span className={cn("pt-0.5 text-corpo", l.tipo === "atual" ? "font-semibold text-ink" : "text-ink-muted")}>
                  {monthShortLabel(l.month)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {/* Trilho = a maior reserva do periodo; cheio = o que esta livre;
                        claro = o que as compras ja usaram. */}
                    <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                      {l.acumuladoCents > 0 ? (
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-chart-in/30"
                          style={{ width: `${(l.acumuladoCents / maxReserva) * 100}%` }}
                        />
                      ) : null}
                      {l.livreCents > 0 ? (
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-chart-in"
                          style={{ width: `${(l.livreCents / maxReserva) * 100}%` }}
                        />
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "tabular w-20 shrink-0 text-right text-corpo",
                        l.livreCents >= 0 ? "text-ink" : "text-danger",
                      )}
                    >
                      {l.livreCents < 0 ? "−" : ""}
                      {formatCentsCompact(Math.abs(l.livreCents))}
                    </span>
                  </div>
                  {l.compras.length > 0 ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {l.compras.map((c) => (
                        <li
                          key={c.id}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-legenda text-ink"
                        >
                          <ShoppingBag className="size-3.5 shrink-0 text-chart-in" aria-hidden />
                          <span className="truncate">{c.nome}</span>
                          <span className="tabular shrink-0 text-ink-faint">{formatCentsCompact(c.cents)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {comprou > 0 && l.compras.length > 0 ? (
                    <p className="mt-1 text-legenda text-ink-faint">
                      reserva {formatCentsCompact(l.acumuladoCents)} − compras {formatCentsCompact(comprou)}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-legenda text-ink-faint">O valor à direita é o que fica livre no fim de cada mês.</p>

        {naoCabem.length > 0 ? (
          <div className="mt-3 rounded-(--radius-control) bg-surface-2 px-3 py-2 text-corpo">
            <p className="text-ink-muted">Não cabe até {ultimo ? monthShortLabel(ultimo.month) : ""}:</p>
            <ul className="mt-1 space-y-0.5">
              {naoCabem.map((c) => (
                <li key={c.item.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">{c.item.nome}</span>
                  <span className="tabular shrink-0 text-ink-faint">{formatCentsCompact(c.item.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {compras.length > 0 ? (
          <p className="mt-2 text-legenda text-ink-faint">
            Preço de hoje no{" "}
            <Link href="/radar" className="text-brand hover:underline">
              Radar
            </Link>
            , à vista.
          </p>
        ) : null}
      </section>

      {/* De onde vem a receita prevista */}
      <section className="mt-6">
        <h3 className="text-corpo font-medium text-ink">Receitas previstas</h3>
        {projecao.receitas.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {projecao.receitas.map((r) => (
              <li
                key={r.chave}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-legenda"
                title={`Apareceu em ${r.vezes} dos últimos 3 meses`}
              >
                <span className="text-ink">{r.descricao}</span>
                <span className="tabular text-info">{formatCentsCompact(r.cents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-corpo text-ink-muted">Nenhuma receita se repetiu nos últimos 3 meses ainda.</p>
        )}
        <p className="mt-2 text-legenda text-ink-faint">
          Entra a receita que apareceu em pelo menos 2 dos últimos 3 meses. Uma avulsa que vocês já sabem que vem (13º,
          um freela) entra se for lançada em Extratos com a data em que vai cair.
        </p>
      </section>

      {/* Os numeros, para conferir */}
      <details className="mt-5 border-t border-line pt-3">
        <summary className="cursor-pointer text-corpo font-medium text-ink-muted">Ver mês a mês em números</summary>
        <table className="tabular mt-2 w-full text-corpo">
          <thead>
            <tr className="text-legenda text-ink-faint">
              <th className="py-1.5 text-left font-normal">Mês</th>
              <th className="py-1.5 pl-2 text-right font-normal">Recebe</th>
              <th className="py-1.5 pl-2 text-right font-normal">Gasta</th>
              <th className="py-1.5 pl-2 text-right font-normal">Sobra</th>
              <th className="py-1.5 pl-2 text-right font-normal">Acum.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projecao.meses.map((m) => (
              <tr key={m.month} className={cn(m.tipo === "atual" && "font-semibold")}>
                <td className="py-1.5 text-left text-ink">
                  {monthShortLabel(m.month)}
                  {m.tipo === "previsto" ? <span className="text-ink-faint">*</span> : null}
                </td>
                <td className="py-1.5 pl-2 text-right text-info">{formatCentsCompact(m.receitasCents)}</td>
                <td className="py-1.5 pl-2 text-right text-danger">{formatCentsCompact(m.gastosCents)}</td>
                <td className={cn("py-1.5 pl-2 text-right", m.sobraCents >= 0 ? "text-positive" : "text-danger")}>
                  {m.sobraCents < 0 ? "−" : ""}
                  {formatCentsCompact(Math.abs(m.sobraCents))}
                </td>
                <td className="py-1.5 pl-2 text-right text-ink-muted">
                  {m.acumuladoCents === null
                    ? "—"
                    : `${m.acumuladoCents < 0 ? "−" : ""}${formatCentsCompact(Math.abs(m.acumuladoCents))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-legenda text-ink-faint">
          * previsto. Gasto previsto = parcelas que faltam + contas fixas + média do variável. O mês atual soma o que já
          entrou e saiu com o que ainda deve vir.
        </p>
      </details>
    </Card>
  );
}
