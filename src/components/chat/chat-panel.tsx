"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Trash2 } from "lucide-react";
import { askHouse } from "@/actions/chat";
import type { ChatMessage } from "@/domain/chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A conversa com os dados da casa (secao 16).
 *
 * A conversa fica NESTE aparelho (localStorage), e em nenhum outro lugar:
 * nao ha tabela de conversas no banco. Cada pessoa conversa no seu celular,
 * e "Limpar" apaga de verdade. O que ja foi para o provedor gratuito, porem,
 * ja foi - e a tela diz isso antes da primeira pergunta.
 */

interface Entry extends ChatMessage {
  consulted?: string[];
  model?: string | null;
  tier?: "gratuito" | "pago";
  fellBack?: boolean;
  error?: boolean;
}

const SUGESTOES = [
  "Quanto gastamos este mês?",
  "Onde mais gastamos com alimentação nos últimos 3 meses?",
  "Quais parcelas ainda vão cair?",
  "Como estão os orçamentos e as metas?",
];

/** Guarda so as ultimas: a conversa inteira de meses nao cabe nem ajuda. */
const MAX_GUARDADAS = 40;

function ler(chave: string): Entry[] {
  try {
    const bruto = window.localStorage.getItem(chave);
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista)
      ? lista.filter(
          (e): e is Entry =>
            typeof e === "object" && e !== null &&
            (e.role === "user" || e.role === "assistant") && typeof e.content === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function gravar(chave: string, entradas: Entry[]) {
  try {
    window.localStorage.setItem(chave, JSON.stringify(entradas.slice(-MAX_GUARDADAS)));
  } catch {
    // Navegacao privada ou armazenamento cheio: a conversa segue, so nao
    // sobrevive a recarga.
  }
}

/** Negrito do markdown, que os modelos usam muito; o resto vai como texto. */
function Texto({ texto }: { texto: string }) {
  // "R$" nunca fica sozinho no fim da linha, longe do numero.
  const partes = texto.replace(/R\$ /g, "R$\u00a0").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ChatPanel({ houseId }: { houseId: string }) {
  const chave = `fluxo-conversa:${houseId}`;
  const [entradas, setEntradas] = useState<Entry[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [pending, startTransition] = useTransition();
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => setEntradas(ler(chave)), [chave]);
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entradas.length, pending]);

  function enviar(texto: string) {
    const limpo = texto.trim();
    if (!limpo || pending) return;
    const comPergunta: Entry[] = [...entradas, { role: "user", content: limpo }];
    setEntradas(comPergunta);
    gravar(chave, comPergunta);
    setPergunta("");

    startTransition(async () => {
      // As respostas de erro nao voltam para o modelo: sao da tela, nao da
      // conversa.
      const historico = comPergunta
        .filter((e) => !e.error)
        .map(({ role, content }) => ({ role, content }));
      let r: Awaited<ReturnType<typeof askHouse>>;
      try {
        r = await askHouse({ messages: historico });
      } catch {
        r = { error: "Não consegui falar com o servidor. Confira a internet e tente de novo." };
      }
      const resposta: Entry = r.answer
        ? {
            role: "assistant",
            content: r.answer,
            consulted: r.consulted,
            model: r.model,
            tier: r.tier,
            fellBack: r.fellBack,
          }
        : { role: "assistant", content: r.error ?? "A conversa falhou.", error: true };
      const nova = [...comPergunta, resposta];
      setEntradas(nova);
      gravar(chave, nova);
    });
  }

  function limpar() {
    setEntradas([]);
    try {
      window.localStorage.removeItem(chave);
    } catch {
      // idem
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {entradas.length === 0 ? (
        <div className="space-y-3">
          <p className="rounded-[--radius-control] bg-attention-soft px-3.5 py-2.5 text-[13px] text-attention">
            O Jev escolhe quem responde. Perguntas simples vão a modelos{" "}
            <strong className="font-semibold">gratuitos</strong>, e o provedor pode guardar e usar
            o que recebe (lojas, valores, nomes) para treinar modelos. Análises e pedidos de mudar
            dados vão a um modelo pago que não guarda. Não vão e-mails, cartões nem anotações.
          </p>
          <p className="text-[12px] text-ink-muted">
            Os gratuitos têm limite de 50 chamadas por dia na conta do OpenRouter; quando acaba, o
            pago assume sozinho.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => enviar(s)}
                disabled={pending}
                className="min-h-9 rounded-full border border-line bg-surface-2 px-3.5 text-left text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ol className="space-y-3" aria-live="polite">
        {entradas.map((e, i) => (
          <li
            key={i}
            className={cn("flex", e.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm",
                e.role === "user" && "rounded-br-md bg-brand-soft text-ink",
                e.role === "assistant" && !e.error && "rounded-bl-md bg-surface-2 text-ink",
                e.error && "rounded-bl-md bg-danger-soft text-danger",
              )}
            >
              <Texto texto={e.content} />
              {e.role === "assistant" && !e.error && (e.consulted?.length || e.model) ? (
                <p className="mt-1.5 text-[11px] text-ink-muted">
                  {e.consulted?.length ? `Consultei: ${e.consulted.join(", ")}` : "Respondi com o resumo do mês"}
                  {e.tier ? ` · ${e.tier === "pago" ? "Pago" : "Gratuito"}` : ""}
                  {e.fellBack ? " (o gratuito não respondeu)" : ""}
                  {e.model ? ` · ${e.model}` : ""}
                </p>
              ) : null}
            </div>
          </li>
        ))}
        {pending ? (
          <li className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5 text-sm text-ink-faint">
              Consultando os dados…
            </div>
          </li>
        ) : null}
      </ol>
      <div ref={fim} />

      <form
        className="sticky bottom-20 flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 md:bottom-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          enviar(pergunta);
        }}
      >
        <textarea
          value={pergunta}
          onChange={(ev) => setPergunta(ev.target.value)}
          onKeyDown={(ev) => {
            // Enter envia; Shift+Enter quebra linha, como em qualquer chat.
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              enviar(pergunta);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Pergunte sobre os gastos…"
          aria-label="Pergunta"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <Button type="submit" size="icon" disabled={pending || !pergunta.trim()} aria-label="Enviar">
          <ArrowUp aria-hidden />
        </Button>
      </form>

      {entradas.length > 0 ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={limpar} disabled={pending}>
            <Trash2 aria-hidden /> Limpar conversa
          </Button>
        </div>
      ) : null}
    </div>
  );
}
