"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { aiKeyUsage, removeAiKey, saveAiKey, saveQuoteModel } from "@/actions/ai-settings";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { OPENROUTER_KEY_RE, QUOTE_MODELS } from "@/domain/ai-models";
import type { AiStatus } from "@/lib/ai-config";
import type { KeyInfo } from "@/lib/openrouter";

/**
 * A chave do OpenRouter, na tela da Casa.
 *
 * A CHAVE ENTRA E NAO VOLTA. O campo so recebe; depois de salvar, a tela
 * mostra os quatro ultimos caracteres - o bastante para saber QUAL chave esta
 * la, pouco para usa-la. Nao ha botao de "mostrar chave", de proposito.
 *
 * O texto de instrucao e parte da funcionalidade, como na tela de agendas:
 * ninguem sabe de cor onde se cria a chave nem que da para limitar o gasto
 * dela - e o limite e a protecao que importa aqui.
 */

const USD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function AiSettings({
  status,
  canManage,
}: {
  status: AiStatus;
  canManage: boolean;
}) {
  const [chave, setChave] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [gasto, setGasto] = useState<KeyInfo | null>(null);
  const [erroGasto, setErroGasto] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const temChave = status.source !== null;
  const doServidor = status.source === "servidor";

  // O gasto e buscado depois de a tela aparecer: a pagina nao espera o
  // OpenRouter, e se ele estiver fora do ar so esta linha fica sem numero.
  useEffect(() => {
    if (!temChave) return;
    let vivo = true;
    void aiKeyUsage().then((r) => {
      if (!vivo) return;
      if (r.info) setGasto(r.info);
      else if (r.error) setErroGasto(r.error);
    });
    return () => {
      vivo = false;
    };
  }, [temChave, status.keyHint]);

  const formatoOk = OPENROUTER_KEY_RE.test(chave.trim());

  function salvar() {
    if (!formatoOk) {
      toast.error("Isto não parece uma chave do OpenRouter (começa com sk-or-).");
      return;
    }
    startTransition(async () => {
      const r = await saveAiKey({ key: chave });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      // A chave some do campo assim que foi aceita: deixar o texto ali
      // seria deixar a chave na tela de quem olhar por cima do ombro.
      setChave("");
      setTrocando(false);
      if (r.info) setGasto(r.info);
      if (r.warning) toast.warning(r.warning);
      else toast.success("Chave testada e guardada.");
    });
  }

  function remover() {
    startTransition(async () => {
      const r = await removeAiKey();
      setConfirmarRemocao(false);
      if (r.error) toast.error(r.error);
      else {
        setGasto(null);
        toast.success("Chave apagada.");
      }
    });
  }

  function trocarModelo(model: string) {
    startTransition(async () => {
      const r = await saveQuoteModel({ model });
      if (r.error) toast.error(r.error);
      else toast.success("Modelo guardado.");
    });
  }

  const mostrarCampo = canManage && !doServidor && (!temChave || trocando);

  return (
    <Card>
      <CardHeader
        title="Inteligência artificial"
        description="Lê orçamento em PDF e foto, o Jev classifica lançamentos, e a Conversa responde perguntas sobre os dados. Usa a sua conta do OpenRouter."
      />

      <div className="space-y-3">
        {/* O estado, sempre visível — inclusive para quem não pode mexer. */}
        <div className="flex items-start gap-2.5 rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
          <KeyRound
            className={temChave ? "mt-0.5 size-4 text-positive" : "mt-0.5 size-4 text-ink-faint"}
            aria-hidden
          />
          <div className="min-w-0 flex-1 text-[13px]">
            {doServidor ? (
              <p className="text-ink">
                Chave definida no servidor (Vercel).
                <span className="block text-[12px] text-ink-faint">
                  É ela que vale. Para trocar, é no painel da Vercel.
                </span>
              </p>
            ) : temChave ? (
              <p className="text-ink">
                Chave guardada <span className="tabular text-ink-muted">{status.keyHint}</span>
                <span className="block text-[12px] text-ink-faint">
                  Criptografada no banco. O app só mostra o final dela.
                </span>
              </p>
            ) : (
              <p className="text-ink-muted">
                Nenhuma chave. Sem ela, o orçamento é lido sem IA, foto não é lida, e o Jev
                não classifica.
              </p>
            )}

            {gasto ? (
              <p className="tabular mt-1 text-[12px] text-ink-faint">
                Gasto: {USD.format(gasto.usageUsd)}
                {gasto.limitUsd !== null ? (
                  ` de ${USD.format(gasto.limitUsd)} de limite`
                ) : (
                  // Sem limite é o caso que pede atenção: é o único em que um
                  // erro que repita chamadas não tem teto.
                  <span className="text-attention"> · sem limite de gasto</span>
                )}
              </p>
            ) : erroGasto ? (
              <p className="mt-1 text-[12px] text-attention">{erroGasto}</p>
            ) : null}
          </div>
        </div>

        {mostrarCampo ? (
          <div className="space-y-1.5">
            <Input
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder="sk-or-…"
              // Nem o navegador deve lembrar: gerenciador de senha que oferece
              // "salvar" transforma a chave num campo preenchido em outro site.
              autoComplete="off"
              spellCheck={false}
              aria-label="Chave do OpenRouter"
            />
            {chave !== "" && !formatoOk ? (
              <p className="text-[12px] text-attention">
                A chave do OpenRouter começa com sk-or-.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button disabled={pending || !formatoOk} onClick={salvar}>
                {pending ? "Testando…" : "Testar e guardar"}
              </Button>
              {trocando ? (
                <Button variant="ghost" onClick={() => setTrocando(false)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
            <p className="text-[12px] text-ink-faint">
              A chave é testada no OpenRouter antes de ser guardada. Chave recusada não entra.
            </p>
          </div>
        ) : null}

        {canManage && !doServidor && temChave && !trocando ? (
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setTrocando(true)}>
              Trocar chave
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmarRemocao(true)}
              disabled={pending}
            >
              <Trash2 aria-hidden /> Apagar
            </Button>
          </div>
        ) : null}

        {canManage ? (
          <a
            href="https://openrouter.ai/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-brand underline underline-offset-2"
          >
            Criar chave no OpenRouter
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {temChave ? (
          // A conversa usa modelos gratuitos, e o OpenRouter so libera os
          // gratuitos com esta opcao ligada na conta - sem ela, toda pergunta
          // volta com "nenhum modelo disponivel".
          <p className="text-[12px] text-ink-faint">
            Para a Conversa (modelos gratuitos): no OpenRouter, em{" "}
            <a
              href="https://openrouter.ai/settings/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline underline-offset-2"
            >
              Settings → Privacy
            </a>
            , ligue os endpoints gratuitos. Eles podem usar as conversas para treino.
          </p>
        ) : null}
        {canManage && !doServidor ? (
          <p className="text-[12px] text-ink-faint">
            Ao criar, ponha um limite de gasto na chave. É o teto que protege a conta se algo
            repetir chamadas — e quem tem acesso à casa consegue usar a chave.
          </p>
        ) : null}

        {/* O modelo só importa com chave, e só quem gerencia troca. */}
        {temChave ? (
          <div className="space-y-1 border-t border-line pt-3">
            <p className="text-[12px] text-ink-faint">Modelo para ler orçamento</p>
            <Select
              value={status.quoteModel}
              disabled={!canManage || status.quoteModelLocked || pending}
              onChange={(e) => trocarModelo(e.target.value)}
              options={
                // O da Vercel pode não estar na lista; aparece assim mesmo,
                // para a tela não mentir sobre o que está em uso.
                QUOTE_MODELS.some((m) => m.id === status.quoteModel)
                  ? QUOTE_MODELS.map((m) => ({ value: m.id, label: `${m.label} (${m.note})` }))
                  : [{ value: status.quoteModel, label: status.quoteModel }]
              }
              aria-label="Modelo para ler orçamento"
            />
            <p className="text-[12px] text-ink-faint">
              {status.quoteModelLocked
                ? "Definido no servidor (Vercel)."
                : "O Claude lê melhor foto torta e letra miúda; o Gemini custa menos."}
            </p>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmarRemocao}
        onOpenChange={setConfirmarRemocao}
        title="Apagar a chave?"
        itemLabel={status.keyHint ? `Chave ${status.keyHint}` : "Chave do OpenRouter"}
        description="A leitura de orçamento volta a ser sem IA, e foto deixa de ser lida. A chave continua existindo no OpenRouter — para desativá-la de vez, é lá."
        confirmLabel="Apagar chave"
        pending={pending}
        onConfirm={remover}
      />
    </Card>
  );
}
