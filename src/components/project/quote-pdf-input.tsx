"use client";

import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import {
  linesFromTextItems,
  readQuote,
  type QuoteProposal,
} from "@/domain/quote-pdf";

/**
 * Ler o PDF da proposta e preencher o formulário (secao 15).
 *
 * O ARQUIVO NÃO SAI DO APARELHO. A extração roda no navegador, como a leitura
 * de fatura já faz: o que chega ao servidor é o que a pessoa confirmou, e não
 * o documento do fornecedor. Isso não é detalhe de arquitetura — é a
 * diferença entre guardar um orçamento e distribuí-lo.
 *
 * O `pdfjs` entra por import dinâmico porque pesa mais de meio megabyte: quem
 * abre a tela para conferir o andamento não deve baixá-lo à toa.
 */
export function QuotePdfInput({
  onRead,
}: {
  onRead: (proposal: QuoteProposal) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir(file: File) {
    setLendo(true);
    setErro(null);
    try {
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
        // PDF de foto ou digitalização não tem texto para extrair, e dizer
        // isso é melhor que devolver um formulário vazio sem explicação.
        setErro(
          "Este PDF não tem texto — parece ser uma imagem digitalizada. Preencha à mão.",
        );
        return;
      }
      onRead(readQuote(texto));
    } catch (e) {
      console.error("[projetos] falha ao ler PDF", e);
      setErro("Não consegui ler este PDF. Preencha à mão.");
    } finally {
      setLendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="basis-full">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
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
        {lendo ? "Lendo o PDF…" : "Ler de um PDF"}
      </label>
      {erro ? <p className="text-[12px] text-attention">{erro}</p> : null}
    </div>
  );
}
