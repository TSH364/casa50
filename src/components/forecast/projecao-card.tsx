import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { monthLabel, monthShortLabel } from "@/domain/month";
import type { Projecao, QuandoComprar } from "@/domain/projecao";
import type { MonthKey } from "@/domain/types";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { ProjecaoBarras } from "./projecao-barras";

/**
 * A projecao na Analise: recebe, gasta e sobra - o consolidado dos meses que
 * passaram e o previsto dos proximos -, e em que mes cada item do Radar cabe.
 *
 * O numero grande e a sobra do periodo, porque e ele que responde "da para
 * comprar?". A tabela embaixo e a mesma informacao do grafico, para ler
 * valor a valor (e para quem nao distingue as cores).
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
  const melhor = projecao.meses.find((m) => m.month === projecao.melhorMes);
  // Sem parcela nem conta que mude de um mes para outro, todo mes previsto
  // sobra o mesmo - e apontar "o melhor" seria escolher o primeiro.
  const previstos = adiante.filter((m) => m.tipo === "previsto").map((m) => m.sobraCents);
  const parecidos =
    previstos.length > 1 && Math.max(...previstos) - Math.min(...previstos) <= Math.abs(Math.max(...previstos)) * 0.05;
  const sobra = projecao.sobraNoPeriodoCents;

  return (
    <Card>
      <CardHeader
        title="Projeção"
        description="O que entra, o que sai e quanto sobra: o consolidado dos últimos meses e o previsto dos próximos."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
          <p className="text-legenda text-ink-faint">
            {sobra >= 0 ? "Deve sobrar" : "Deve faltar"} de {monthShortLabel(atual)} a{" "}
            {ultimo ? monthShortLabel(ultimo.month) : ""}
          </p>
          <p className={cn("tabular text-2xl font-semibold tracking-tight", sobra >= 0 ? "text-positive" : "text-danger")}>
            {formatCents(Math.abs(sobra))}
          </p>
        </div>
        <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
          <p className="text-legenda text-ink-faint">Mês em que mais sobra</p>
          {melhor && parecidos ? (
            <p className="text-corpo text-ink">
              Parecido em todos <span className="tabular text-positive">~{formatCentsCompact(melhor.sobraCents)}/mês</span>
            </p>
          ) : melhor ? (
            <p className="text-corpo text-ink">
              <span className="text-destaque font-semibold">{monthLabel(melhor.month)}</span>{" "}
              <span className="tabular text-positive">+{formatCents(melhor.sobraCents)}</span>
            </p>
          ) : (
            <p className="text-corpo text-ink-muted">Nenhum mês com sobra prevista.</p>
          )}
        </div>
      </div>

      <ProjecaoBarras meses={projecao.meses} atual={atual} />

      {/* Valores sem centavos: cinco colunas de "R$ 16.706,00" nao cabem no
          celular, e o centavo nao muda a decisao. O valor exato fica no grafico. */}
      <table className="tabular mt-4 w-full text-corpo">
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
        * previsto. O mês atual soma o que já entrou e o que ainda deve entrar. O acumulado conta a partir dele.
      </p>

      <div className="mt-4 rounded-(--radius-control) bg-surface-2 px-3 py-2.5 text-corpo">
        <p className="font-medium text-ink">Receitas previstas</p>
        {projecao.receitas.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-ink-muted">
            {projecao.receitas.map((r) => (
              <li key={r.chave} className="tabular flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.descricao} <span className="text-legenda text-ink-faint">· em {r.vezes} dos últimos 3 meses</span>
                </span>
                <span className="shrink-0 text-info">{formatCents(r.cents)}/mês</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-ink-muted">Nenhuma receita se repetiu nos últimos 3 meses ainda.</p>
        )}
        <p className="mt-2 text-legenda text-ink-faint">
          Entra aqui a receita que apareceu em pelo menos 2 dos últimos 3 meses. Receita avulsa que vocês já sabem que
          vem (13º, um freela combinado) entra se for lançada em Extratos com a data em que vai cair.
        </p>
      </div>

      {compras.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-corpo font-medium text-ink">
            <ShoppingBag className="size-4 text-ink-muted" aria-hidden /> Quando comprar o que está no Radar
          </p>
          <ul className="mt-1 divide-y divide-line">
            {compras.map((c) => (
              <li key={c.item.id} className="flex items-baseline justify-between gap-3 py-2 text-corpo">
                <span className="min-w-0">
                  <span className="text-ink">{c.item.nome}</span>{" "}
                  <span className="tabular text-legenda text-ink-faint">{formatCents(c.item.cents)}</span>
                </span>
                {c.mes ? (
                  <span className="shrink-0 text-right">
                    <span className="font-medium text-positive">{monthLabel(c.mes)}</span>
                    <span className="block text-legenda text-ink-faint">
                      sobra acumulada {formatCents(c.disponivelCents)}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-legenda text-ink-muted">não cabe até {ultimo ? monthShortLabel(ultimo.month) : ""}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-legenda text-ink-faint">
            Do mais barato ao mais caro, cada compra usa a sobra que sobrou da anterior. Preço de hoje no{" "}
            <Link href="/radar" className="text-brand hover:underline">
              Radar
            </Link>
            ; à vista.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
