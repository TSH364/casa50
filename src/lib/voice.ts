"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voz na Conversa (secao 16): falar a pergunta e ouvir a resposta.
 *
 * Tudo pelo proprio navegador - Web Speech API -, sem servidor nosso nem
 * chave: o reconhecimento e o do sistema. No Chrome (Android e computador) o
 * audio vai para os servidores do Google para virar texto; a tela diz isso.
 * Navegador sem suporte (Firefox) nao mostra o microfone.
 */

interface Resultado {
  isFinal: boolean;
  0: { transcript: string };
}
interface EventoDeFala {
  resultIndex: number;
  results: ArrayLike<Resultado>;
}
interface Reconhecedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: EventoDeFala) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function construtor(): (new () => Reconhecedor) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Reconhecedor;
    webkitSpeechRecognition?: new () => Reconhecedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROS: Record<string, string> = {
  "not-allowed": "O microfone está bloqueado. Libere nas permissões do navegador para este site.",
  "service-not-allowed": "O microfone está bloqueado. Libere nas permissões do navegador para este site.",
  "no-speech": "Não ouvi nada. Toque no microfone e fale de novo.",
  "audio-capture": "Não achei um microfone neste aparelho.",
  network: "O reconhecimento de voz precisa de internet.",
};

/**
 * Ditado: `start` abre o microfone; o texto parcial aparece em `interim`
 * enquanto a pessoa fala; ao parar de falar, `onFinal` recebe a frase.
 */
export function useDictation(onFinal: (text: string) => void, onEmpty?: (reason: string | null) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Reconhecedor | null>(null);
  const final = useRef("");
  const aoTerminar = useRef(onFinal);
  aoTerminar.current = onFinal;
  const aoSilencio = useRef(onEmpty);
  aoSilencio.current = onEmpty;
  const ultimoErro = useRef<string | null>(null);

  // Depois de montar: no servidor nao ha `window`, e decidir la geraria uma
  // tela diferente da do navegador.
  useEffect(() => setSupported(construtor() !== null), []);
  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
    const C = construtor();
    if (!C || rec.current) return;
    setError(null);
    setInterim("");
    final.current = "";
    ultimoErro.current = null;
    const r = new C();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i]!;
        if (res.isFinal) final.current += res[0].transcript;
        else parcial += res[0].transcript;
      }
      setInterim(`${final.current}${parcial}`.trim());
    };
    r.onerror = (e) => {
      ultimoErro.current = e.error;
      // "aborted" e o proprio botao de parar: nao e erro para a pessoa. E
      // "no-speech" no modo conversa e so silencio - quem decide e ele.
      if (e.error === "aborted" || (e.error === "no-speech" && aoSilencio.current)) return;
      setError(ERROS[e.error] ?? "O reconhecimento de voz falhou. Tente de novo.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const texto = final.current.trim();
      setInterim("");
      if (texto) aoTerminar.current(texto);
      else aoSilencio.current?.(ultimoErro.current);
    };
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
      setError("Não consegui abrir o microfone.");
    }
  }, []);

  /** Para de ouvir e envia o que ja foi entendido. */
  const stop = useCallback(() => rec.current?.stop(), []);
  /** Para de ouvir e descarta - sair do modo conversa no meio de uma frase. */
  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.onend = null;
    r.onresult = null;
    r.onerror = null;
    rec.current = null;
    r.abort();
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, interim, error, start, stop, cancel };
}

