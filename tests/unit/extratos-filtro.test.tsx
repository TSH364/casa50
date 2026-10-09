import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ladoNoExtrato, tipoDoExtrato } from "@/domain/finance";
import { dataPadraoNoMes } from "@/domain/month";

/**
 * Extratos - pedidos da casa:
 *   - "nao consigo ver so as saidas ou so as entradas";
 *   - "vendo marco, tocar em Lancar abre no mes atual, e isso gera erro em
 *     preenchimento rapido".
 *
 * O que guarda: o lado de cada tipo de lancamento no filtro; o filtro na URL;
 * os totais mostram so o lado escolhido; e o lancamento novo nasce no mes que
 * a tela mostra.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/extratos",
  useSearchParams: () => new URLSearchParams("mes=2026-03&cartao=c1"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/transactions", () => ({ createTransaction: vi.fn(), updateTransaction: vi.fn() }));
vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn(async () => ({})) }));

afterEach(() => {
  vi.useRealTimers();
  push.mockClear();
});

describe("saídas e entradas", () => {
  it("receita é entrada; despesa, tarifa, ajuste e estorno são saída; pagamento da fatura só em Tudo", () => {
    expect(ladoNoExtrato({ type: "income" })).toBe("entrada");
    for (const type of ["expense", "fee", "adjustment", "refund"] as const) expect(ladoNoExtrato({ type })).toBe("saida");
    expect(ladoNoExtrato({ type: "payment" })).toBe("outro");
  });

  it("o parâmetro da URL", () => {
    expect(tipoDoExtrato("saidas")).toBe("saida");
    expect(tipoDoExtrato("entradas")).toBe("entrada");
    expect(tipoDoExtrato(undefined)).toBeNull();
    expect(tipoDoExtrato("qualquer")).toBeNull();
  });

  it("o seletor mostra quantos tem e troca o filtro mantendo os outros", async () => {
    const { FiltroTipo } = await import("@/components/transactions/filtro-tipo");
    render(<FiltroTipo ativo={null} contagem={{ tudo: 120, saidas: 112, entradas: 6 }} />);
    expect(screen.getByRole("radio", { name: /Tudo\s*120/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Entradas\s*6/ }));
    expect(push).toHaveBeenCalledWith("/extratos?mes=2026-03&cartao=c1&tipo=entradas", { scroll: false });
  });

  it("os totais mostram só o lado escolhido", async () => {
    const { TotaisSeparados } = await import("@/components/transactions/totais-separados");
    const { rerender } = render(<TotaisSeparados gastoCents={100_000} recebidoCents={579_000} mostrar="entrada" />);
    expect(screen.queryByText("Gastos")).toBeNull();
    expect(screen.getByText("Recebido")).toBeTruthy();
    rerender(<TotaisSeparados gastoCents={100_000} recebidoCents={579_000} mostrar="saida" />);
    expect(screen.getByText("Gastos")).toBeTruthy();
    expect(screen.queryByText("Recebido")).toBeNull();
  });
});

describe("lançamento novo nasce no mês da tela", () => {
  it("no mês de hoje, hoje; noutro, o mesmo dia daquele mês (limitado ao último)", () => {
    expect(dataPadraoNoMes("2026-10", "2026-10-09")).toBe("2026-10-09");
    expect(dataPadraoNoMes("2026-03", "2026-10-09")).toBe("2026-03-09");
    expect(dataPadraoNoMes("2026-02", "2026-10-31")).toBe("2026-02-28");
  });

  it("vendo março, o formulário abre com data e fatura em março", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
    const { TransactionFormDialog } = await import("@/components/transactions/transaction-form");
    render(<TransactionFormDialog open onOpenChange={() => {}} categories={[]} cards={[]} members={[]} defaultMonth="2026-03" />);
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-03-09");
    expect((screen.getByLabelText("Mês da fatura") as HTMLSelectElement).value).toBe("2026-03");
  });
});
