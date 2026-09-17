"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  addProjectItem,
  addQuote,
  chooseQuote,
  removePurchase,
  setItemClosed,
  setItemPriority,
} from "@/actions/project";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { QuotePdfInput } from "./quote-pdf-input";
import { NovaCompra } from "./new-purchase";
import { PAYMENT_LABEL, PRIORITY_LABEL } from "@/domain/purchase";
import { formatCents as fc } from "@/lib/money";
import { formatCents, parseAmountCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  byStage,
  type ItemProgress,
  type ItemStatus,
  type ProjectSummary,
} from "@/domain/project";

/**
 * O projeto por dentro (secao 15).
 *
 * A tela responde uma pergunta só, e por isso o item é a unidade: "o que foi
 * comprado, o que não foi, o que foi comprado pela metade". O status nunca é
 * digitado — ele sai da soma das compras, então não tem como estar
 * desatualizado em relação ao que a casa registrou.
 */

const ROTULO: Record<ItemStatus, string> = {
  nao_comprado: "a comprar",
  parcial: "parcial",
  comprado: "comprado",
};

/**
 * A cor diz o estado, e o texto também — sempre os dois juntos.
 *
 * "Parcial" é o estado que o pedido nomeou, então ele fica com a cor de
 * atenção: é o que precisa de decisão. Verde é o que já saiu da frente.
 */
const TOM: Record<ItemStatus, string> = {
  nao_comprado: "bg-surface-3 text-ink-faint",
  parcial: "bg-attention/15 text-attention",
  comprado: "bg-positive/15 text-positive",
};

/** Quantidade sem zeros à toa: 40 e não 40,000; 2,5 continua 2,5. */
const QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function Chip({ status }: { status: ItemStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TOM[status],
      )}
    >
      {ROTULO[status]}
    </span>
  );
}

