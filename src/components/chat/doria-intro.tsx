"use client";

import { Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DoriMark } from "@/components/doria/dori-mark";

/**
 * A primeira vez pela voz: explica antes de o navegador pedir o microfone.
 *
 * Pedir o microfone sem aviso, de um botao que a pessoa tocou esperando
 * "abrir a Dor.IA", assusta - e no onibus ou no trabalho a voz nem e o que
 * se quer. Por isso a escolha aqui e dela, e as duas saidas ficam lembradas.
 */
export function DoriaIntro({
  onPermitir,
  onEscrever,
  onFechar,
}: {
  onPermitir: () => void;
  onEscrever: () => void;
  onFechar: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="doria-intro-titulo"
      className="fixed inset-0 z-50 flex flex-col bg-canvas px-5 pt-4"
      style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" onClick={onFechar} aria-label="Fechar">
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
        <span className="flex size-36 items-center justify-center rounded-full bg-doria">
          <DoriMark size={112} />
        </span>
        <div className="max-w-sm space-y-3">
          <h1 id="doria-intro-titulo" className="text-numero font-bold tracking-tight text-ink">
            Posso ouvir você?
          </h1>
          <p className="text-destaque text-ink-muted">
            É só falar o que precisa, como “quanto gastamos com mercado?” ou “cria uma meta para a viagem”. O
            navegador vai pedir o microfone; no Chrome, a voz é transcrita pelo Google.
          </p>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-2.5">
        <Button size="lg" onClick={onPermitir}>
          <Mic aria-hidden /> Permitir o microfone
        </Button>
        <Button size="lg" variant="outline" onClick={onEscrever}>
          Prefiro escrever
        </Button>
        <p className="mt-1 text-center text-corpo text-ink-faint">
          Depois, a Dor.IA abre do jeito que você usou por último. Segure o botão dela para escrever.
        </p>
      </div>
    </div>
  );
}
