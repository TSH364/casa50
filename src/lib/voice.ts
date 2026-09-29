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

/** Ler em voz alta, em portugues do Brasil. */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  /** Fala e resolve quando termina (ou e interrompida) - o modo conversa espera. */
  const speak = useCallback((text: string): Promise<void> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    const s = window.speechSynthesis;
    s.cancel();
    const falar = speakable(text);
    if (!falar) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(falar);
      u.lang = "pt-BR";
      const vozes = s.getVoices();
      const voz = vozes.find((v) => v.lang.toLowerCase().startsWith("pt-br")) ?? vozes.find((v) => v.lang.toLowerCase().startsWith("pt"));
      if (voz) u.voice = voz;
      const fim = () => {
        setSpeaking(false);
        resolve();
      };
      u.onend = fim;
      u.onerror = fim;
      setSpeaking(true);
      s.speak(u);
    });
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, stop };
}