export function ProjectManager({
  projectId,
  summary,
}: {
  projectId: string;
  summary: ProjectSummary;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [novoItem, setNovoItem] = useState(false);

  const grupos = byStage(summary.items);

  return (
    <div className="space-y-4">
      <Panel>
        <CardHeader
          title="O projeto em números"
          description="O previsto vem da cotação escolhida de cada item; o gasto, das compras registradas."
        />

        {/* Empilhado, e não em três colunas: MEDIDO a 360px, "R$ 23.120,00"
            não cabe num terço da largura e o último dígito era cortado.
            Número de obra tem uma casa a mais que número de mês. */}
        <dl className="space-y-1">
          {[
            ["Previsto", formatCents(summary.expectedCents), "text-ink"],
            ["Já gasto", formatCents(summary.spentCents), "text-ink"],
            ["Falta", formatCents(summary.remainingCents), "text-attention"],
          ].map(([rotulo, valor, tom]) => (
            <div
              key={rotulo}
              className="flex items-baseline justify-between gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2"
            >
              <dt className="text-[12px] text-ink-faint">{rotulo}</dt>
              <dd className={cn("tabular text-sm font-semibold", tom)}>{valor}</dd>
            </div>
          ))}
        </dl>

        {/* O previsto precisa dizer de quantos itens ele fala. Sem esta linha,
            "previsto R$ 26.000" parece o custo da obra quando pode ser o de
            metade dela. */}
        {summary.itemsWithoutQuote > 0 ? (
          <p className="mt-2.5 text-[12px] text-ink-faint">
            {summary.itemsWithoutQuote} {summary.itemsWithoutQuote === 1 ? "item ainda não tem" : "itens ainda não têm"}{" "}
            cotação — o previsto acima não fala {summary.itemsWithoutQuote === 1 ? "dele" : "deles"}.
          </p>
        ) : null}
        {summary.itemsAwaitingChoice > 0 ? (
          <p className="mt-1 text-[12px] text-attention">
            {summary.itemsAwaitingChoice}{" "}
            {summary.itemsAwaitingChoice === 1
              ? "item tem propostas esperando escolha"
              : "itens têm propostas esperando escolha"}.
          </p>
        ) : null}

        <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[12px] text-ink-faint">
          <span>
            {summary.byStatus.comprado}{" "}
            {summary.byStatus.comprado === 1 ? "comprado" : "comprados"}
          </span>
          <span>
            {summary.byStatus.parcial}{" "}
            {summary.byStatus.parcial === 1 ? "parcial" : "parciais"}
          </span>
          <span>{summary.byStatus.nao_comprado} a comprar</span>
        </p>
      </Panel>

      {grupos.map(({ stage, items }) => (
        <Panel key={stage ?? "sem-etapa"}>
          <CardHeader title={stage ?? "Sem etapa"} />
          <ul className="space-y-2">
            {items.map((p) => (
              <ItemRow
                key={p.item.id}
                progress={p}
                open={aberto === p.item.id}
                pending={pending}
                onToggle={() =>
                  setAberto(aberto === p.item.id ? null : p.item.id)
                }
                startTransition={startTransition}
              />
            ))}
          </ul>
        </Panel>
      ))}

      <Panel>
        {novoItem ? (
          <NovoItem
            projectId={projectId}
            pending={pending}
            startTransition={startTransition}
            onDone={() => setNovoItem(false)}
          />
        ) : (
          <Button variant="outline" onClick={() => setNovoItem(true)}>
            <Plus aria-hidden /> Adicionar item
          </Button>
        )}
      </Panel>
    </div>
  );
}

function ItemRow({
  progress,
  open,
  pending,
  onToggle,
  startTransition,
}: {
  progress: ItemProgress;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  startTransition: (fn: () => void) => void;
}) {
  const { item, status, chosen, expectedCents, spentCents, boughtQuantity } = progress;
  const temQuantidade = item.plannedQuantity !== null;

  return (
    <li className="rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <Chip status={status} />
        <span className="min-w-0 flex-1 break-words text-[13px] text-ink">
          {item.name}
        </span>
        {/* Só a prioridade ALTA ganha marca na lista fechada. Marcar os três
            níveis encheria a tela de etiqueta e faria "alta" deixar de saltar,
            que é a única coisa que ela precisa fazer. */}
        {item.priority === 1 ? (
          <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">
            1º
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0 text-ink-faint transition-transform", open && "rotate-180")}
        />
      </button>

      {/* A barra é da QUANTIDADE quando há quantidade prevista — foi a
          decisão que desenha o módulo. Sem quantidade, ela é do valor. */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn(
            "h-full rounded-full",
            status === "comprado" ? "bg-positive" : "bg-attention",
          )}
          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>

      <p className="tabular mt-1.5 flex flex-wrap justify-between gap-x-2 text-[12px] text-ink-faint">
        <span>
          {temQuantidade ? (
            <>
              {QTD.format(boughtQuantity ?? 0)} de {QTD.format(item.plannedQuantity!)}
              {item.unit ? ` ${item.unit}` : ""}
            </>
          ) : (
            "sem quantidade prevista"
          )}
        </span>
        <span>
          {formatCents(spentCents)}
          {expectedCents !== null ? ` de ${formatCents(expectedCents)}` : ""}
          {progress.overCents > 0 ? (
            <span className="text-danger"> · passou {formatCents(progress.overCents)}</span>
          ) : null}
        </span>
      </p>

      {/* Quando não há escolha feita, o previsto vem da menor proposta — e a
          tela diz isso, em vez de deixar parecer decisão tomada. */}
      {chosen === null && progress.quoteCount > 0 ? (
        <p className="mt-1 text-[12px] text-attention">
          {progress.quoteCount === 1
            ? "1 proposta recebida, nenhuma escolhida"
            : `${progress.quoteCount} propostas, nenhuma escolhida`}{" "}
          — o previsto é a menor.
        </p>
      ) : null}

      {open ? (
        <ItemDetalhe
          progress={progress}
          pending={pending}
          startTransition={startTransition}
        />
      ) : null}
    </li>
  );
}

function ItemDetalhe({
  progress,
  pending,
  startTransition,
}: {
  progress: ItemProgress;
  pending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const { item } = progress;
  const [aba, setAba] = useState<"cotacoes" | "compras">("cotacoes");

  function acao(fn: () => Promise<{ error?: string }>, sucesso: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else toast.success(sucesso);
    });
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex gap-1" role="tablist">
        {(["cotacoes", "compras"] as const).map((chave) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            className={cn(
              "rounded-[--radius-control] px-2.5 py-1 text-[12px]",
              aba === chave ? "bg-surface-3 text-ink" : "text-ink-faint",
            )}
          >
            {chave === "cotacoes"
              ? `Cotações (${item.quotes.length})`
              : `Compras (${item.purchases.length})`}
          </button>
        ))}
      </div>

      {aba === "cotacoes" ? (
        <>
          <ul className="space-y-1">
            {item.quotes.map((q) => (
              <li key={q.id} className="flex items-baseline gap-2 text-[13px]">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    acao(
                      () =>
                        chooseQuote({
                          itemId: item.id,
                          quoteId: q.isChosen ? null : q.id,
                        }),
                      q.isChosen ? "Escolha desfeita." : "Proposta escolhida.",
                    )
                  }
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    q.isChosen
                      ? "border-positive bg-positive/20 text-positive"
                      : "border-line-strong text-transparent",
                  )}
                  aria-label={q.isChosen ? "Desfazer escolha" : "Escolher esta proposta"}
                >
                  <Check className="size-2.5" aria-hidden />
                </button>
                <span className="min-w-0 flex-1 break-words text-ink-muted">
                  {q.supplier}
                </span>
                <span className="tabular shrink-0 text-ink">
                  {formatCents(q.amountCents)}
                </span>
              </li>
            ))}
            {item.quotes.length === 0 ? (
              <li className="text-[12px] text-ink-faint">
                Nenhuma proposta recebida ainda.
              </li>
            ) : null}
          </ul>
          <NovaCotacao
            itemId={item.id}
            pending={pending}
            startTransition={startTransition}
          />
        </>
      ) : (
        <>
          <ul className="space-y-1">
            {item.purchases.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-[13px]">
                <span className="min-w-0 flex-1 break-words text-ink-muted">
                  {c.date.slice(8, 10)}/{c.date.slice(5, 7)}
                  {c.quantity !== null ? (
                    <> · {QTD.format(c.quantity)}{item.unit ? ` ${item.unit}` : ""}</>
                  ) : null}
                  {c.paymentMethod ? ` · ${PAYMENT_LABEL[c.paymentMethod]}` : ""}
                  {/* "em 10x" e não o valor da parcela: o número ao lado já é
                      a compra inteira, e mostrar os dois convidaria a somar
                      errado. */}
                  {c.installmentTotal ? ` em ${c.installmentTotal}x` : ""}
                  {c.supplier ? ` · ${c.supplier}` : ""}
                </span>
                <span className="tabular shrink-0 text-ink">
                  {formatCents(c.amountCents)}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => acao(() => removePurchase(c.id), "Compra removida.")}
                  aria-label="Remover compra"
                  className="shrink-0 text-ink-faint hover:text-danger"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
            {item.purchases.length === 0 ? (
              <li className="text-[12px] text-ink-faint">Nada comprado ainda.</li>
            ) : null}
          </ul>
          <NovaCompra
            itemId={item.id}
            itemName={item.name}
            unit={item.unit}
            supplier={progress.chosen?.supplier ?? null}
            expectedCents={progress.expectedCents}
            pending={pending}
            startTransition={startTransition}
          />
        </>
      )}

      {/* "O que comprar primeiro" é pergunta de lista, mas a resposta se dá
          item a item — e aqui dentro, onde já se está decidindo sobre ele. */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1 text-[12px] text-ink-faint">Prioridade</p>
        <div className="flex flex-wrap gap-1.5">
          {([1, 2, 3] as const).map((nivel) => (
            <button
              key={nivel}
              type="button"
              disabled={pending}
              aria-pressed={item.priority === nivel}
              onClick={() =>
                acao(
                  () =>
                    setItemPriority({
                      itemId: item.id,
                      // Tocar de novo no nível marcado desmarca: sem isto, não
                      // haveria como voltar a "ainda não decidi".
                      priority: item.priority === nivel ? null : nivel,
                    }),
                  item.priority === nivel
                    ? "Prioridade removida."
                    : `Prioridade ${PRIORITY_LABEL[nivel].toLowerCase()}.`,
                )
              }
              className={cn(
                "min-h-9 rounded-[--radius-control] px-2.5 py-1.5 text-[12px]",
                item.priority === nivel
                  ? "bg-brand/15 text-brand"
                  : "bg-surface-2 text-ink-faint",
              )}
            >
              {PRIORITY_LABEL[nivel]}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          acao(
            () => setItemClosed({ itemId: item.id, closed: item.closedAt === null }),
            item.closedAt === null ? "Item encerrado." : "Item reaberto.",
          )
        }
        className="mt-3 text-[12px] text-brand underline underline-offset-2"
      >
        {item.closedAt === null
          ? "Dar este item por encerrado"
          : "Reabrir este item"}
      </button>
    </div>
  );
}

function NovaCotacao({
  itemId,
  pending,
  startTransition,
}: {
  itemId: string;
  pending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const [supplier, setSupplier] = useState("");
  const [valor, setValor] = useState("");
  /** Os outros valores que o PDF trazia, para corrigir sem redigitar. */
  const [alternativas, setAlternativas] = useState<{ cents: number; context: string }[]>([]);
  const [lido, setLido] = useState(false);

  function salvar() {
    const cents = parseAmountCents(valor);
    if (!supplier.trim() || cents === null) {
      toast.error("Preencha fornecedor e valor.");
      return;
    }
    startTransition(async () => {
      const r = await addQuote({ itemId, supplier, amountCents: cents });
      if (r.error) toast.error(r.error);
      else {
        toast.success("Cotação guardada.");
        setSupplier("");
        setValor("");
        setAlternativas([]);
        setLido(false);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <QuotePdfInput
        onRead={(p) => {
          if (p.supplier) setSupplier(p.supplier);
          if (p.total) setValor(String(p.total.cents / 100).replace(".", ","));
          setAlternativas(p.alternatives.map((a) => ({ cents: a.cents, context: a.context })));
          setLido(true);
        }}
      />

      {/* O que foi lido fica DITO, e editável. O PDF do fornecedor não tem
          formato garantido, então o app propõe e a pessoa confere — gravar
          sozinho o número errado seria pior que não ler PDF nenhum. */}
      {lido ? (
        <p className="basis-full text-[12px] text-ink-faint">
          Li o PDF e preenchi abaixo. Confira antes de guardar.
        </p>
      ) : null}
      {alternativas.length > 0 ? (
        <div className="basis-full text-[12px] text-ink-faint">
          Outros valores no arquivo:{" "}
          {alternativas.map((a) => (
            <button
              key={`${a.cents}-${a.context}`}
              type="button"
              title={a.context}
              onClick={() => setValor(String(a.cents / 100).replace(".", ","))}
              className="mr-1.5 text-brand underline underline-offset-2"
            >
              {fc(a.cents)}
            </button>
          ))}
        </div>
      ) : null}

      {/* Linha própria: a 360px o nome do fornecedor dividido com valor e
          botão ficava estreito demais para se ler o que já foi digitado. */}
      <Input
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
        placeholder="Fornecedor"
        className="basis-full"
        aria-label="Fornecedor da proposta"
      />
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="R$"
        inputMode="decimal"
        className="min-w-0 flex-1"
        aria-label="Valor da proposta"
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={salvar}>
        Guardar
      </Button>
    </div>
  );
}

function NovoItem({
  projectId,
  pending,
  startTransition,
  onDone,
}: {
  projectId: string;
  pending: boolean;
  startTransition: (fn: () => void) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState("");
  const [unit, setUnit] = useState("");
  const [qtd, setQtd] = useState("");

  function salvar() {
    if (!name.trim()) {
      toast.error("Dê um nome ao item.");
      return;
    }
    const quantidade = qtd.trim() === "" ? null : Number(qtd.replace(",", "."));
    if (quantidade !== null && (!Number.isFinite(quantidade) || quantidade <= 0)) {
      toast.error("Quantidade inválida.");
      return;
    }
    startTransition(async () => {
      const r = await addProjectItem({
        projectId,
        name,
        stage: stage || null,
        unit: unit || null,
        plannedQuantity: quantidade,
      });
      if (r.error) toast.error(r.error);
      else {
        toast.success("Item adicionado.");
        onDone();
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="O que é (ex.: Porcelanato da sala)"
        aria-label="Nome do item"
      />
      <Input
        value={stage}
        onChange={(e) => setStage(e.target.value)}
        placeholder="Etapa (ex.: Pisos)"
        aria-label="Etapa"
      />
      <div className="flex gap-1.5">
        <Input
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          placeholder="Quantidade"
          inputMode="decimal"
          className="min-w-0 flex-1"
          aria-label="Quantidade prevista"
        />
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unidade"
          className="w-24"
          aria-label="Unidade"
        />
      </div>
      <div className="flex gap-1.5">
        <Button disabled={pending} onClick={salvar}>
          Adicionar
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
