import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuoteProposal } from "@/domain/quote-pdf";

/**
 * O botao de ler orcamento, com e sem IA.
 *
 * O que guarda: a ORDEM entre os dois leitores. Com IA ligada, ela le; se
 * falhar num PDF com texto, o leitor por regra assume e o motivo aparece. Foto
 * e PDF escaneado so a IA le. Sem IA, tudo continua como era antes.
 */

const estado = {
  /** Texto de cada pagina do PDF simulado; vazio = PDF escaneado. */
  paginas: ["Loja\nTOTAL 1.250,00"] as string[],
  ia: { proposal: undefined, error: undefined, configured: true } as {
    proposal?: QuoteProposal;
    error?: string;
    configured: boolean;
  },
  chamadasIa: [] as unknown[],
  paginasRenderizadas: 0,
};

vi.mock("@/actions/quote-ai", () => ({
  readQuoteWithAI: async (entrada: unknown) => {
    estado.chamadasIa.push(entrada);
    return estado.ia;
  },
}));

vi.mock("@/lib/document-image", () => ({
  photoToJpeg: async () => "data:image/jpeg;base64,FOTO",
  pdfPagesToJpeg: async () => {
    estado.paginasRenderizadas += 1;
    return ["data:image/jpeg;base64,PAG1"];
  },
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: estado.paginas.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: estado.paginas[n - 1]!
            .split("\n")
            .filter((l) => l !== "")
            .map((str, i) => ({ str, transform: [0, 0, 0, 0, 0, 800 - i * 20] })),
        }),
      }),
    }),
  }),
}));

const { QuotePdfInput } = await import("@/components/project/quote-pdf-input");

const DA_IA: QuoteProposal = {
  total: { cents: 125_000, context: "total", confidence: "alta" },
  alternatives: [],
  supplier: "Loja da IA",
  quotedOn: null,
};

function arquivo(nome: string, tipo: string) {
  const f = new File(["x"], nome, { type: tipo });
  Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return f;
}

function montar(aiEnabled: boolean) {
  const lidos: { proposal: QuoteProposal; info: { via: string; aviso?: string } }[] = [];
  const { container } = render(
    <QuotePdfInput aiEnabled={aiEnabled} onRead={(proposal, info) => lidos.push({ proposal, info })} />,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { lidos, input };
}

describe("QuotePdfInput", () => {
  beforeEach(() => {
    estado.paginas = ["Loja\nTOTAL 1.250,00"];
    estado.ia = { proposal: DA_IA, configured: true };
    estado.chamadasIa = [];
    estado.paginasRenderizadas = 0;
  });

  it("sem IA, aceita só PDF — e o rótulo não promete foto", () => {
    const { input } = montar(false);
    expect(input.accept).not.toContain("image");
    expect(screen.getByText("Ler de um PDF")).toBeTruthy();
  });

  it("com IA, aceita foto — que no celular abre a câmera", () => {
    const { input } = montar(true);
    expect(input.accept).toContain("image/*");
    expect(screen.getByText("Ler de um PDF ou foto")).toBeTruthy();
  });

  it("sem IA, o PDF é lido pela regra, como antes, e nada sai do aparelho", async () => {
    const { lidos, input } = montar(false);
    fireEvent.change(input, { target: { files: [arquivo("o.pdf", "application/pdf")] } });
    await waitFor(() => expect(lidos).toHaveLength(1));
    expect(lidos[0]?.info.via).toBe("regra");
    expect(lidos[0]?.proposal.total?.cents).toBe(125_000);
    expect(estado.chamadasIa).toHaveLength(0);
  });

  it("com IA, o PDF com texto vai como TEXTO, e não como arquivo", async () => {
    const { lidos, input } = montar(true);
    fireEvent.change(input, { target: { files: [arquivo("o.pdf", "application/pdf")] } });
    await waitFor(() => expect(lidos).toHaveLength(1));
    expect(lidos[0]?.info.via).toBe("ia");
    expect(lidos[0]?.proposal.supplier).toBe("Loja da IA");
    expect(estado.chamadasIa[0]).toMatchObject({ kind: "text" });
    // Texto basta: renderizar a pagina seria mandar mais do que o necessario.
    expect(estado.paginasRenderizadas).toBe(0);
  });

  it("se a IA falha num PDF com texto, a regra assume e diz por quê", async () => {
    estado.ia = { error: "A conta do OpenRouter está sem créditos.", configured: true };
    const { lidos, input } = montar(true);
    fireEvent.change(input, { target: { files: [arquivo("o.pdf", "application/pdf")] } });
    await waitFor(() => expect(lidos).toHaveLength(1));
    expect(lidos[0]?.info.via).toBe("regra");
    expect(lidos[0]?.info.aviso).toMatch(/sem créditos.*sem IA/);
    // O palpite da regra chega mesmo assim: formulario preenchido e conferivel
    // e melhor que vazio.
    expect(lidos[0]?.proposal.total?.cents).toBe(125_000);
  });

  it("PDF escaneado vai como imagem das páginas", async () => {
    estado.paginas = [""];
    const { lidos, input } = montar(true);
    fireEvent.change(input, { target: { files: [arquivo("scan.pdf", "application/pdf")] } });
    await waitFor(() => expect(lidos).toHaveLength(1));
    expect(estado.paginasRenderizadas).toBe(1);
    expect(estado.chamadasIa[0]).toMatchObject({ kind: "image" });
  });

  it("PDF escaneado sem IA diz para preencher à mão, como antes", async () => {
    estado.paginas = [""];
    const { lidos, input } = montar(false);
    fireEvent.change(input, { target: { files: [arquivo("scan.pdf", "application/pdf")] } });
    await waitFor(() => expect(screen.getByText(/não tem texto/)).toBeTruthy());
    expect(lidos).toHaveLength(0);
  });

  it("foto vai comprimida para a IA", async () => {
    const { lidos, input } = montar(true);
    fireEvent.change(input, { target: { files: [arquivo("orc.jpg", "image/jpeg")] } });
    await waitFor(() => expect(lidos).toHaveLength(1));
    expect(estado.chamadasIa[0]).toEqual({
      kind: "image",
      dataUrls: ["data:image/jpeg;base64,FOTO"],
    });
  });

  it("foto que a IA não lê pede preenchimento à mão, com o motivo", async () => {
    estado.ia = { error: "Muitas leituras seguidas. Espere um minuto e tente de novo.", configured: true };
    const { lidos, input } = montar(true);
    fireEvent.change(input, { target: { files: [arquivo("orc.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByText(/Espere um minuto.*Preencha à mão/)).toBeTruthy());
    expect(lidos).toHaveLength(0);
  });
});
