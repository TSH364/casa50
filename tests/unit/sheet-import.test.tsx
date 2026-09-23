import { writeFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { zip } from "./helpers/zip";

/**
 * A tela de subir planilha (secao 15).
 *
 * O QUE ESTE ARQUIVO GUARDA: que a tela é uma CONFERENCIA, e não um botão de
 * importar. Quem sobe a planilha precisa ver, antes de qualquer escrita, o que
 * vai entrar, o que ficou de fora e por quê — e poder trocar de aba, trocar a
 * coluna de quantidade e desmarcar linha. Cada teste abaixo cobre uma dessas
 * garantias.
 *
 * O arquivo do teste é um .xlsx montado aqui, com a mesma forma da planilha
 * real de quem usa: duas abas, blocos com cabeçalhos diferentes, subtotal no
 * meio, três colunas de quantidade.
 */

const enviados: unknown[] = [];

vi.mock("@/actions/project", () => ({
  importProjectItems: async (input: unknown) => {
    enviados.push(input);
    return { ok: true, created: 3, quotes: 2, duplicates: [] };
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SheetImport } = await import("@/components/project/sheet-import");

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function celula(ref: string, valor: string | number): string {
  return typeof valor === "number"
    ? `<c r="${ref}"><v>${valor}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${valor}</t></is></c>`;
}

function linha(n: number, celulas: Record<string, string | number>): string {
  return `<row r="${n}">${Object.entries(celulas)
    .map(([col, v]) => celula(`${col}${n}`, v))
    .join("")}</row>`;
}

const LISTA = [
  linha(2, { B: "LISTA DE COMPRAS — ACABAMENTOS" }),
  linha(4, { B: "1. REVESTIMENTOS — comprar por m²" }),
  linha(5, {
    B: "Marca",
    C: "Produto",
    D: "Unid.",
    E: "Qtd projeto (TOTAL)",
    F: "Banho",
    G: "Cozinha",
    H: "Qtd + perda",
    I: "COMPRAR",
    J: "Preço unit.",
    K: "Custo estimado",
  }),
  linha(6, { B: "Porcelana", C: "Linha Norte", D: "m²", E: 63.14, G: 42, H: 69.454, I: 69.5, J: 129, K: 8965.5 }),
  linha(7, { B: "Cerâmica Sul", C: "—", D: "m²", E: 6.59, G: 6.59, I: 7.3, J: 95, K: 693.5 }),
  linha(8, { B: "SUBTOTAL revestimentos", E: 69.73, I: 76.8, K: 9659 }),
  linha(10, { B: "2. LOUÇAS E METAIS — comprar por unidade" }),
  linha(11, { B: "Item", C: "Especificação para mostrar na loja", D: "Unid.", I: "COMPRAR", K: "Custo estimado" }),
  linha(12, {
    B: "Kit cuba gourmet 60x45 + torneira",
    C: "Cuba pia cozinha inox 304 escovada 60x45, completa + torneira gourmet 4 jatos cromada",
    D: "un",
    I: 1,
    K: 0,
  }),
  linha(13, { B: "TOTAL GERAL DA COMPRA", K: 9659 }),
  linha(15, { B: "Observações:" }),
  linha(16, { B: "• Revestimentos já incluem a perda acima." }),
].join("");

const LIVRO = zip([
  {
    nome: "xl/workbook.xml",
    conteudo: `<workbook ${NS}><sheets><sheet name="Plan1" sheetId="1" r:id="rId1"/><sheet name="Lista Loja" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  },
  {
    nome: "xl/_rels/workbook.xml.rels",
    conteudo: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  },
  {
    nome: "xl/worksheets/sheet1.xml",
    conteudo: `<worksheet ${NS}><sheetData>${linha(1, { A: "Ordem", B: "Etapa", C: "Descrição" })}${linha(2, { A: 1, B: "Infraestrutura", C: "Elétrica e hidráulica" })}</sheetData></worksheet>`,
  },
  { nome: "xl/worksheets/sheet2.xml", conteudo: `<worksheet ${NS}><sheetData>${LISTA}</sheetData></worksheet>` },
]);

/** Entrega a planilha à tela e espera a leitura terminar. */
async function subir() {
  const { container } = render(<SheetImport projectId="11111111-1111-1111-1111-111111111111" />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([LIVRO], "Acabamentos.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // jsdom nao implementa `File.arrayBuffer` em todas as versoes, e o teste nao
  // pode depender disso para falar da tela.
  Object.defineProperty(file, "arrayBuffer", { value: async () => LIVRO });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("Linha Norte")).toBeTruthy());
  return container;
}

describe("SheetImport", () => {
  beforeEach(() => {
    enviados.length = 0;
  });

  it("abre na aba com a lista de compras, e não na primeira do arquivo", async () => {
    // MEDIDO: a planilha real tem seis abas, e a primeira e rascunho. Abrir na
    // errada faz parecer que o app nao entendeu o arquivo.
    await subir();
    expect(screen.getByRole("button", { name: /Lista Loja/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Plan1/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("mostra os itens das duas seções com etapa, quantidade e preço", async () => {
    await subir();
    // Duas linhas na mesma etapa: o rotulo aparece uma vez por item.
    expect(screen.getAllByText("Revestimentos")).toHaveLength(2);
    expect(screen.getByText("Louças e metais")).toBeTruthy();
    expect(screen.getByText("Kit cuba gourmet 60x45 + torneira")).toBeTruthy();
    // Produto vazio: o nome cai para a marca - e a marca nao se repete ao lado.
    expect(screen.getAllByText("Cerâmica Sul")).toHaveLength(1);
    expect(screen.getByText(/8\.965,50/)).toBeTruthy();
    // Custo zero e "sem preco", e nao R$ 0,00.
    expect(screen.getByText("sem preço")).toBeTruthy();
  });

  it("não oferece subtotal nem total como item", async () => {
    await subir();
    expect(screen.queryByText("SUBTOTAL revestimentos")).toBeNull();
    expect(screen.queryByText("TOTAL GERAL DA COMPRA")).toBeNull();
  });

  it("diz quantas linhas ficaram de fora, e o motivo de cada uma", async () => {
    await subir();
    const ver = screen.getByRole("button", { name: /linhas fora da lista/ });
    fireEvent.click(ver);
    expect(screen.getAllByText(/linha de soma/)).toHaveLength(2);
    // O titulo da aba e os dois numerados.
    expect(screen.getAllByText(/título de seção/)).toHaveLength(3);
  });

  it("deixa trocar a coluna de quantidade", async () => {
    // A planilha real tem "Qtd projeto", "Qtd + perda" e "COMPRAR" lado a lado,
    // e so quem montou sabe qual e a que vai ser comprada.
    await subir();
    expect(screen.getByText(/^69,5\s/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Qtd + perda" }));
    expect(screen.getByText(/^69,454\s/)).toBeTruthy();
  });

  it("manda só o que ficou marcado", async () => {
    await subir();
    const linhas = screen.getAllByRole("checkbox");
    fireEvent.click(linhas[0]!);
    expect(screen.getByRole("button", { name: /Importar 2 itens/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Importar 2 itens/ }));
    await waitFor(() => expect(enviados).toHaveLength(1));
    const { items } = enviados[0] as { items: { name: string }[] };
    expect(items.map((i) => i.name)).toEqual([
      "Cerâmica Sul",
      "Kit cuba gourmet 60x45 + torneira",
    ]);
  });

  it("guarda o HTML da tela cheia para a medição de largura", async () => {
    const container = await subir();
    fireEvent.click(screen.getByRole("button", { name: /linhas fora da lista/ }));
    writeFileSync(
      process.env.MEDIR_HTML ?? "/dev/null",
      `<div class="mx-auto max-w-3xl">${container.innerHTML}</div>`,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});
