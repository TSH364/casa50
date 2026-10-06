"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { adicionarAoRadar, conferirAgora, definirMeta, removerDoRadar } from "@/actions/radar";
import { ler, type RadarPreco, type RadarProduto } from "@/domain/radar";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/states";

/**
 * O Radar na tela: cadastrar um produto e ver, de cada um, o melhor preco de
 * hoje, a variacao desde a ultima conferencia e o menor ja visto.
 *
 * O preco e o da busca na web - pode mudar na loja. Por isso cada produto diz
 * quando foi conferido e leva ao anuncio para conferir.
 */

export interface RadarItem {
  produto: RadarProduto;
  historico: RadarPreco[];
}

function haQuanto(iso: string | null, agora: number): string {
  if (!iso) return "ainda não conferido";
  const min = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "conferido agora";
  if (min < 60) return `conferido há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `conferido há ${h} h`;
  const d = Math.round(h / 24);
  return `conferido há ${d} dia${d > 1 ? "s" : ""}`;
}

const DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export function RadarManager({ itens, temChave, agora }: { itens: RadarItem[]; temChave: boolean; agora: number }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [meta, setMeta] = useState("");
  const [pending, startTransition] = useTransition();

  function adicionar() {
    startTransition(async () => {
      const r = await adicionarAoRadar({ nome, meta });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setNome("");
      setMeta("");
      toast.success(
        r.achou ? `No radar. Hoje: ${formatCents(r.achou.cents)} na ${r.achou.loja}.` : "No radar. A busca de hoje não achou preço; amanhã tento de novo.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Pôr no radar"
          description="Descreva o produto como numa busca: marca, modelo, tamanho. A meta é opcional: sem ela, o aviso é só de queda."
        />
        {!temChave ? (
          <p className="mb-3 rounded-(--radius-control) bg-attention-soft px-3 py-2.5 text-corpo text-ink">
            O Radar busca os preços com a chave de IA da casa.{" "}
            <Link href="/casa" className="font-medium text-brand underline underline-offset-2">
              Cadastre a chave em Casa
            </Link>
            .
          </p>
        ) : null}
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            adicionar();
          }}
        >
          <Field label="Produto" htmlFor="radar-nome">
            <Input
              id="radar-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Air fryer Mondial 4L"
              maxLength={120}
              autoComplete="off"
            />
          </Field>
          <Field label="Avisar abaixo de (R$)" htmlFor="radar-meta">
            <Input
              id="radar-meta"
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              placeholder="Opcional"
              inputMode="decimal"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={pending || nome.trim().length < 3 || !temChave}>
            <Plus aria-hidden /> {pending ? "Procurando o preço…" : "Pôr no radar"}
          </Button>
        </form>
      </Card>

      {itens.length === 0 ? (
        <Card>
          <EmptyState
            title="Nada no radar ainda"
            description="Ponha aqui o que vocês querem comprar sem pressa. O app confere o preço uma vez por dia e avisa no Início quando cair."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {itens.map((item) => (
            <li key={item.produto.id}>
              <ProdutoCard item={item} agora={agora} temChave={temChave} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProdutoCard({ item, agora, temChave }: { item: RadarItem; agora: number; temChave: boolean }) {
  const router = useRouter();
  const { produto, historico } = item;
  const l = ler(produto, historico);
  const [editando, setEditando] = useState(false);
  const [meta, setMeta] = useState(produto.metaCents ? (produto.metaCents / 100).toFixed(2).replace(".", ",") : "");
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();
  const atual = historico[0] ?? null;

  function conferir() {
    startTransition(async () => {
      const r = await conferirAgora(produto.id);
      if (r.error) toast.error(r.error);
      else toast.success(r.achou ? `Hoje: ${formatCents(r.achou.cents)} na ${r.achou.loja}.` : "A busca não achou preço agora.");
      router.refresh();
    });
  }

  function salvarMeta() {
    startTransition(async () => {
      const r = await definirMeta({ id: produto.id, meta });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  function remover() {
    startTransition(async () => {
      const r = await removerDoRadar(produto.id);
      setConfirmando(false);
      if (r.error) toast.error(r.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-destaque font-semibold tracking-tight text-ink">{produto.nome}</h2>
          <p className="mt-0.5 text-legenda text-ink-faint">
            {haQuanto(produto.conferidoEm, agora)}
            {produto.metaCents ? ` · meta ${formatCents(produto.metaCents)}` : " · sem meta"}
          </p>
        </div>
        {l.abaixoDaMeta && !l.suspeito ? (
          <span className="shrink-0 rounded-full bg-positive-soft px-2.5 py-1 text-legenda font-semibold text-positive">
            Na meta
          </span>
        ) : null}
      </div>

      {atual ? (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="tabular text-2xl font-semibold tracking-tight text-ink">{formatCents(atual.cents)}</p>
            <a
              href={atual.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-corpo text-brand underline-offset-2 hover:underline"
            >
              {atual.loja} <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {!atual.vistoNaPagina ? (
              <p className="text-legenda text-ink-faint">Preço dito pela busca; confira na loja.</p>
            ) : null}
          </div>
          <div className="text-right text-corpo">
            {l.anteriorCents !== null && l.quedaCents !== 0 ? (
              <p className={cn("tabular inline-flex items-center gap-1", l.quedaCents > 0 ? "text-positive" : "text-danger")}>
                {l.quedaCents > 0 ? <ArrowDownRight className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                {l.quedaCents > 0 ? "caiu" : "subiu"} {formatCents(Math.abs(l.quedaCents))}
              </p>
            ) : l.anteriorCents !== null ? (
              <p className="text-ink-faint">igual à última</p>
            ) : null}
            {l.menorCents !== null && historico.length > 1 ? (
              <p className="tabular text-legenda text-ink-faint">menor já visto {formatCents(l.menorCents)}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-corpo text-ink-muted">Ainda sem preço.</p>
      )}

      {l.suspeito ? (
        <p className="mt-2 rounded-(--radius-control) bg-attention-soft px-3 py-2 text-corpo text-ink">
          Bem abaixo do usual: confira se é o mesmo produto (pode ser acessório, refil ou usado).
        </p>
      ) : null}
      {produto.erro ? <p className="mt-2 text-corpo text-danger">{produto.erro}</p> : null}

      {historico.length > 1 ? (
        <details className="mt-3 text-corpo">
          <summary className="cursor-pointer text-ink-muted">Últimas conferências</summary>
          <ul className="mt-2 space-y-1">
            {historico.slice(0, 10).map((p) => (
              <li key={p.em} className="tabular flex justify-between gap-3 text-ink-muted">
                <span>
                  {DIA.format(new Date(p.em))} · {p.loja}
                </span>
                <span className="text-ink">{formatCents(p.cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editando ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvarMeta();
          }}
        >
          <Field label="Avisar abaixo de (R$)" htmlFor={`meta-${produto.id}`}>
            <Input
              id={`meta-${produto.id}`}
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              placeholder="Vazio = sem meta"
              inputMode="decimal"
              className="w-40"
            />
          </Field>
          <Button type="submit" size="sm" disabled={pending}>
            Salvar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="-mb-2 -ml-2 mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" disabled={pending || !temChave} onClick={conferir}>
            <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} /> Conferir agora
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
            <Pencil aria-hidden /> Meta
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(true)}>
            <Trash2 aria-hidden /> Tirar
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Tirar do radar?"
        itemLabel={produto.nome}
        description="O histórico de preços dele é apagado junto."
        confirmLabel="Tirar do radar"
        pending={pending}
        onConfirm={remover}
      />
    </Card>
  );
}
