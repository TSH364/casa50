"use server";

import { z } from "zod";
import { requireHouseId } from "./shared";
import {
  chatCompletion,
  isOpenRouterConfigured,
  OpenRouterError,
  type ContentPart,
} from "@/lib/openrouter";
import { parseQuoteAnswer, QUOTE_PROMPT } from "@/domain/quote-ai";
import type { QuoteProposal } from "@/domain/quote-pdf";

/**
 * Ler um orcamento com IA, pelo OpenRouter (secao 15).
 *
 * EXIGE CASA, e nao so login: server action e um endereco publico, e sem esta
 * trava qualquer pessoa que descobrisse a chamada poderia gastar os creditos
 * do OpenRouter da casa lendo documentos alheios. `requireHouseId` so passa
 * quem e membro de uma casa.
 *
 * O QUE SAI DO APARELHO, e so isto: o texto do PDF do fornecedor, ou a imagem
 * dele. Nenhum dado da casa vai junto - nem o nome do item, nem o previsto,
 * nem o fornecedor que a pessoa ja digitou. O modelo nao precisa, e o que nao
 * sai nao vaza.
 */

/** Texto de orcamento tem alguns milhares de caracteres; 60 mil e um livro. */
const MAX_TEXTO = 60_000;
/**
 * Imagem ja chega comprimida pelo navegador (lado maior de 1600px, JPEG), o
 * que da algumas centenas de KB. Seis MB em base64 e folga para foto que o
 * navegador nao conseguiu reduzir, e ainda cabe no limite de corpo da acao.
 */
const MAX_IMAGEM = 6 * 1024 * 1024;

const entradaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(MAX_TEXTO),
  }),
  z.object({
    kind: z.literal("image"),
    // Ate tres paginas: PDF escaneado de orcamento costuma ter o total na
    // ULTIMA pagina, e mandar so a primeira leria os itens e perderia a soma.
    // So os formatos que todo provedor com visao aceita. HEIC do iPhone nao
    // entra aqui - o navegador ja converte para JPEG antes (ver o componente).
    dataUrls: z
      .array(
        z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
      )
      .min(1)
      .max(3)
      .refine((urls) => urls.reduce((n, u) => n + u.length, 0) <= MAX_IMAGEM),
  }),
]);

export interface QuoteAiResult {
  proposal?: QuoteProposal;
  error?: string;
  /** Quando falso, a tela nem oferece: a leitura com IA nao esta ligada. */
  configured: boolean;
}

export async function readQuoteWithAI(input: unknown): Promise<QuoteAiResult> {
  // A casa ANTES de tudo, inclusive de dizer se a IA esta ligada: quem nao e
  // membro nao tem por que saber nem isso.
  await requireHouseId();

  if (!isOpenRouterConfigured()) {
    return { configured: false, error: "A leitura com IA não está configurada." };
  }

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { configured: true, error: "Arquivo grande demais ou em formato não aceito." };
  }

  const conteudo: ContentPart[] =
    parsed.data.kind === "text"
      ? [{ type: "text", text: `Texto do orçamento:\n\n${parsed.data.text}` }]
      : [
          {
            type: "text",
            text:
              parsed.data.dataUrls.length === 1
                ? "Imagem do orçamento:"
                : `Imagens das ${parsed.data.dataUrls.length} páginas do orçamento, em ordem:`,
          },
          ...parsed.data.dataUrls.map(
            (url): ContentPart => ({ type: "image_url", image_url: { url } }),
          ),
        ];

  try {
    const resposta = await chatCompletion([
      { role: "system", content: QUOTE_PROMPT },
      { role: "user", content: conteudo },
    ]);

    const proposal = parseQuoteAnswer(
      resposta,
      parsed.data.kind === "text" ? "texto" : "imagem",
      parsed.data.kind === "text" ? parsed.data.text : undefined,
    );

    if (proposal === null) {
      console.error("[orcamento-ia] resposta sem JSON legível", {
        inicio: resposta.slice(0, 200),
      });
      return { configured: true, error: "A IA respondeu num formato que não entendi." };
    }
    return { configured: true, proposal };
  } catch (e) {
    if (e instanceof OpenRouterError) return { configured: true, error: e.message };
    console.error("[orcamento-ia] falha inesperada", e);
    return { configured: true, error: "A leitura com IA falhou." };
  }
}
