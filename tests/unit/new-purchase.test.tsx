import { writeFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LinkableTransaction } from "@/domain/purchase";

/**
 * O formulário de registrar compra (secao 15).
 *
 * O QUE ESTE ARQUIVO GUARDA: que a tela não deixa passar em silêncio as duas
 * coisas que custam dinheiro — uma compra parcelada vale a soma das parcelas, e
 * o valor pago quase nunca é o previsto. E que o lançamento da despesa só nasce
 * para o que não passa no cartão, porque o que passa a fatura já trouxe.
 */

const enviados: Record<string, unknown>[] = [];

const PORCELANATO: LinkableTransaction = {
  id: "t-porcelanato",
  date: "2026-07-14",
  invoiceMonth: "2026-09",
  description: "PORTINARI REVESTIMENTOS",
  merchant: "PORTINARI REVESTIMENTOS",
  amountCents: 896_55,
  installmentCurrent: 3,
  installmentTotal: 10,
  installmentValueCents: 896_55,
  cardLabel: "Nubank ·0162",
};

const AVISTA: LinkableTransaction = {
  id: "t-avista",
  date: "2026-09-02",
  invoiceMonth: "2026-09",
  description: "JK TINTAS E PISOS",
  merchant: "JK TINTAS E PISOS",
  amountCents: 3_306_59,
  installmentCurrent: null,
  installmentTotal: null,
  installmentValueCents: null,
  cardLabel: "Nubank ·0162",
};

vi.mock("@/actions/project", () => ({
  addPurchase: async (input: Record<string, unknown>) => {
    enviados.push(input);
    return { ok: true, postedTransactionId: input.postToLedger ? "novo" : undefined };
  },
  findTransactionsForItem: async () => ({ candidates: [PORCELANATO, AVISTA] }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { NovaCompra } = await import("@/components/project/new-purchase");

function montar(props: Partial<Parameters<typeof NovaCompra>[0]> = {}) {
  return render(
    <NovaCompra
      itemId="11111111-1111-1111-1111-111111111111"
      itemName="Porcelanato da sala"
      unit="m²"
      supplier="Portinari"
      expectedCents={8_965_50}
      pending={false}
      startTransition={(fn) => fn()}
      {...props}
    />,
  );
}

function valorDigitado(): string {
  return (screen.getByLabelText("Valor da compra") as HTMLInputElement).value;
}

async function vincular(qual: string) {
  fireEvent.click(screen.getByRole("button", { name: /Vincular a um gasto/ }));
  await waitFor(() => expect(screen.getAllByText(new RegExp(qual)).length).toBeGreaterThan(0));
  const linha = screen.getAllByRole("button").find((b) => b.textContent?.includes(qual))!;
  fireEvent.click(linha);
}

describe("NovaCompra", () => {
  beforeEach(() => {
    enviados.length = 0;
  });

  it("começa no cartão, que é como a maior parte da obra se paga", () => {
    montar();
    expect(screen.getByRole("button", { name: "Cartão" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ao vincular um parcelado, grava a SOMA das parcelas", async () => {
    // O ERRO QUE ISTO EVITA: a fatura mostra R$ 896,55; gravar isso deixaria o
    // porcelanato 10% comprado para sempre, e o total da obra nove mil reais
    // abaixo do que a casa deve.
    montar();
    await vincular("PORTINARI");

    expect(valorDigitado()).toBe("8965,50");
    expect(screen.getByRole("button", { name: /Registrar R\$/ }).textContent).toContain(
      "8.965,50",
    );
  });

  it("diz por extenso que o total foi deduzido das parcelas", async () => {
    montar();
    await vincular("PORTINARI");
    expect(screen.getByText(/Parcela 3 de 10/)).toBeTruthy();
    expect(screen.getByText(/deduzido das parcelas/)).toBeTruthy();
  });

  it("mostra a diferença para o previsto antes de gravar", async () => {
    // "Confirmar se o valor do cartão pode estar diferente do que a gente
    // planejou" - o pedido, em uma linha que aparece antes do botão.
    montar({ expectedCents: 8_000_00 });
    await vincular("PORTINARI");
    expect(screen.getByText(/acima do previsto/)).toBeTruthy();
    expect(screen.getByText(/12%/)).toBeTruthy();
  });

  it("cala quando o valor bate com o previsto", async () => {
    montar();
    await vincular("PORTINARI");
    expect(screen.queryByText(/do previsto/)).toBeNull();
  });

  it("cartão não pede lançamento, e manda o vínculo e as parcelas", async () => {
    montar();
    await vincular("PORTINARI");
    fireEvent.click(screen.getByRole("button", { name: /Registrar R\$/ }));
    await waitFor(() => expect(enviados).toHaveLength(1));

    expect(enviados[0]).toMatchObject({
      transactionId: "t-porcelanato",
      installmentTotal: 10,
      paymentMethod: "card",
      postToLedger: false,
      amountCents: 8_965_50,
      // O mês da PRIMEIRA parcela: vincular a 3 de 10 é dizer que a compra
      // aconteceu três meses atrás.
      invoiceMonth: "2026-07",
    });
  });

  it("boleto pede o mês e lança a despesa, com a casa confirmando", async () => {
    montar({ expectedCents: null });
    fireEvent.click(screen.getByRole("button", { name: "Boleto" }));
    fireEvent.change(screen.getByLabelText("Valor da compra"), {
      target: { value: "4000" },
    });
    fireEvent.change(screen.getByLabelText("Mês da despesa"), {
      target: { value: "2026-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Registrar R\$/ }));
    await waitFor(() => expect(enviados).toHaveLength(1));

    expect(enviados[0]).toMatchObject({
      paymentMethod: "boleto",
      invoiceMonth: "2026-10",
      postToLedger: true,
      transactionId: null,
    });
  });

  it("desmarcado, o boleto entra na obra mas não nos totais do mês", async () => {
    montar({ expectedCents: null });
    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.change(screen.getByLabelText("Valor da compra"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Registrar R\$/ }));
    await waitFor(() => expect(enviados).toHaveLength(1));

    expect(enviados[0]).toMatchObject({ paymentMethod: "pix", postToLedger: false });
    // O mês continua gravado: ele diz quando a despesa cai, e serve mesmo sem
    // aparecer nos totais.
    expect(enviados[0]!.invoiceMonth).toBeTruthy();
  });

  it("trocar de cartão para boleto larga o vínculo", async () => {
    // Manter o lançamento apontado deixaria a compra dizendo duas coisas: que
    // saiu por boleto e que é aquela linha da fatura.
    montar();
    await vincular("PORTINARI");
    fireEvent.click(screen.getByRole("button", { name: "Boleto" }));
    fireEvent.change(screen.getByLabelText("Valor da compra"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Registrar R\$/ }));
    await waitFor(() => expect(enviados).toHaveLength(1));

    expect(enviados[0]).toMatchObject({ transactionId: null, installmentTotal: null });
  });

  it("à vista, o valor é o da linha e não há parcela", async () => {
    montar({ supplier: "JK Tintas", expectedCents: 3_306_59 });
    await vincular("JK TINTAS");
    expect(screen.getByText(/À vista/)).toBeTruthy();
    expect(valorDigitado()).toBe("3306,59");
  });

  it("guarda o HTML para a medição de largura", async () => {
    const { container } = montar({ expectedCents: 8_000_00 });
    await vincular("PORTINARI");
    writeFileSync(
      process.env.MEDIR_HTML ?? "/dev/null",
      `<div class="mx-auto max-w-3xl">${container.innerHTML}</div>`,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});
