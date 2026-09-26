"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, FileDown, Trash2 } from "lucide-react";
import { askHouse } from "@/actions/chat";
import type { ChartSpec, ChatMessage, Proposal } from "@/domain/chat";
import { ChatChart } from "./chat-chart";
import { ProposalCard } from "./proposal-card";
import type { ProposalStatus } from "./proposal-card";
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
  proposals?: Proposal[];
  charts?: ChartSpec[];
  /** So quando a pergunta pediu PDF: de qual resposta ele e. */
  pdf?: "esta" | "anterior";
  /** id da proposta -> o que a casa fez com ela, e a frase do resultado. */
  resolved?: Record<string, { status: ProposalStatus; note: string }>;
}

/**
 * O texto que volta ao modelo por uma resposta: a propria resposta, e o que
 * a casa fez com as propostas dela. Sem isto, na pergunta seguinte a IA nao
 * saberia se a classificacao foi feita - e poderia propor de novo, ou dizer
 * que ja estava feita quando foi descartada.
 */
/**
 * Qual entrada vai para o PDF. "anterior" e a ultima resposta de verdade
 * antes desta - pulando erros; sem nenhuma, a propria.
 */
function alvoDoPdf(entradas: readonly Entry[], i: number, pdf: "esta" | "anterior"): number {
  if (pdf === "esta") return i;
  for (let j = i - 1; j >= 0; j -= 1) {
    if (entradas[j]!.role === "assistant" && !entradas[j]!.error) return j;
  }
  return i;
}

function conteudoParaModelo(e: Entry): string {
  const feitos = Object.values(e.resolved ?? {}).map((r) => `[${r.note}]`);
  const pendentes = (e.proposals ?? []).filter((p) => !e.resolved?.[p.id]).length;
  return [
    e.content,
    ...feitos,
    ...(pendentes > 0 ? [`[${pendentes} proposta(s) ainda sem resposta da casa.]`] : []),
  ].join("\n");
}

const SUGESTOES = [
  "Quanto gastamos este mês?",
  "O que falta classificar?",
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
        .map((e) => ({ role: e.role, content: e.role === "assistant" ? conteudoParaModelo(e) : e.content }));
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
            ...(r.proposals?.length ? { proposals: r.proposals } : {}),
            ...(r.charts?.length ? { charts: r.charts } : {}),
            ...(r.pdf ? { pdf: r.pdf } : {}),
          }
        : { role: "assistant", content: r.error ?? "A conversa falhou.", error: true };
      const nova = [...comPergunta, resposta];
      setEntradas(nova);
      gravar(chave, nova);
    });
  }

  function resolver(indice: number, proposalId: string, status: ProposalStatus, note: string) {
    setEntradas((atual) => {
      const nova = atual.map((e, i) =>
        i === indice ? { ...e, resolved: { ...e.resolved, [proposalId]: { status, note } } } : e,
      );
      gravar(chave, nova);
      return nova;
    });
  }

  // Exportar em PDF: a resposta escolhida vai para um bloco que so aparece na
  // impressao, e o dialogo do navegador tem "Salvar como PDF" em todo lugar -
  // computador, iPhone e Android -, sem biblioteca nenhuma.
  const [imprimindo, setImprimindo] = useState<number | null>(null);
  useEffect(() => {
    if (imprimindo === null) return;
    const html = document.documentElement;
    const tema = html.dataset.theme;
    // Papel e claro: tinta escura em fundo branco, qualquer que seja o tema.
    html.dataset.theme = "light";
    const fim = () => {
      if (tema === undefined) delete html.dataset.theme;
      else html.dataset.theme = tema;
      setImprimindo(null);
    };
    window.addEventListener("afterprint", fim, { once: true });
    // Um quadro depois, para o bloco de impressao e o tema claro ja estarem na tela.
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", fim);
    };
  }, [imprimindo]);

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
              {e.charts?.map((c) => <ChatChart key={c.id} chart={c} />)}
              {e.proposals?.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  status={e.resolved?.[p.id]?.status ?? "pendente"}
                  onResolve={(status, note) => resolver(i, p.id, status, note)}
                />
              ))}
              {e.role === "assistant" && !e.error && (e.consulted?.length || e.model) ? (
                <p className="mt-1.5 text-[11px] text-ink-muted">
                  {e.consulted?.length ? `Consultei: ${e.consulted.join(", ")}` : "Respondi com o resumo do mês"}
                  {e.tier ? ` · ${e.tier === "pago" ? "Pago" : "Gratuito"}` : ""}
                  {e.fellBack ? " (o gratuito não respondeu)" : ""}
                  {e.model ? ` · ${e.model}` : ""}
                </p>
              ) : null}
              {/* So quando a pergunta pediu PDF (ver `isPdfRequest`). */}
              {e.role === "assistant" && !e.error && e.pdf ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                  <FileDown className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  <span className="min-w-0 flex-1 text-[12px] text-ink-muted">
                    {e.pdf === "esta" ? "PDF desta resposta" : "PDF da resposta anterior"}
                  </span>
                  <Button size="sm" onClick={() => setImprimindo(alvoDoPdf(entradas, i, e.pdf!))}>
                    Baixar PDF
                  </Button>
                </div>
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

      {imprimindo !== null && entradas[imprimindo] ? (
        <ImpressaoDaResposta
          pergunta={entradas.slice(0, imprimindo).reverse().find((e) => e.role === "user")?.content ?? null}
          resposta={entradas[imprimindo]!}
        />
      ) : null}

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

/**
 * O que vai para o PDF: a pergunta, a resposta e os graficos dela, com data.
 * Invisivel na tela; na impressao, e a unica coisa na pagina (ver
 * `.so-impressao` em globals.css).
 */
function ImpressaoDaResposta({ pergunta, resposta }: { pergunta: string | null; resposta: Entry }) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <section className="so-impressao" aria-hidden>
      <p className="text-[12px] text-ink-muted">Fluxo · Conversa · {hoje}</p>
      {pergunta ? <h1 className="mt-2 text-lg font-semibold text-ink">{pergunta}</h1> : null}
      <div className="mt-3 whitespace-pre-wrap text-sm text-ink">
        <Texto texto={resposta.content} />
      </div>
      {resposta.charts?.map((c) => <ChatChart key={c.id} chart={c} printTable />)}
      {resposta.consulted?.length ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          Dados consultados: {resposta.consulted.join(", ")}. Números calculados pelo app.
        </p>
      ) : null}
    </section>
  );
}
