"use client";

import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { readQuoteWithAI } from "@/actions/quote-ai";
import {
  linesFromTextItems,
  readQuote,
  type QuoteProposal,
} from "@/domain/quote-pdf";

/** Como o orçamento foi lido, para a tela dizer e a pessoa saber o que conferir. */
export interface QuoteReadInfo {
  via: "ia" | "regra";
  /** Dito quando a IA estava ligada e não deu: o porquê de ter caído na regra. */
  aviso?: string;
}

/**
 * Ler a proposta de um PDF ou foto e preencher o formulário (secao 15).
 *
 * DOIS LEITORES, e a ordem entre eles é a decisão deste arquivo:
 *
 *   - COM IA (OpenRouter), quando está configurada. Lê foto e PDF
 *     escaneado, que o leitor por regra não lê, e não cai nas armadilhas que
 *     os orçamentos reais já armaram (telefone como valor, ano como valor).
 *   - POR REGRA (`domain/quote-pdf`), sempre disponível, sem rede. É para
 *     onde se volta quando a IA falha num PDF com texto — e o motivo aparece.
 *
 * O QUE SAI DO APARELHO mudou com a IA, e vale ser exato: antes, nada saía.
 * Agora, com a IA ligada, sai o TEXTO do PDF — extraído aqui, o arquivo em si
 * não vai — ou a imagem, quando não há texto. Só o documento do fornecedor:
 * nenhum dado da casa vai junto (ver `actions/quote-ai.ts`).
 *
 * O `pdfjs` e os utilitários de imagem entram por import dinâmico: quem abre
 * a tela para conferir o andamento não baixa nada disso.
 */
export function QuotePdfInput({
  onRead,
  aiEnabled = false,
}: {
  onRead: (proposal: QuoteProposal, info: QuoteReadInfo) => void;
  aiEnabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function comIA(
    entrada: { kind: "text"; text: string } | { kind: "image"; dataUrls: string[] },
  ) {
    setLendo("Lendo com IA…");
    return readQuoteWithAI(entrada);
  }

  async function abrirFoto(file: File) {
    if (!aiEnabled) {
      setErro("Ler foto precisa da leitura com IA ligada. Preencha à mão.");
      return;
    }
    const { photoToJpeg } = await import("@/lib/document-image");
    const r = await comIA({ kind: "image", dataUrls: [await photoToJpeg(file)] });
    if (r.proposal) onRead(r.proposal, { via: "ia" });
    else setErro(`${r.error ?? "Não consegui ler a foto."} Preencha à mão.`);
  }

  async function abrirPdf(file: File) {
    const pdfjs = await import("pdfjs-dist");
    // O worker vem do MESMO pacote, resolvido pelo bundler: sem apontá-lo o
    // pdfjs busca de uma CDN, o que falharia com a política de conteúdo do
    // app e mandaria o arquivo do fornecedor para fora do aparelho.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

    const partes: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // A remontagem das linhas mora no domínio, onde tem teste: é a parte
      // de que toda a leitura depende, e aqui ficaria sem cobertura.
      partes.push(linesFromTextItems(content.items as { str: string }[]));
    }
    const texto = partes.join("\n");

    if (texto.trim() === "") {
      // PDF de foto ou digitalização: não há texto para ler, e o leitor por
      // regra não tem o que fazer. Só a IA, olhando a página como imagem.
      if (!aiEnabled) {
        setErro("Este PDF não tem texto — parece ser uma imagem digitalizada. Preencha à mão.");
        return;
      }
      setLendo("Preparando as páginas…");
      const { pdfPagesToJpeg } = await import("@/lib/document-image");
      const paginas = await pdfPagesToJpeg(
        doc as unknown as Parameters<typeof pdfPagesToJpeg>[0],
      );
      const r = await comIA({ kind: "image", dataUrls: paginas });
      if (r.proposal) onRead(r.proposal, { via: "ia" });
      else setErro(`${r.error ?? "Não consegui ler o PDF."} Preencha à mão.`);
      return;
    }

    if (!aiEnabled) {
      onRead(readQuote(texto), { via: "regra" });
      return;
    }

    const r = await comIA({ kind: "text", text: texto });
    if (r.proposal) {
      onRead(r.proposal, { via: "ia" });
      return;
    }
    // A IA falhou num PDF COM texto: o leitor por regra ainda serve, e é
    // melhor um palpite conferível que um formulário vazio. O motivo vai
    // junto, para ninguém achar que foi a IA que leu.
    onRead(readQuote(texto), {
      via: "regra",
      aviso: `${r.error ?? "A IA não respondeu."} Usei a leitura sem IA — confira com mais cuidado.`,
    });
  }

  async function abrir(file: File) {
    setLendo(file.type.startsWith("image/") ? "Preparando a foto…" : "Lendo o PDF…");
    setErro(null);
    try {
      if (file.type.startsWith("image/")) await abrirFoto(file);
      else await abrirPdf(file);
    } catch (e) {
      console.error("[projetos] falha ao ler orçamento", e);
      setErro("Não consegui ler este arquivo. Preencha à mão.");
    } finally {
      setLendo(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="basis-full">
      <input
        ref={input}
        type="file"
        // `image/*` no celular abre a câmera como opção: fotografar o
        // orçamento em papel na loja é o caso que motivou a leitura com IA.
        accept={aiEnabled ? "application/pdf,.pdf,image/*" : "application/pdf,.pdf"}
        className="sr-only"
        id="pdf-cotacao"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void abrir(f);
        }}
      />
      <label
        htmlFor="pdf-cotacao"
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[12px] text-brand underline underline-offset-2"
      >
        {lendo ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-3.5" aria-hidden />
        )}
        {lendo ?? (aiEnabled ? "Ler de um PDF ou foto" : "Ler de um PDF")}
      </label>
      {erro ? <p className="text-[12px] text-attention">{erro}</p> : null}
    </div>
  );
}
