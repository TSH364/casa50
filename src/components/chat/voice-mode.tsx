"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, Volume2, X } from "lucide-react";
import { applyProposal } from "@/actions/chat";
import type { Proposal } from "@/domain/chat";
import { voiceIntent } from "@/domain/voice-intent";
import { playBlob, synthesize, useDictation, useSpeech } from "@/lib/voice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { proposalDoneNote, proposalPayload, proposalTitle } from "./proposal-apply";
import type { ProposalStatus } from "./proposal-card";

/**
 * Modo conversa por voz (secao 16): maos livres, como uma ligacao.
 *
 * O laco: ouve -> pensa -> fala -> ouve de novo, sem tocar em nada. Dizer
 * "tchau" encerra. Quando a ultima resposta deixou propostas, "pode" confirma
 * e "nao" descarta - com a regra estrita de `voiceIntent`: so a frase inteira
 * sendo uma confirmacao grava alguma coisa. Os cartoes continuam na tela,
 * com botoes, para quem preferir tocar.
 *
 * Dois silencios seguidos pausam o laco: microfone aberto sem ninguem
 * falando gasta bateria e pode pegar conversa que nao era para o app.
 */

export interface PendingProposals {
  index: number;
  proposals: Proposal[];
}

type Fase = "falando" | "ouvindo" | "pensando" | "pausa";

/**
 * O que se diz enquanto pensa. A voz neural leva uns 4 s para comecar a
 * falar; em silencio isso parece travado, com um "deixa eu ver" parece
 * conversa. Geradas uma vez, ao abrir o modo, e tocadas na hora.
 */
const ESPERAS = ["Hum, deixa eu ver.", "Um instante, vou olhar aqui.", "Tá, só um segundo.", "Deixa eu conferir."];

const ROTULO: Record<Fase, string> = {
  falando: "Falando…",
  ouvindo: "Ouvindo…",
  pensando: "Pensando…",
  pausa: "Em pausa",
};

