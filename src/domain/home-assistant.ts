import { fromCents, toCents, type Cents } from "@/lib/money";
import { budgetProgress, summarizeMonth, totalsByCategory } from "./finance";
import { forecastMonths, goalProgress } from "./forecast";
import { doriBarra, type DoriEstado } from "./home";
import { addMonths, daysInMonth } from "./month";
import type { Budget, Goal, IsoDate, MonthKey, Recurrence, Transaction } from "./types";

/**
 * O Fluxo no Home Assistant: o resumo que vira sensores, a energia que o
 * Home Assistant mede, e a configuracao que a casa cola nele.
 *
 * O resumo e montado AQUI, com as mesmas regras do Inicio (gasto, previsto,
 * ritmo da Dori, orcamentos, metas), e gravado pronto pelo app. O Home
 * Assistant so le numeros agregados: nenhum lancamento, loja ou e-mail sai
 * da casa por ele.
 */

export interface ResumoHA {
  mes: MonthKey;
  gastoCents: Cents;
  previstoCents: Cents | null;
  /** Gasto sobre o previsto, em %. */
  pctPrevisto: number | null;
  /** Onde o gasto deveria estar hoje, em % do previsto. */
  ritmoHoje: number | null;
  situacao: string;
  receitasCents: Cents;
  saldoCents: Cents;
  orcamentos: { categoria: string; limiteCents: Cents; gastoCents: Cents; pct: number }[];
  /** Contas com data: as do secretario (e-mail) e as fixas da casa. */
  contas: { descricao: string; valorCents: Cents | null; vencimento: IsoDate }[];
  metas: { nome: string; atualCents: Cents; alvoCents: Cents; pct: number }[];
}

const SITUACAO: Record<DoriEstado, string> = {
  vazio: "sem dados",
  "sem-previsao": "sem previsão",
  pequena: "no ritmo",
  ritmo: "no ritmo",
  acima: "acima do ritmo",
  passou: "passou do previsto",
  fechou: "mês fechado",
};

/** Quantos dias a frente uma conta fixa entra na lista. */
const JANELA_CONTAS = 15;

const diaIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function montarResumoHA({
  mes,
  transacoes,
  recorrentes,
  orcamentos,
  metas,
  categorias,
  contasDoEmail,
  agora,
}: {
  mes: MonthKey;
  /** Do mes e dos tres anteriores, ja sem as categorias fora dos totais. */
  transacoes: readonly Transaction[];
  recorrentes: readonly Recurrence[];
  orcamentos: readonly Budget[];
  metas: readonly Goal[];
  categorias: readonly { id: string; name: string }[];
  /** E-mails pendentes do secretario com vencimento. */
  contasDoEmail: readonly { resumo: string; amountCents: Cents | null; dueDate: IsoDate | null }[];
  agora: Date;
}): ResumoHA {
  const resumo = summarizeMonth(transacoes, mes);
  const [previsao] = forecastMonths({
    transactions: transacoes,
    recurrences: recorrentes,
    fromMonth: addMonths(mes, -1),
    months: 1,
  });
  const previsto = previsao && previsao.totalCents > 0 ? previsao.totalCents : null;
  const barra = doriBarra({
    spentCents: resumo.spentCents,
    expectedCents: previsto,
    month: mes,
    hasData: transacoes.length > 0,
    now: agora,
  });

  const nomes = new Map(categorias.map((c) => [c.id, c.name]));
  const porCategoria = new Map(totalsByCategory(transacoes, mes).map((t) => [t.categoryId, t.totalCents]));

  const hoje = diaIso(agora);
  const limite = diaIso(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + JANELA_CONTAS));
  const contas = [
    ...contasDoEmail
      .filter((c): c is typeof c & { dueDate: IsoDate } => c.dueDate !== null && c.dueDate >= hoje)
      .map((c) => ({ descricao: c.resumo, valorCents: c.amountCents, vencimento: c.dueDate })),
    ...recorrentes
      .filter((r) => r.isActive && r.nextDate >= hoje && r.nextDate <= limite)
      .map((r) => ({ descricao: r.description, valorCents: toCents(r.amount), vencimento: r.nextDate })),
  ].sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  return {
    mes,
    gastoCents: resumo.spentCents,
    previstoCents: previsto,
    pctPrevisto: previsto === null ? null : barra.pct,
    ritmoHoje: barra.ritmo,
    situacao: SITUACAO[barra.estado],
    receitasCents: resumo.incomeCents,
    saldoCents: resumo.balanceCents,
    orcamentos: orcamentos
      .filter((b) => b.limitAmount > 0)
      .map((b) => {
        const gasto = porCategoria.get(b.categoryId) ?? 0;
        const p = budgetProgress(gasto, toCents(b.limitAmount), mes, agora);
        return {
          categoria: nomes.get(b.categoryId) ?? "Categoria",
          limiteCents: toCents(b.limitAmount),
          gastoCents: gasto,
          pct: Math.round(p.ratio * 100),
        };
      })
      .sort((a, b) => b.pct - a.pct),
    contas: contas.slice(0, 20),
    metas: metas
      .filter((g) => g.status === "active")
      .map((g) => {
        const p = goalProgress(toCents(g.currentAmount), toCents(g.targetAmount), { today: agora });
        return {
          nome: g.name,
          atualCents: p.currentCents,
          alvoCents: p.targetCents,
          pct: Math.round(p.ratio * 100),
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// Energia
// ---------------------------------------------------------------------------

export interface EnergiaDoMes {
  mes: MonthKey;
  /** O ultimo dia lido e o consumo do mes ate ele. */
  dia: IsoDate;
  kwhMes: number;
  /** O mes inteiro, no ritmo de ate agora. `null` no primeiro dia (pouco dado). */
  projecaoKwh: number | null;
  /** O total do mes passado, quando ha leitura dele. */
  mesPassadoKwh: number | null;
  /** Projecao vezes a tarifa da casa. */
  custoEstimadoCents: Cents | null;
}

/**
 * O consumo de energia do mes, a partir do "utility meter" mensal do Home
 * Assistant: cada leitura e o acumulado do mes ate aquele dia, entao a ultima
 * do mes e o total dele. A projecao e o ritmo de ate agora levado ao fim do
 * mes - simples, e honesta: no comeco do mes, fica de fora.
 */
export function energiaDoMes(
  leituras: readonly { dia: IsoDate; kwhMes: number }[],
  hoje: Date,
  tarifaKwh: number | null,
): EnergiaDoMes | null {
  const mes = diaIso(hoje).slice(0, 7) as MonthKey;
  const doMes = leituras.filter((l) => l.dia.startsWith(mes)).sort((a, b) => a.dia.localeCompare(b.dia));
  const ultima = doMes.at(-1);
  if (!ultima) return null;

  const passado = addMonths(mes, -1);
  const doPassado = leituras.filter((l) => l.dia.startsWith(passado)).sort((a, b) => a.dia.localeCompare(b.dia));
  const diaLido = Number(ultima.dia.slice(8, 10));
  const total = daysInMonth(mes);
  const projecao = diaLido >= 2 ? Math.round((ultima.kwhMes / diaLido) * total * 10) / 10 : null;

  return {
    mes,
    dia: ultima.dia,
    kwhMes: ultima.kwhMes,
    projecaoKwh: projecao,
    mesPassadoKwh: doPassado.at(-1)?.kwhMes ?? null,
    custoEstimadoCents: projecao !== null && tarifaKwh !== null ? Math.round(projecao * tarifaKwh * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// O que o Home Assistant recebe
// ---------------------------------------------------------------------------

const reais = (c: Cents | null) => (c === null ? null : fromCents(c));

function diasAte(vencimento: IsoDate, hoje: Date): number {
  const [a, m, d] = vencimento.split("-").map(Number) as [number, number, number];
  const alvo = Date.UTC(a, m - 1, d);
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - base) / 86_400_000);
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const encurtar = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`);

/**
 * O JSON da rota `/api/ha/resumo`: valores em reais (o Home Assistant nao
 * sabe de centavos), nomes curtos para os `value_template`, e os dias ate
 * cada conta contados na hora - o resumo gravado pode ser de ontem.
 */
export function respostaParaHA(
  gravado: { resumo: ResumoHA | null; resumoEm: string | null; tarifaKwh: number | null; energia: readonly { dia: IsoDate; kwhMes: number }[] },
  agora: Date,
) {
  const r = gravado.resumo;
  const contas = (r?.contas ?? [])
    .map((c) => ({ descricao: c.descricao, valor: reais(c.valorCents), vencimento: c.vencimento, dias: diasAte(c.vencimento, agora) }))
    .filter((c) => c.dias >= 0);
  const proxima = contas[0];
  const energia = energiaDoMes(gravado.energia, agora, gravado.tarifaKwh);
  return {
    atualizado_em: gravado.resumoEm,
    mes: r?.mes ?? null,
    gasto: reais(r?.gastoCents ?? null),
    previsto: reais(r?.previstoCents ?? null),
    pct_previsto: r?.pctPrevisto ?? null,
    ritmo_hoje: r?.ritmoHoje ?? null,
    situacao: r?.situacao ?? "sem dados",
    receitas: reais(r?.receitasCents ?? null),
    saldo: reais(r?.saldoCents ?? null),
    orcamentos: (r?.orcamentos ?? []).map((o) => ({ categoria: o.categoria, limite: reais(o.limiteCents), gasto: reais(o.gastoCents), pct: o.pct })),
    orcamentos_estourados: (r?.orcamentos ?? []).filter((o) => o.pct > 100).length,
    contas,
    contas_7_dias: contas.filter((c) => c.dias <= 7).length,
    // O estado de um sensor do Home Assistant cabe em 255 caracteres; o
    // resumo do e-mail pode ser longo, entao e ele que encurta.
    proxima_conta: proxima
      ? `${encurtar(proxima.descricao, 120)}${proxima.valor === null ? "" : ` · ${moeda.format(proxima.valor)}`} · ${proxima.dias === 0 ? "hoje" : proxima.dias === 1 ? "amanhã" : `em ${proxima.dias} dias`}`
      : null,
    metas: (r?.metas ?? []).map((m) => ({ nome: m.nome, atual: reais(m.atualCents), alvo: reais(m.alvoCents), pct: m.pct })),
    energia: energia
      ? {
          dia: energia.dia,
          kwh_mes: energia.kwhMes,
          projecao_kwh: energia.projecaoKwh,
          mes_passado_kwh: energia.mesPassadoKwh,
          custo_estimado: reais(energia.custoEstimadoCents),
          tarifa_kwh: gravado.tarifaKwh,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// A configuracao para colar no Home Assistant
// ---------------------------------------------------------------------------

/**
 * O YAML do Home Assistant. O codigo vai no `secrets.yaml`, nunca no
 * `configuration.yaml` (que costuma ir para backup e para o git). Sem o
 * codigo (ele so aparece uma vez), a linha do segredo fica com o lugar dele.
 */
export function configuracaoHA(base: string, codigo: string | null): { segredo: string; configuracao: string } {
  const url = base.replace(/\/+$/, "");
  const segredo = `fluxo_auth: "Bearer ${codigo ?? "COLE_AQUI_O_CODIGO"}"`;
  const cabecalho = `    headers:\n      Authorization: !secret fluxo_auth`;
  const sensor = (nome: string, id: string, valor: string, extra: string[] = []) =>
    [`      - name: "${nome}"`, `        unique_id: ${id}`, `        value_template: "${valor}"`, ...extra.map((e) => `        ${e}`)].join("\n");
  const configuracao = [
    "rest:",
    `  - resource: ${url}/api/ha/resumo`,
    cabecalho,
    "    scan_interval: 900",
    "    sensor:",
    sensor("Fluxo gasto do mês", "fluxo_gasto_mes", "{{ value_json.gasto }}", [
      'unit_of_measurement: "R$"',
      "json_attributes: [previsto, pct_previsto, ritmo_hoje, situacao, receitas, saldo, atualizado_em]",
    ]),
    sensor("Fluxo situação do mês", "fluxo_situacao", "{{ value_json.situacao }}"),
    sensor("Fluxo próxima conta", "fluxo_proxima_conta", "{{ value_json.proxima_conta or 'nenhuma' }}", ["json_attributes: [contas]"]),
    sensor("Fluxo contas em 7 dias", "fluxo_contas_7_dias", "{{ value_json.contas_7_dias }}"),
    sensor("Fluxo orçamentos estourados", "fluxo_orcamentos_estourados", "{{ value_json.orcamentos_estourados }}", ["json_attributes: [orcamentos]"]),
    sensor("Fluxo metas", "fluxo_metas", "{{ value_json.metas | count }}", ["json_attributes: [metas]"]),
    sensor("Fluxo energia projeção", "fluxo_energia_projecao", "{{ value_json.energia.projecao_kwh if value_json.energia else none }}", [
      'unit_of_measurement: "kWh"',
      "json_attributes: [energia]",
    ]),
    sensor("Fluxo energia custo estimado", "fluxo_energia_custo", "{{ value_json.energia.custo_estimado if value_json.energia else none }}", [
      'unit_of_measurement: "R$"',
    ]),
    `  - resource: ${url}/api/ha/tarefas`,
    cabecalho,
    "    scan_interval: 300",
    "    sensor:",
    sensor("Fluxo tarefas abertas", "fluxo_tarefas_abertas", "{{ value_json.total }}", ["json_attributes: [tarefas]"]),
    "",
    "rest_command:",
    "  fluxo_nova_tarefa:",
    `    url: ${url}/api/ha/tarefas`,
    "    method: POST",
    cabecalho,
    "    content_type: application/json",
    `    payload: '{"titulo": {{ titulo | to_json }}}'`,
    "  fluxo_concluir_tarefa:",
    `    url: ${url}/api/ha/tarefas/concluir`,
    "    method: POST",
    cabecalho,
    "    content_type: application/json",
    `    payload: '{"id": {{ id | to_json }}}'`,
    "  fluxo_energia:",
    `    url: ${url}/api/ha/energia`,
    "    method: POST",
    cabecalho,
    "    content_type: application/json",
    `    payload: '{"kwh": {{ states("sensor.energia_mes") }}, "dia": "{{ now().date() }}"}'`,
    "",
    "# O consumo do mes: um utility_meter mensal sobre o medidor de energia da",
    "# casa (kWh, que so cresce). Troque o sensor de origem pelo de voces; se o",
    "# configuration.yaml ja tem `utility_meter:`, ponha o energia_mes dentro dele.",
    "utility_meter:",
    "  energia_mes:",
    "    source: sensor.SEU_MEDIDOR_DE_ENERGIA",
    "    cycle: monthly",
    "",
    "automation fluxo:",
    '  - alias: "Fluxo: enviar o consumo de energia"',
    "    triggers:",
    "      - trigger: time_pattern",
    '        hours: "/1"',
    "    # Medidor indisponivel nao manda nada: um 0 apagaria a leitura do dia.",
    "    conditions:",
    "      - condition: template",
    "        value_template: \"{{ states('sensor.energia_mes') | is_number }}\"",
    "    actions:",
    "      - action: rest_command.fluxo_energia",
  ].join("\n");
  return { segredo, configuracao };
}
