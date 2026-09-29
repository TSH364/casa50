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
export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Reconhecedor | null>(null);
  const final = useRef("");
  const aoTerminar = useRef(onFinal);
  aoTerminar.current = onFinal;

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
      // "aborted" e o proprio botao de parar: nao e erro para a pessoa.
      if (e.error !== "aborted") setError(ERROS[e.error] ?? "O reconhecimento de voz falhou. Tente de novo.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const texto = final.current.trim();
      setInterim("");
      if (texto) aoTerminar.current(texto);
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

  return { supported, listening, interim, error, start, stop };
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

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const s = window.speechSynthesis;
    s.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = "pt-BR";
    const voz = s.getVoices().find((v) => v.lang.toLowerCase().startsWith("pt-br")) ?? s.getVoices().find((v) => v.lang.toLowerCase().startsWith("pt"));
    if (voz) u.voice = voz;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    s.speak(u);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, stop };
}
