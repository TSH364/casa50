import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { casarNotas, idDaPlanilha, lerNotas, sinaisDaLoja } from "@/domain/notas";
import type { Transaction } from "@/domain/types";

/**
 * Notas fiscais - pedido da casa: a planilha "Controle de Notas Fiscais e
 * Compras", que o Gemini preenche com as notas do Gmail, "sincronizada com o
 * app e associada aos itens da fatura, para detalhar melhor as compras".
 *
 * O que guarda: a planilha e lida pelo NOME das colunas (com os cabecalhos
 * reais dela), sem o destinatario (CPF e endereco); "Consultar Detalhe ML"
 * vira nota sem valor; devolucao nao e compra; a mesma nota repetida entra
 * uma vez; o casamento exige valor quando ha, e sem valor so liga quando ha
 * uma compra possivel; e a lista de Extratos mostra o produto.
 */

vi.mock("server-only", () => ({}));

const CABECALHO = [
  "Data da Compra/Emissão", "Categoria", "Loja / Emitente", "CNPJ / CCM", "Produto / Serviço (Descrição e Quantidade)",
  "Valor Total (R$)", "Quem Comprou", "Forma de Pagamento", "Nº da Nota Fiscal", "Nº do Pedido / OS / RPS",
  "Chave de Acesso / Cód. Verificação", "Destinatário / Endereço de Entrega", "Link do E-mail",
];
const linha = (p: Partial<Record<number, unknown>>) => CABECALHO.map((_, i) => p[i] ?? "");
const LINHAS = [
  [],
  CABECALHO,
  linha({
    0: "09/10/2026", 1: "Reforma & Construção (Leroy Merlin)", 2: "Leroy Merlin Cia Brasileira de Bricolagem (Loja Raposo Tavares)",
    3: "01.438.784/0006-01", 4: "Argamassa ACIII Multiuso Int/Ext Cinza 20kg Axton (5 UN x R$ 35,00)", 5: 175, 6: "Vini",
    7: "Cartão de Crédito Mastercard", 8: "NF-e 960051 (Série 6)", 9: "Pedido 37793836",
    10: "35261001438784000601550060009600511622052126", 11: "Vinicius — Rua X, 364 (CPF 000.000.000-00)",
    12: "https://mail.google.com/mail/?authuser=vini@gmail.com#all/thread-f:1878618",
  }),
  linha({
    0: "08/10/2026", 1: "Eletrodomésticos (Mercado Livre)", 2: "UTILIDADES DOMESTICAS UD LTDA (via Mercado Livre)",
    3: "02.817.838/0022-22", 4: "Forno de Embutir Elétrico 50L Electrolux (1 UN)", 5: "Consultar Detalhe ML", 6: "Vini",
    7: "Mercado Pago (Conta Vini)", 8: "NF-e Compra #2000018860049218", 12: "https://evil.example.com/x",
  }),
  linha({
    0: "23/09/2026", 2: "Leroy Merlin Companhia Brasileira de Bricolagem (Loja Virtual CD SP)", 3: "01.438.784/0058-32",
    4: "[NF-e de Devolução] Rejunte Cinza 4kg", 5: "R$ 67,90", 7: "Devolução de Mercadoria", 8: "NF-e 326554 (Série 7)",
  }),
  // A mesma nota de novo (o Gemini as vezes repete a linha).
  linha({ 0: "09/10/2026", 2: "Leroy Merlin Cia Brasileira de Bricolagem", 4: "Argamassa", 5: 175, 10: "35261001438784000601550060009600511622052126" }),
];

