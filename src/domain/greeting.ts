import { formatCents, type Cents } from "@/lib/money";

/**
 * A Conversa puxa assunto (secao 16).
 *
 * Ao abrir, um resumo curto do dia - calculado pelo APP, sem IA: nao custa
 * nada, sai na hora, e cada numero e o mesmo das telas. So entram as coisas
 * que pedem atencao (no maximo tres), e as sugestoes de pergunta saem delas:
 * quem ve "Mercado em 92%" quer perguntar sobre Mercado, nao sobre parcelas.
 */

export interface GreetingInput {
  firstName: string | null;
  /** Hora local (0-23), para o "bom dia". */
  hour: number;
  yesterday: { cents: Cents; count: number };
  month: { label: string; spentCents: Cents; projectionCents: Cents | null; averageCents: Cents | null };
  /** Orcamentos do mes com a fracao ja gasta. */
  budgets: { name: string; ratio: number }[];
  /** Tarefas por fazer com prazo: dias ate o prazo (negativo = vencida). */
  tasks: { title: string; daysLeft: number }[];
  uncategorized: number;
}

export interface Greeting {
  text: string;
  suggestions: string[];
}

function saudacao(hour: number): string {
  if (hour < 5 || hour >= 18) return "Boa noite";
  if (hour < 12) return "Bom dia";
  return "Boa tarde";
}

const quando = (d: number) => (d < 0 ? (d === -1 ? "venceu ontem" : `venceu há ${-d} dias`) : d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${d} dias`);

export function buildGreeting(g: GreetingInput): Greeting {
  const destaques: { frase: string; sugestao: string; peso: number }[] = [];

  // Orcamento estourado ou perto: e o que mais muda o que fazer hoje.
  for (const b of [...g.budgets].filter((b) => b.ratio >= 0.8).sort((x, y) => y.ratio - x.ratio).slice(0, 2)) {
    destaques.push({
      frase:
        b.ratio >= 1
          ? `O orçamento de ${b.name} já passou do limite (${Math.round(b.ratio * 100)}%).`
          : `${b.name} já usou ${Math.round(b.ratio * 100)}% do orçamento do mês.`,
      sugestao: `Por que ${b.name} está tão alto?`,
      peso: 300 + b.ratio * 100,
    });
  }

  // O mes no ritmo atual contra a media: so quando o desvio e de verdade.
  const { projectionCents: proj, averageCents: media } = g.month;
  if (proj !== null && media !== null && media > 0) {
    const desvio = (proj - media) / media;
    if (Math.abs(desvio) >= 0.15) {
      destaques.push({
        frase:
          desvio > 0
            ? `No ritmo atual, ${g.month.label} fecha em ${formatCents(proj)}, acima da média de ${formatCents(media)}.`
            : `No ritmo atual, ${g.month.label} fecha em ${formatCents(proj)}, abaixo da média de ${formatCents(media)}.`,
        sugestao: desvio > 0 ? "Onde estamos gastando mais este mês?" : "O que mudou para gastarmos menos?",
        peso: 250,
      });
    }
  }

  const tarefas = [...g.tasks].filter((t) => t.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft);
  if (tarefas.length > 0) {
    const t = tarefas[0]!;
    destaques.push({
      frase:
        tarefas.length === 1
          ? `A tarefa "${t.title}" ${quando(t.daysLeft)}.`
          : `A tarefa "${t.title}" ${quando(t.daysLeft)}, e há mais ${tarefas.length - 1} com prazo próximo.`,
      sugestao: "Quais tarefas vencem esta semana?",
      peso: t.daysLeft < 0 ? 280 : 200,
    });
  }

  if (g.uncategorized >= 5) {
    destaques.push({
      frase: `Há ${g.uncategorized} lançamentos sem categoria.`,
      sugestao: "O que falta classificar?",
      peso: 150,
    });
  }

  const nome = g.firstName ? `, ${g.firstName}` : "";
  const ontem =
    g.yesterday.count > 0
      ? `Ontem saíram ${formatCents(g.yesterday.cents)} em ${g.yesterday.count} ${g.yesterday.count === 1 ? "compra" : "compras"}, e ${g.month.label} está em ${formatCents(g.month.spentCents)}.`
      : `${g.month.label[0]!.toUpperCase()}${g.month.label.slice(1)} está em ${formatCents(g.month.spentCents)} até agora.`;
  const escolhidos = destaques.sort((a, b) => b.peso - a.peso).slice(0, 3);

  const text = [
    `${saudacao(g.hour)}${nome}! ${ontem}`,
    ...escolhidos.map((d) => d.frase),
    escolhidos.length === 0 ? "Nada pedindo atenção agora. Quer ver alguma coisa?" : "Quer que eu olhe algum desses?",
  ].join(" ");

  const suggestions = [...new Set([...escolhidos.map((d) => d.sugestao), "Quanto gastamos este mês?", "Quero comprar uma coisa, cabe no orçamento?"])].slice(0, 4);
  return { text, suggestions };
}
