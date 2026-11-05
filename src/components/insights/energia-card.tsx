import { Zap } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { estadoHA, leiturasDeEnergia } from "@/data/home-assistant";
import { energiaDoMes, type EnergiaDoMes } from "@/domain/home-assistant";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const kwh = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kWh`;

/** A projecao contra o mes passado, por escrito: a cor so repete o que o texto diz. */
export function comparacaoDeEnergia(
  e: EnergiaDoMes,
): { texto: string; tom: "attention" | "positive" | "neutro" } | null {
  if (
    e.projecaoKwh === null ||
    e.mesPassadoKwh === null ||
    e.mesPassadoKwh <= 0
  )
    return null;
  const dif = Math.round(
    ((e.projecaoKwh - e.mesPassadoKwh) / e.mesPassadoKwh) * 100,
  );
  if (dif >= 10)
    return {
      texto: `No ritmo de agora, ${dif}% acima do mês passado.`,
      tom: "attention",
    };
  if (dif <= -10)
    return {
      texto: `No ritmo de agora, ${-dif}% abaixo do mês passado.`,
      tom: "positive",
    };
  return { texto: "No ritmo de agora, perto do mês passado.", tom: "neutro" };
}

/**
 * O consumo de energia que o Home Assistant manda (ver `/api/ha/energia`).
 * Sem leitura no mes, o cartao nao aparece - a Analise nao ganha um cartao
 * vazio para quem nao usa o Home Assistant.
 */
export async function EnergiaCard({ houseId }: { houseId: string }) {
  const [leituras, estado] = await Promise.all([
    leiturasDeEnergia(houseId),
    estadoHA(houseId),
  ]);
  const e = energiaDoMes(leituras, new Date(), estado.tarifaKwh);
  if (!e) return null;
  const comparacao = comparacaoDeEnergia(e);
  const dia = Number(e.dia.slice(8, 10));

  // A secao vem daqui, e nao da pagina: sem leitura, nao sobra secao vazia
  // abrindo espaco entre os cartoes.
  return (
    <section id="energia" className="scroll-mt-28">
      <Card>
        <CardHeader
          title="Energia"
          description={`Do Home Assistant, até o dia ${dia}.`}
        />
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
            <dt className="text-legenda text-ink-faint">No mês, até agora</dt>
            <dd className="tabular text-destaque font-semibold text-ink">
              {kwh(e.kwhMes)}
            </dd>
          </div>
          <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
            <dt className="text-legenda text-ink-faint">
              O mês, no ritmo de agora
            </dt>
            <dd className="tabular text-destaque font-semibold text-ink">
              {e.projecaoKwh === null ? "—" : kwh(e.projecaoKwh)}
            </dd>
          </div>
          <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
            <dt className="text-legenda text-ink-faint">Mês passado</dt>
            <dd className="tabular text-destaque font-semibold text-ink">
              {e.mesPassadoKwh === null ? "—" : kwh(e.mesPassadoKwh)}
            </dd>
          </div>
          <div className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
            <dt className="text-legenda text-ink-faint">Custo estimado</dt>
            <dd className="tabular text-destaque font-semibold text-ink">
              {e.custoEstimadoCents === null
                ? "—"
                : formatCents(e.custoEstimadoCents)}
            </dd>
          </div>
        </dl>
        {comparacao ? (
          <p
            className={cn(
              "mt-3 flex items-center gap-2 text-corpo",
              comparacao.tom === "attention"
                ? "text-attention"
                : comparacao.tom === "positive"
                  ? "text-positive"
                  : "text-ink-muted",
            )}
          >
            <Zap className="size-4 shrink-0" aria-hidden />
            {comparacao.texto}
          </p>
        ) : null}
        {e.custoEstimadoCents === null ? (
          <p className="mt-2 text-legenda text-ink-faint">
            Com a tarifa (R$ por kWh) na tela Casa, o app estima o custo do mês.
          </p>
        ) : null}
      </Card>
    </section>
  );
}