/**
 * O texto da resposta, bom de ouvir: sem markdown, sem codigos de lancamento
 * (#a1b2c3d4), sem enderecos, e com "R$" lido como reais.
 */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[0-9a-f]{8}\b/gi, "")
    .replace(/[*_`>#|]+/g, " ")
    .replace(/R\$\s?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

/**
 * Pedacos para falar: a primeira frase sozinha (e o audio dela que chega
 * primeiro e comeca a tocar), o resto em blocos de ate ~280 caracteres.
 */
export function speechChunks(text: string): string[] {
  const frases = text.split(/(?<=[.!?…])\s+/).map((f) => f.trim()).filter(Boolean);
  if (frases.length === 0) return [];
  let primeira = frases.shift()!;
  // Frase curta demais ("Pronto.") sozinha soa picotada: junta com a proxima.
  while (primeira.length < 25 && frases.length > 0) primeira = `${primeira} ${frases.shift()!}`;
  const blocos = [primeira];
  let atual = "";
  for (const f of frases) {
    if (atual && atual.length + f.length + 1 > 280) {
      blocos.push(atual);
      atual = f;
    } else atual = atual ? `${atual} ${f}` : f;
  }
  if (atual) blocos.push(atual);
  return blocos.map((b) => b.slice(0, 600));
}

/** A voz do navegador mais natural que houver em pt-BR (as "Google"/"Natural" soam menos robo). */
function melhorVoz(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const pt = vozes.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("pt-br"));
  const boas = /google|natural|neural|online|premium|enhanced|francisca|thalita|luciana/i;
  return pt.find((v) => boas.test(v.name)) ?? pt[0] ?? vozes.find((v) => v.lang.toLowerCase().startsWith("pt"));
}

/**
 * A voz neural falhou uma vez nesta pagina (sem chave, rota recusou, rede):
 * nao tenta de novo a cada frase - cada tentativa seria uma espera a mais
 * antes de falar.
 */
let neuralDesligada = false;

/** Rejeita se a promessa nao resolver no prazo - sem deixar o relogio vivo. */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("lenta")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function audioDe(texto: string, sinal: AbortSignal): Promise<Blob> {
  const r = await fetch("/api/voz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto }),
    signal: sinal,
  });
  const tipo = r.headers.get("content-type") ?? "";
  if (!r.ok || !tipo.startsWith("audio/")) throw new Error("voz indisponivel");
  return r.blob();
}

/**
 * Gera o audio de uma frase pela voz neural, para tocar depois (as falas de
 * espera do modo conversa). Sem voz neural, `null` - e a espera fica em
 * silencio, como antes.
 */
export async function synthesize(text: string): Promise<Blob | null> {
  if (neuralDesligada || typeof window === "undefined") return null;
  try {
    return await audioDe(text, new AbortController().signal);
  } catch {
    return null;
  }
}

/** Toca um audio pronto; `done` resolve ao terminar (ou ao parar). */
export function playBlob(blob: Blob): { done: Promise<void>; stop: () => void } {
  if (typeof window === "undefined" || !("Audio" in window)) return { done: Promise.resolve(), stop: () => {} };
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  let fim: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    fim = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    a.onended = fim;
    a.onerror = fim;
    a.play().catch(fim);
  });
  return {
    done,
    stop: () => {
      a.pause();
      fim();
    },
  };
}

/**
 * Ler em voz alta, em portugues do Brasil.
 *
 * Primeiro a voz neural (rota /api/voz, pelo OpenRouter): os pedacos sao
 * pedidos todos de uma vez e tocados em ordem - a primeira frase comeca a
 * tocar enquanto o resto ainda esta sendo gerado. Se a voz neural nao
 * responder a tempo (7 s) ou falhar, a fala segue na voz do navegador,
 * escolhendo a mais natural que o aparelho tiver.
 */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const atual = useRef<{ cancelar: () => void } | null>(null);

  useEffect(() => setSupported(typeof window !== "undefined" && ("speechSynthesis" in window || "Audio" in window)), []);
  useEffect(
    () => () => {
      atual.current?.cancelar();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  const pelaVozDoNavegador = useCallback((texto: string, cancelado: () => boolean): Promise<void> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || cancelado()) return Promise.resolve();
    const s = window.speechSynthesis;
    s.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "pt-BR";
      u.rate = 1.05;
      const voz = melhorVoz(s.getVoices());
      if (voz) u.voice = voz;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      s.speak(u);
    });
  }, []);

  /** Fala e resolve quando termina (ou e interrompida) - o modo conversa espera. */
  const speak = useCallback(
    /**
     * `after`: o audio ja comeca a ser gerado, mas so toca depois disso - a
     * fala de espera ("deixa eu ver") termina antes de a resposta entrar.
     */
    async (text: string, opts?: { after?: Promise<unknown> }): Promise<void> => {
      atual.current?.cancelar();
      const falar = speakable(text);
      if (!falar || typeof window === "undefined") return;

      let cancelado = false;
      let tocando: HTMLAudioElement | null = null;
      let acordar: (() => void) | null = null;
      const controle = new AbortController();
      atual.current = {
        cancelar: () => {
          cancelado = true;
          controle.abort();
          tocando?.pause();
          if ("speechSynthesis" in window) window.speechSynthesis.cancel();
          acordar?.();
        },
      };
      setSpeaking(true);
      try {
        const pedacos = speechChunks(falar);
        let feitos = 0;
        if (!neuralDesligada && "Audio" in window) {
          // Todos pedidos juntos; cada um toca quando o anterior acaba.
          const audios = pedacos.map((p) => audioDe(p, controle.signal));
          audios.forEach((a) => a.catch(() => {}));
          try {
            for (let i = 0; i < audios.length; i += 1) {
              const blob = i === 0 ? await comPrazo(audios[0]!, 7_000) : await audios[i]!;
              if (i === 0 && opts?.after) await opts.after.catch(() => {});
              if (cancelado) return;
              const url = URL.createObjectURL(blob);
              try {
                tocando = new Audio(url);
                await new Promise<void>((resolve, reject) => {
                  acordar = resolve;
                  tocando!.onended = () => resolve();
                  tocando!.onerror = () => reject(new Error("audio"));
                  tocando!.play().catch(reject);
                });
              } finally {
                URL.revokeObjectURL(url);
              }
              feitos += 1;
            }
            return;
          } catch (e) {
            if (cancelado) return;
            // A rota disse nao (sem chave, voz indisponivel): desliga para as
            // proximas. Lentidao nao desliga - a proxima fala pode vir a tempo.
            if (feitos === 0 && !(e instanceof Error && e.message === "lenta")) neuralDesligada = true;
            controle.abort();
          }
        }
        // O que faltou falar, pela voz do navegador.
        if (opts?.after) await opts.after.catch(() => {});
        await pelaVozDoNavegador(pedacos.slice(feitos).join(" "), () => cancelado);
      } finally {
        setSpeaking(false);
      }
    },
    [pelaVozDoNavegador],
  );

  const stop = useCallback(() => {
    atual.current?.cancelar();
    atual.current = null;
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, stop };
}
