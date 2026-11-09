import { formatCents } from "@/lib/money";
import { monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { DetalheDoMes, LinhaDoMes } from "@/domain/meses";

const TIPO = { realizado: "Aconteceu", atual: "Agora", previsto: "Previsto" } as const;

function Linhas({ linhas }: { linhas: LinhaDoMes[] }) {
  return (
    <ul className="divide-y divide-line">
      {linhas.map((l, i) => (
        <li key={`${l.descricao}-${l.detalhe ?? ""}-${i}`} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-corpo text-ink">{l.descricao}</span>
            {l.detalhe || l.previsto ? (
              <span className="block text-legenda text-ink-faint">
                {[l.detalhe, l.previsto && l.detalhe !== "estimativa" ? "previsto" : null].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </span>
          <span className={cn("tabular shrink-0 text-corpo", l.previsto ? "text-ink-muted" : "text-ink")}>
            {formatCents(l.cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Grupo({
  titulo,
  total,
  linhas,
  marca,
}: {
  titulo: string;
  total: number;
  linhas: LinhaDoMes[];
  /** A cor da serie no grafico, para ligar a lista a ele. */
  marca: string;
}) {
  if (linhas.length === 0) return null;
  return (
    <section className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-legenda font-semibold uppercase tracking-[0.08em] text-ink-faint">
          <span className={cn("shrink-0 rounded-[2px]", marca)} aria-hidden />
          {titulo}
          <span className="font-normal normal-case tracking-normal">· {linhas.length}</span>
        </h4>
        <span className="tabular text-legenda font-semibold text-ink-muted">{formatCents(total)}</span>
      </div>
      <Linhas linhas={linhas} />
    </section>
  );
}

/**
 * Um mes da lista: o resumo (entra, sai, sobra) sempre a vista; abrindo, cada
 * linha do que entra e do que sai, separado como no grafico. O mes atual ja
 * vem aberto.
 */
export function ListaDoMes({ mes }: { mes: DetalheDoMes }) {
  const nome = monthLabel(mes.month).replace(/^./, (c) => c.toUpperCase());
  const sobra = mes.sobraCents >= 0;
  return (
    <details
      id={`mes-${mes.month}`}
      open={mes.tipo === "atual"}
      className="group scroll-mt-24 rounded-(--radius-card) border border-line bg-surface"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-destaque font-semibold tracking-tight text-ink">
            {nome}
            <span
              className={cn(
                "text-legenda font-semibold uppercase tracking-[0.08em]",
                mes.tipo === "atual" ? "text-brand" : "text-ink-faint",
              )}
            >
              {TIPO[mes.tipo]}
            </span>
          </h3>
          <p className="tabular text-legenda text-ink-faint">
            Entra {formatCents(mes.receitasCents)} · sai {formatCents(mes.gastosCents)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-legenda text-ink-faint">{sobra ? "Sobra" : "Falta"}</p>
          <p className={cn("tabular text-corpo font-semibold", sobra ? "text-positive" : "text-danger")}>
            {formatCents(Math.abs(mes.sobraCents))}
          </p>
        </div>
        <span className="text-ink-faint transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>

      <div className="border-t border-line px-4 pb-4 sm:px-5">
        <Grupo titulo="Entra" total={mes.receitasCents} linhas={mes.entradas} marca="h-[2px] w-2.5 rounded-full bg-chart-in" />
        <Grupo titulo="Parcelas" total={mes.parcelasCents} linhas={mes.parcelas} marca="size-2.5 bg-serie-parcelas" />
        <Grupo titulo="Contas fixas" total={mes.fixasCents} linhas={mes.fixas} marca="size-2.5 bg-serie-fixas" />
        <Grupo titulo="Dia a dia" total={mes.diaADiaCents} linhas={mes.diaADia} marca="size-2.5 bg-ink-faint/60" />
        {mes.acumuladoCents !== null ? (
          <p className="mt-3 rounded-(--radius-control) bg-surface-2 px-3 py-2 text-legenda text-ink-muted">
            Somando as sobras de agora até aqui:{" "}
            <span className={cn("tabular font-semibold", mes.acumuladoCents >= 0 ? "text-positive" : "text-danger")}>
              {mes.acumuladoCents < 0 ? "−" : ""}
              {formatCents(Math.abs(mes.acumuladoCents))}
            </span>
          </p>
        ) : null}
        {mes.tipo === "previsto" && mes.diaADia.length === 0 ? (
          <p className="mt-3 text-legenda text-ink-faint">
            Falta histórico para estimar o gasto do dia a dia: a previsão tem só o que já está comprometido.
          </p>
        ) : null}
      </div>
    </details>
  );
}