describe("ler a planilha", () => {
  it("pelos nomes das colunas, sem o destinatário, com valor, devolução e repetição tratados", () => {
    const notas = lerNotas(LINHAS);
    expect(notas).toHaveLength(3);
    expect(notas[0]).toMatchObject({
      chave: "nfe:35261001438784000601550060009600511622052126",
      data: "2026-10-09",
      loja: "Leroy Merlin Cia Brasileira de Bricolagem (Loja Raposo Tavares)",
      valorCents: 17_500,
      numero: "NF-e 960051 (Série 6)",
      linkEmail: "https://mail.google.com/mail/?authuser=vini@gmail.com#all/thread-f:1878618",
      semCompra: false,
    });
    expect(JSON.stringify(notas)).not.toContain("CPF");
    // Sem valor; e link que nao e do Gmail nao entra.
    expect(notas[1]).toMatchObject({ valorCents: null, linkEmail: null, chave: "num:02817838002222:nfecompra2000018860049218" });
    expect(notas[2]).toMatchObject({ valorCents: 6_790, semCompra: true });
  });

  it("o id da planilha pelo link", () => {
    expect(idDaPlanilha("https://docs.google.com/spreadsheets/d/14PqL15SU7RYdQsnEnMgk-aZEmh6rzZ6k0bry9vdGoQ0/edit?usp=drivesdk")).toBe(
      "14PqL15SU7RYdQsnEnMgk-aZEmh6rzZ6k0bry9vdGoQ0",
    );
    expect(idDaPlanilha("https://exemplo.com")).toBeNull();
  });

  it("como a loja aparece na fatura", () => {
    expect(sinaisDaLoja("UTILIDADES DOMESTICAS UD LTDA (via Mercado Livre)")).toContain("MERCADOLIVRE");
    expect(sinaisDaLoja("Leroy Merlin Cia Brasileira de Bricolagem (Loja Raposo Tavares)")).toEqual(["LEROY", "MERLIN"]);
    expect(sinaisDaLoja("Tupinambá Energia e Publicidade Ltda (Tupimob)")).toEqual(["TUPINAMBA", "ENERGIA"]);
  });
});

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false, date: "2026-10-09",
    invoiceMonth: "2026-10", description: "Compra", merchantOriginal: null, merchantNormalized: null, merchantAlias: null,
    amount: 100, currency: "BRL", originalAmount: null, originalCurrency: null, type: "expense", origin: "invoice",
    status: "confirmed", categoryId: null, subcategoryId: null, note: null, receiptUrl: null, visibility: "shared",
    splitType: "none", splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null,
    calendarEventId: null, eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "",
    updatedAt: "", ...p,
  };
}

describe("casar nota com compra", () => {
  const nota = (p: Partial<{ chave: string; data: string; loja: string; valorCents: number | null; semCompra: boolean }>) => ({
    chave: "n1", data: "2026-10-09", loja: "Leroy Merlin Cia Brasileira", valorCents: 17_500 as number | null, semCompra: false, ...p,
  });

  it("com valor: mesma loja, valor que bate, data mais próxima; parcelado conta o total", () => {
    const certa = tx({ id: "certa", description: "LEROY MERLIN RAPOSO", amount: 175, date: "2026-10-08" });
    const compras = [
      tx({ id: "outra-loja", description: "MERCADINHO", amount: 175 }),
      tx({ id: "outro-valor", description: "LEROY MERLIN", amount: 99 }),
      certa,
      tx({ id: "parcelada", description: "LEROY MERLIN", amount: 200.53, installment: { current: 1, total: 4 } as never, date: "2026-10-07" }),
    ];
    const pares = casarNotas([nota({}), nota({ chave: "n2", valorCents: 80_212, data: "2026-10-08" })], compras, new Set());
    expect(Object.fromEntries(pares)).toEqual({ n1: "certa", n2: "parcelada" });
  });

  it("sem valor: só com uma compra possível; duas, nenhuma", () => {
    const ml = (id: string, date: string) => tx({ id, description: "MERCADOLIVRE*UDLTDA", amount: 3500, date });
    const so = casarNotas([nota({ loja: "UD LTDA (via Mercado Livre)", valorCents: null })], [ml("a", "2026-10-07")], new Set());
    expect(so.get("n1")).toBe("a");
    const duas = casarNotas([nota({ loja: "UD LTDA (via Mercado Livre)", valorCents: null })], [ml("a", "2026-10-07"), ml("b", "2026-10-08")], new Set());
    expect(duas.size).toBe(0);
  });

  it("devolução não casa; compra já ligada não recebe outra nota; fora da janela não casa", () => {
    const c = tx({ id: "c1", description: "LEROY MERLIN", amount: 175 });
    expect(casarNotas([nota({ semCompra: true })], [c], new Set()).size).toBe(0);
    expect(casarNotas([nota({})], [c], new Set(["c1"])).size).toBe(0);
    expect(casarNotas([nota({ data: "2026-10-30" })], [c], new Set()).size).toBe(0);
  });
});

