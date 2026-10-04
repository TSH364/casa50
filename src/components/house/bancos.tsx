"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Landmark, RefreshCw } from "lucide-react";
import {
  apagarConexaoBancaria,
  salvarConexaoBancaria,
  sincronizarBancos,
  type ContaEncontrada,
} from "@/actions/bancos";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";

/**
 * Bancos pelo Meu Pluggy, na tela da Casa.
 *
 * Cada pessoa conecta os PROPRIOS bancos (o Meu Pluggy gratuito e por CPF) e
 * ve so o estado da conexao da outra. O Client Secret entra e nao volta, como
 * a chave da IA: a tela mostra os quatro ultimos caracteres.
 *
 * O passo a passo e parte da funcionalidade: ninguem sabe de cor que o Item ID
 * fica no Dashboard da Pluggy, e nao no Meu Pluggy.
 */

export interface ConexaoResumo {
  memberId: string;
  nome: string;
  clientId: string;
  secretHint: string | null;
  itemIds: string[];
  lastSyncAt: string | null;
  lastError: string | null;
}

function haQuanto(iso: string | null): string {
  if (!iso) return "ainda não sincronizou";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "sincronizou agora há pouco";
  if (min < 60) return `sincronizou há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `sincronizou há ${h} h`;
  const d = Math.round(h / 24);
  return `sincronizou há ${d} dia${d > 1 ? "s" : ""}`;
}

export function Bancos({
  minha,
  outras,
  podeConectar,
}: {
  minha: ConexaoResumo | null;
  outras: ConexaoResumo[];
  podeConectar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [clientId, setClientId] = useState(minha?.clientId ?? "");
  const [segredo, setSegredo] = useState("");
  const [itens, setItens] = useState((minha?.itemIds ?? []).join("\n"));
  const [contas, setContas] = useState<ContaEncontrada[] | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();

  const temAlguma = minha !== null || outras.length > 0;

  function salvar() {
    startTransition(async () => {
      const r = await salvarConexaoBancaria({ clientId, clientSecret: segredo, itemIds: itens });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setContas(r.contas ?? []);
      setSegredo("");
      setEditando(false);
      toast.success("Bancos conectados. Trazendo as compras…");
      const s = await sincronizarBancos({ forcar: true });
      if (s.erros.length > 0) toast.error(s.erros[0]!);
      else toast.success(s.novos > 0 ? `${s.novos} compra(s) do cartão entraram.` : "Nenhuma compra nova por enquanto.");
      router.refresh();
    });
  }

  function sincronizarAgora() {
    startTransition(async () => {
      const s = await sincronizarBancos({ forcar: true });
      if (s.erros.length > 0) toast.error(s.erros[0]!);
      else toast.success(s.novos > 0 ? `${s.novos} compra(s) do cartão entraram.` : "Tudo em dia. Nenhuma compra nova.");
      router.refresh();
    });
  }

  function desconectar() {
    startTransition(async () => {
      const r = await apagarConexaoBancaria();
      setConfirmando(false);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Bancos desconectados. O que já entrou continua no app.");
      setClientId("");
      setItens("");
      setContas(null);
      router.refresh();
    });
  }

  const formulario = (
    <div className="space-y-3">
      <details className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5 text-corpo text-ink-muted">
        <summary className="cursor-pointer font-medium text-ink">Onde pego esses dados?</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Em{" "}
            <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
              meu.pluggy.ai <ExternalLink className="inline size-3" aria-hidden />
            </a>
            , conecte seus bancos (Itaú, Nubank, C6…).
          </li>
          <li>
            No{" "}
            <a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
              Dashboard da Pluggy <ExternalLink className="inline size-3" aria-hidden />
            </a>
            , abra a aplicação demo e conecte os itens do Meu Pluggy.
          </li>
          <li>Copie dali o Client ID, o Client Secret e o Item ID de cada banco conectado.</li>
        </ol>
      </details>

      <Field label="Client ID" htmlFor="pluggy-client-id">
        <Input
          id="pluggy-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field
        label="Client Secret"
        htmlFor="pluggy-secret"
        hint={minha?.secretHint ? `Salvo (${minha.secretHint}). Deixe em branco para manter.` : "Fica criptografado; a tela nunca mostra de volta."}
      >
        <Input
          id="pluggy-secret"
          type="password"
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Item IDs" htmlFor="pluggy-itens" hint="Um por linha: um para cada banco conectado.">
        <Textarea
          id="pluggy-itens"
          value={itens}
          onChange={(e) => setItens(e.target.value)}
          rows={3}
          spellCheck={false}
          className="font-mono text-corpo"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || clientId.trim() === "" || itens.trim() === ""} onClick={salvar}>
          {pending ? "Testando…" : "Testar e salvar"}
        </Button>
        {minha ? (
          <Button variant="ghost" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Bancos (Meu Pluggy)"
        description="As compras do cartão chegam sozinhas, uma vez por dia, e ficam aguardando a fatura. Quando a fatura chega, ela entra no lugar sem contar duas vezes."
      />

      {temAlguma ? (
        <ul className="mb-3 space-y-2">
          {[...(minha ? [minha] : []), ...outras].map((c) => (
            <li key={c.memberId} className="flex items-start gap-3 rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
              <Landmark className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {c.nome} · {c.itemIds.length} banco{c.itemIds.length === 1 ? "" : "s"}
                </p>
                <p className={c.lastError ? "text-corpo text-danger" : "text-corpo text-ink-faint"}>
                  {c.lastError ?? haQuanto(c.lastSyncAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {contas && contas.length > 0 ? (
        <div className="mb-3 rounded-(--radius-control) bg-positive-soft px-3 py-2.5 text-corpo text-ink">
          <p className="font-medium">Encontrei:</p>
          <ul className="mt-1 space-y-0.5">
            {contas.map((c, i) => (
              <li key={i}>
                {c.nome}
                {c.final ? ` ···· ${c.final}` : ""}
                <span className="text-ink-faint">
                  {c.tipo === "cartao" ? " · cartão" : " · conta (por enquanto, só os cartões entram)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!podeConectar ? null : minha === null || editando ? (
        formulario
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={sincronizarAgora}>
            <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} /> Sincronizar agora
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
            Editar meus bancos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(true)}>
            Desconectar
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Desconectar seus bancos?"
        itemLabel={minha ? `${minha.itemIds.length} banco${minha.itemIds.length === 1 ? "" : "s"} no Meu Pluggy` : "Meu Pluggy"}
        description="As compras que já entraram continuam no app. Novas compras param de chegar até você conectar de novo."
        confirmLabel="Desconectar"
        pending={pending}
        onConfirm={desconectar}
      />
    </Card>
  );
}
