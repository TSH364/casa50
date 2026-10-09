import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildInsights, repeteObservacao } from "@/domain/insights";
import type { Category, Transaction } from "@/domain/types";

/**
 * Analise - o grupo "Agora" do relatorio de melhorias:
 *   - um resumo no topo (gasto, recebido, saldo, contra a media);
 *   - a observacao de categoria leva a Extratos JA filtrado pela categoria;
 *   - a analise da IA que so repete uma observacao do app sai;
 *   - atalhos para os blocos.
 */

vi.mock("@/actions/ai-insights", () => ({ analyzeMonth: vi.fn() }));

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: `${p.invoiceMonth ?? "2026-09"}-05`, invoiceMonth: "2026-09", description: "Compra",
    merchantOriginal: null, merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL",
    originalAmount: null, originalCurrency: null, type: "expense", origin: "manual", status: "confirmed",
    categoryId: null, subcategoryId: null, note: null, receiptUrl: null, visibility: "shared",
    splitType: "none", splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null,
    calendarEventId: null, eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null,
    createdAt: "", updatedAt: "", ...p,
  };
}
const categorias = [{ id: "ali", name: "Alimentação", kind: "expense" } as Category];
const historico = [
  ...["2026-07", "2026-08", "2026-09"].map((m) => tx({ invoiceMonth: m, categoryId: "ali", amount: 3385.73 })),
  tx({ invoiceMonth: "2026-10", categoryId: "ali", amount: 1908.4 }),
  tx({ invoiceMonth: "2026-10", type: "income", description: "FAPESP", amount: 5790 }),
];
const insights = buildInsights({ month: "2026-10", transactions: historico, categories: categorias, budgets: [], recurrenceMatches: [] });
const queda = insights.find((i) => i.kind === "category_drop")!;
const nbsp = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("a observação leva ao recorte certo", () => {
  it("Extratos já com o mês e a categoria; e diz qual fato da IA repete", () => {
    expect(queda.href).toBe("/extratos?mes=2026-10&categoria=ali");
    expect(queda.fato).toBe("Categoria Alimentação no mês");
  });
});

describe("a IA não repete o app", () => {
  it("repete quando todo fato citado já é uma observação do app", () => {
    expect(repeteObservacao([{ label: "Categoria Alimentação no mês" }], insights)).toBe(true);
    expect(repeteObservacao([{ label: "Categoria Alimentação no mês" }, { label: "Observação do app: x" }], insights)).toBe(true);
    // A loja que explica a categoria acrescenta algo.
    expect(repeteObservacao([{ label: "Categoria Alimentação no mês" }, { label: "Loja IFOOD" }], insights)).toBe(false);
    expect(repeteObservacao([], insights)).toBe(false);
  });

  it("o cartão esconde a repetida e diz que escondeu", async () => {
    const { AiAnalysisCard } = await import("@/components/insights/ai-analysis");
    const item = (title: string, label: string) => ({ title, text: "x", tone: "positive", suggestion: null, evidence: [{ label, value: "R$ 1,00" }] });
    render(
      <AiAnalysisCard
        month="2026-10"
        scope="casa"
        enabled
        observacoes={insights.map((i) => ({ fato: i.fato }))}
        initial={{ createdAt: "2026-10-09T02:54:00Z", dropped: 0, items: [item("Redução em Alimentação", "Categoria Alimentação no mês"), item("Fim de semana pesa", "Gasto em sábados e domingos")] } as never}
      />,
    );
    expect(screen.queryByText("Redução em Alimentação")).toBeNull();
    expect(screen.getByText("Fim de semana pesa")).toBeTruthy();
    expect(screen.getByText(/1 análise repetia uma observação de O que mudou/)).toBeTruthy();
  });
});

describe("o resumo no topo", () => {
  it("gasto, recebido, saldo e contra a média dos meses anteriores", async () => {
    const { ResumoDoMes } = await import("@/components/insights/resumo-do-mes");
    const { container } = render(<ResumoDoMes transactions={historico} month="2026-10" emAndamento />);
    const valor = (rotulo: string) => nbsp(screen.getByText(rotulo, { selector: "dt" }).nextElementSibling!.textContent);
    expect(valor("Gasto")).toBe("R$ 1.908");
    expect(valor("Recebido")).toBe("+R$ 5.790");
    expect(valor("Saldo")).toBe("R$ 3.882");
    expect(valor("Contra a média")).toBe("−44%");
    expect(nbsp(container.textContent)).toContain("média de 3 meses");
    expect(container.textContent).toContain("até agora");
  });

  it("sem meses anteriores, não inventa média", async () => {
    const { ResumoDoMes } = await import("@/components/insights/resumo-do-mes");
    render(<ResumoDoMes transactions={[tx({ invoiceMonth: "2026-10" })]} month="2026-10" emAndamento={false} />);
    expect(screen.getByText("Sem meses anteriores para comparar ainda.")).toBeTruthy();
    expect(nbsp(screen.getByText("Contra a média").nextElementSibling!.textContent)).toBe("—");
  });
});

describe("atalhos", () => {
  it("um link para cada bloco", async () => {
    const { AtalhosDaAnalise } = await import("@/components/insights/atalhos-da-analise");
    render(<AtalhosDaAnalise itens={[{ id: "resumo", rotulo: "Resumo" }, { id: "parcelas", rotulo: "Parcelas" }]} />);
    const nav = screen.getByRole("navigation", { name: "Ir para" });
    expect(nav.querySelector('a[href="#parcelas"]')?.textContent).toBe("Parcelas");
    fireEvent.click(screen.getByText("Resumo"));
  });
});