describe("na lista do Extratos", () => {
  vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
  vi.mock("@/actions/transactions", () => ({ deleteTransaction: vi.fn(), setTransactionCategory: vi.fn(), createTransaction: vi.fn(), updateTransaction: vi.fn() }));
  vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn() }));

  it("a compra mostra o produto da nota, com o número levando ao e-mail", async () => {
    const { TransactionList } = await import("@/components/transactions/transaction-list");
    const compra = tx({ id: "c1", description: "MERCADOLIVRE*UDLTDA", amount: 3500 });
    render(
      <TransactionList
        transactions={[compra, tx({ id: "c2", description: "PADARIA" })]}
        categories={[]}
        cards={[]}
        members={[]}
        defaultMonth="2026-10"
        notas={{
          c1: [
            { produto: "Forno de Embutir Elétrico 50L Electrolux", numero: "NF-e 2144357", loja: "UD", linkEmail: "https://mail.google.com/mail/#all/x" },
            { produto: "Cooktop", numero: null, loja: "UD", linkEmail: null },
          ],
        }}
      />,
    );
    const linha = screen.getByText("MERCADOLIVRE*UDLTDA").closest("li")!;
    expect(within(linha).getByText(/Forno de Embutir Elétrico 50L Electrolux/).textContent).toContain("+1");
    expect(within(linha).getByRole("link", { name: /nota NF-e 2144357/ }).getAttribute("href")).toBe("https://mail.google.com/mail/#all/x");
    expect(within(screen.getByText("PADARIA").closest("li")!).queryByText(/Forno/)).toBeNull();
  });
});

describe("gravar e casar", () => {
  it("grava as notas da planilha e liga as que casam", async () => {
    const upserts: Record<string, unknown>[][] = [];
    const updates: { payload: Record<string, unknown>; filtros: string[] }[] = [];
    const rpcs: string[] = [];
    const supabase = {
      rpc: (nome: string) => {
        rpcs.push(nome);
        return Promise.resolve({ data: null, error: null });
      },
      from: () => {
        const filtros: string[] = [];
        let payload: Record<string, unknown> | null = null;
        let pendentes = false;
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "not", "in"]) {
          b[m] = (campo: string, v: unknown) => {
            filtros.push(`${m}:${campo}:${String(v)}`);
            return b;
          };
        }
        b.is = (campo: string, v: unknown) => {
          filtros.push(`is:${campo}:${String(v)}`);
          if (!payload) pendentes = true;
          return b;
        };
        b.upsert = (l: Record<string, unknown>[]) => {
          upserts.push(l);
          return Promise.resolve({ error: null });
        };
        b.update = (p: Record<string, unknown>) => {
          payload = p;
          return b;
        };
        b.then = (ok: (r: unknown) => unknown) => {
          if (payload) {
            updates.push({ payload, filtros });
            return Promise.resolve({ error: null }).then(ok);
          }
          return Promise.resolve({
            data: pendentes
              ? [{ id: "nota-1", chave: "nfe:35261001438784000601550060009600511622052126", data: "2026-10-09", loja: "Leroy Merlin", valor: 175, sem_compra: false }]
              : [],
            error: null,
          }).then(ok);
        };
        return b;
      },
    };
    vi.doMock("@/lib/gmail", () => ({ GmailError: class extends Error {}, lerPlanilha: async () => LINHAS }));
    vi.doMock("@/data/queries", () => ({
      listTransactions: async () => [tx({ id: "compra-leroy", description: "LEROY MERLIN RAPOSO", amount: 175, date: "2026-10-09" })],
    }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => supabase, getCurrentUser: async () => null }));
    vi.resetModules();
    const { casarPendentes, sincronizarPlanilha } = await import("@/data/notas");
    expect(await sincronizarPlanilha(supabase as never, "casa", "conexao-1", "planilha", "token")).toBe(3);
    expect(upserts[0]!.map((l) => l.chave)).toHaveLength(3);
    expect(JSON.stringify(upserts)).not.toContain("CPF");
    expect(rpcs).toEqual(["mark_nf_sync"]);
    expect(await casarPendentes(supabase as never, "casa")).toBe(1);
    expect(updates[0]).toMatchObject({ payload: { transaction_id: "compra-leroy" } });
    expect(updates[0]!.filtros).toContain("eq:id:nota-1");
  });
});