export function VoiceMode({
  greeting,
  ask,
  pending,
  resolve,
  onClose,
}: {
  /** O resumo do dia, falado ao abrir. */
  greeting: string | null;
  /** Manda a pergunta e devolve o texto da resposta (ou do erro). */
  ask: (text: string) => Promise<string>;
  /** As propostas da ultima resposta que ainda esperam a casa. */
  pending: () => PendingProposals | null;
  resolve: (index: number, proposalId: string, status: ProposalStatus, note: string) => void;
  onClose: () => void;
}) {
  const [fase, setFase] = useState<Fase>("falando");
  const [ouvido, setOuvido] = useState("");
  const [resposta, setResposta] = useState(greeting ?? "");
  const [propostas, setPropostas] = useState<Proposal[]>([]);
  const vivo = useRef(true);
  const silencios = useRef(0);
  const esperas = useRef<Blob[]>([]);
  const esperaTocando = useRef<{ stop: () => void } | null>(null);
  const voz = useSpeech();
  const ditado = useDictation(
    (texto) => void aoOuvir(texto),
    (motivo) => {
      if (!vivo.current) return;
      if (motivo === "no-speech" && silencios.current < 1) {
        silencios.current += 1;
        ditado.start();
      } else setFase("pausa");
    },
  );

  function atualizarPropostas() {
    setPropostas(pending()?.proposals ?? []);
  }

  function ouvir() {
    if (!vivo.current) return;
    setOuvido("");
    setFase("ouvindo");
    ditado.start();
  }

  async function dizer(texto: string, depoisDe?: Promise<void>) {
    if (!vivo.current) return;
    setResposta(texto);
    setFase("falando");
    await voz.speak(texto, depoisDe ? { after: depoisDe } : undefined);
    ouvir();
  }

  /** Uma fala de espera, se ja houver alguma pronta. */
  function tocarEspera(): Promise<void> {
    const prontas = esperas.current;
    if (prontas.length === 0) return Promise.resolve();
    const t = playBlob(prontas[Math.floor(Math.random() * prontas.length)]!);
    esperaTocando.current = t;
    return t.done.finally(() => {
      if (esperaTocando.current === t) esperaTocando.current = null;
    });
  }

  async function aplicar(p: PendingProposals, status: "feito" | "descartado") {
    if (status === "descartado") {
      for (const x of p.proposals) resolve(p.index, x.id, "descartado", "Proposta descartada.");
      atualizarPropostas();
      return "Tudo bem, deixei de lado.";
    }
    const feitos: string[] = [];
    for (const x of p.proposals) {
      const r = await applyProposal(proposalPayload(x));
      if (r.error) return `${feitos.join(" ")} Não consegui: ${r.error}`.trim();
      const nota = proposalDoneNote(x, r.count);
      resolve(p.index, x.id, "feito", nota);
      feitos.push(nota);
    }
    atualizarPropostas();
    return `Pronto. ${feitos.join(" ")}`;
  }

  async function aoOuvir(texto: string) {
    if (!vivo.current) return;
    silencios.current = 0;
    setOuvido(texto);
    const p = pending();
    const intencao = voiceIntent(texto, (p?.proposals.length ?? 0) > 0);
    if (intencao === "encerrar") {
      setResposta("Até mais!");
      setFase("falando");
      await voz.speak("Até mais!");
      onClose();
      return;
    }
    setFase("pensando");
    if ((intencao === "confirmar" || intencao === "descartar") && p) {
      await dizer(await aplicar(p, intencao === "confirmar" ? "feito" : "descartado"));
      return;
    }
    // A espera toca enquanto a IA pensa; o audio da resposta ja e gerado
    // enquanto ela termina, e entra logo depois.
    const espera = tocarEspera();
    const r = await ask(texto);
    atualizarPropostas();
    await dizer(r, espera);
  }

  useEffect(() => {
    vivo.current = true;
    // As falas de espera sao geradas ja, em paralelo com o resumo do dia.
    void Promise.all(ESPERAS.map((t) => synthesize(t))).then((bs) => {
      esperas.current = bs.filter((b): b is Blob => b !== null);
    });
    atualizarPropostas();
    if (greeting) void dizer(greeting);
    else ouvir();
    return () => {
      vivo.current = false;
      esperaTocando.current?.stop();
      ditado.cancel();
      voz.stop();
    };
    // So ao abrir: o laco segue pelos callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tocar(status: "feito" | "descartado") {
    const p = pending();
    if (!p) return;
    ditado.cancel();
    setFase("pensando");
    await dizer(await aplicar(p, status));
  }

  const Icone = fase === "ouvindo" ? Mic : fase === "pensando" ? Loader2 : Volume2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conversa por voz"
      className="fixed inset-0 z-50 flex flex-col bg-canvas px-4 pb-6 pt-4"
      style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          <X aria-hidden /> Encerrar
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <button
          type="button"
          onClick={() => {
            // Tocar no circulo: em pausa, volta a ouvir; falando, pula a fala.
            if (fase === "pausa") {
              silencios.current = 0;
              ouvir();
            } else if (fase === "falando") voz.stop();
            else if (fase === "pensando") esperaTocando.current?.stop();
            else if (fase === "ouvindo") ditado.stop();
          }}
          aria-label={fase === "pausa" ? "Continuar a conversa" : fase === "falando" ? "Pular a fala" : fase === "ouvindo" ? "Terminei de falar" : "Pensando"}
          className={cn(
            "relative flex size-36 items-center justify-center rounded-full transition-colors",
            fase === "ouvindo" ? "bg-brand text-on-brand" : fase === "pausa" ? "bg-surface-3 text-ink" : "bg-brand-soft text-brand",
          )}
        >
          {fase === "ouvindo" ? <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" aria-hidden /> : null}
          <Icone className={cn("relative size-12", fase === "pensando" && "animate-spin")} aria-hidden />
        </button>
        <p className="text-sm font-medium text-ink" aria-live="polite">
          {ROTULO[fase]}
        </p>

        {fase === "ouvindo" && ditado.interim ? (
          <p className="max-w-md text-base text-ink">“{ditado.interim}”</p>
        ) : ouvido && fase !== "falando" ? (
          <p className="max-w-md text-corpo text-ink-muted">Você: “{ouvido}”</p>
        ) : null}

        {resposta && (fase === "falando" || fase === "pausa") ? (
          <p className="max-w-md whitespace-pre-wrap text-base leading-relaxed text-ink">{resposta.replace(/\*\*/g, "").replace(/R\$ /g, "R$\u00a0")}</p>
        ) : null}

        {propostas.length > 0 ? (
          <div className="w-full max-w-md rounded-xl border border-line bg-surface px-3 py-2.5 text-left">
            <p className="text-legenda text-ink-muted">Esperando a sua resposta — diga “pode” ou “não”:</p>
            <ul className="mt-1 space-y-0.5">
              {propostas.map((p) => (
                <li key={p.id} className="text-corpo font-medium text-ink">
                  {proposalTitle(p)}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void tocar("feito")} disabled={fase === "pensando"}>
                <Check aria-hidden /> Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void tocar("descartado")} disabled={fase === "pensando"}>
                <X aria-hidden /> Descartar
              </Button>
            </div>
          </div>
        ) : null}

        {ditado.error ? (
          <p role="alert" className="max-w-md text-corpo text-danger">
            {ditado.error}
          </p>
        ) : null}
      </div>

      <p className="text-center text-legenda text-ink-muted">
        {fase === "pausa" ? "Toque no círculo para continuar." : "Diga “tchau” para encerrar."} A voz é transcrita pelo
        navegador (no Chrome, pelos servidores do Google).
      </p>
    </div>
  );
}
