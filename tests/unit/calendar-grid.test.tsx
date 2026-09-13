import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarGrid, type CalendarDay } from "@/components/dashboard/calendar-grid";

/**
 * A grade tem uma contradição possível que só aparece na tela, e não no
 * domínio: desde que a assinatura saiu da conta do dia, existe dia cujo
 * número é "sem gasto" e cuja LISTA tem lançamentos. Se a tela não disser o
 * porquê, ela se contradiz diante de quem a lê — e é por isso que este teste
 * é de componente, e não de `dailySpending`.
 */
function dia(overrides: Partial<CalendarDay> & { day: number }): CalendarDay {
  return {
    date: `2026-07-${String(overrides.day).padStart(2, "0")}`,
    totalCents: 0,
    count: 0,
    step: 0,
    fixedCents: 0,
    fixedCount: 0,
    events: [],
    items: [],
    ...overrides,
  };
}

const item = (
  id: string,
  description: string,
  spendCents: number,
  isFixed = false,
) => ({ id, description, spendCents, categoryColor: null, categoryName: null, isFixed });

describe("CalendarGrid — o dia que só teve assinatura", () => {
  const days = [
    dia({
      day: 3,
      fixedCents: 11_316,
      fixedCount: 1,
      items: [item("a", "OPENAI CHATGPT", 11_316, true)],
    }),
    dia({
      day: 19,
      totalCents: 25_000,
      count: 1,
      step: 4,
      fixedCents: 259,
      fixedCount: 1,
      items: [item("b", "OBA HORTIFRUTI", 25_000), item("c", "GOOGLE", 259, true)],
    }),
  ];

  it('não pinta o dia nem mostra valor na célula, mas conta a assinatura em voz alta', () => {
    render(<CalendarGrid days={days} month="2026-07" />);
    const celula = screen.getByLabelText(/^Dia 3:/);

    // Célula apagada e sem número de gasto...
    expect(celula.textContent).toBe("3");
    // ...mas o leitor de tela ouve a assinatura, senão o dia soaria vazio.
    // O espaço depois de "R$" é inquebrável (U+00A0), que é como o pt-BR
    // formata — daí o `\s` em vez de um espaço literal.
    expect(celula.getAttribute("aria-label")).toMatch(
      /^Dia 3: sem gasto, mais R\$\s113,16 de assinatura$/,
    );
  });

  it("ao abrir, diz 'sem gasto' E explica os lançamentos que estão logo abaixo", () => {
    render(<CalendarGrid days={days} month="2026-07" />);
    fireEvent.click(screen.getByLabelText(/^Dia 3:/));

    expect(screen.getByText("sem gasto")).toBeDefined();
    expect(
      screen.getByText(/R\$\s113,16 de assinatura, fora da conta do dia/),
    ).toBeDefined();
    // O lançamento continua na lista: escondê-lo dos dois lugares apagaria do
    // app um gasto que existe.
    expect(screen.getByText(/OPENAI CHATGPT/)).toBeDefined();
  });

  it("no dia que teve compra, a assinatura entra como 'mais', e marcada", () => {
    render(<CalendarGrid days={days} month="2026-07" />);
    fireEvent.click(screen.getByLabelText(/^Dia 19:/));

    // "R$ 250,00" aparece duas vezes — no total do dia e na linha do
    // lançamento — então a busca precisa dizer qual das duas.
    const cabecalho = screen.getByText("Dia 19").parentElement!;
    expect(within(cabecalho).getByText(/R\$\s250,00/)).toBeDefined();
    expect(
      screen.getByText(/Mais R\$\s2,59 de assinatura, fora da conta do dia/),
    ).toBeDefined();

    // A palavra escrita, e não só a cor mais fraca: "está mais claro" não é um
    // motivo que alguém consiga ler.
    const linha = screen.getByText(/GOOGLE/).closest("li");
    expect(within(linha!).getByText(/· assinatura/)).toBeDefined();
  });
});
