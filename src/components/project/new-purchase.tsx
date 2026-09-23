"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Search } from "lucide-react";
import { addPurchase, findTransactionsForItem } from "@/actions/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatCents, parseAmountCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { currentMonth, monthLabel } from "@/domain/month";
import {
  PAYMENT_LABEL,
  PAYMENT_METHODS,
  needsLedgerEntry,
  priceGap,
  purchaseFromTransaction,
  type LinkableTransaction,
  type PaymentMethod,
} from "@/domain/purchase";

/**
 * Registrar a compra de um item da obra (secao 15).
 *
 * A TELA SEGUE A PERGUNTA "COMO VOCÊ PAGOU", e não "quanto foi", porque a
 * forma de pagamento muda tudo o que vem depois:
 *
 *   - CARTÃO: a despesa já está no app, veio da fatura. Aqui só se aponta qual
 *     lançamento é — e é o app que procura, porque achar "o do porcelanato" no
 *     meio de centenas de linhas, à mão, ninguém faz duas vezes.
 *   - BOLETO, PIX, DINHEIRO: não chega por lugar nenhum. O app lança a despesa
 *     no mês que a casa disser, e a casa confirma antes.
 *
 * As duas coisas que este formulário não deixa passar em silêncio: uma compra
 * parcelada vale a soma das parcelas, e não a do mês; e o valor pago quase
 * nunca é o previsto — a diferença aparece antes de gravar, não depois.
 */
export function NovaCompra({
  itemId,
  itemName,
  unit,
  supplier,
  expectedCents,
  categoryLabel = null,
  pending,
  startTransition,
}: {
  itemId: string;
  itemName: string;
  unit: string | null;
  /** Fornecedor da proposta escolhida, para achar o lançamento certo. */
  supplier: string | null;
  /** Quanto o item deveria custar, para mostrar a diferença. */
  expectedCents: number | null;
  /** Categoria do projeto, onde a despesa de boleto/Pix vai entrar. */
  categoryLabel?: string | null;
  pending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const [valor, setValor] = useState("");
  const [qtd, setQtd] = useState("");
  const [metodo, setMetodo] = useState<PaymentMethod>("card");
  const [mes, setMes] = useState(currentMonth());
  const [lancar, setLancar] = useState(true);

  const [vinculo, setVinculo] = useState<LinkableTransaction | null>(null);
  const [parcelas, setParcelas] = useState<number | null>(null);

  const cents = parseAmountCents(valor);
  const gap = cents === null ? null : priceGap(expectedCents, cents);

  function escolherLancamento(t: LinkableTransaction) {
    const compra = purchaseFromTransaction(t);
    setVinculo(t);
    setParcelas(compra.installment?.total ?? null);
    // O valor vem do lançamento, e numa compra parcelada é a SOMA das
    // parcelas: gravar os R$ 896,55 da linha deixaria o item 10% comprado.
    // Duas casas sempre: "8965,5" ao lado de "R$ 8.965,50" parece número
    // cortado, e quem confere um valor de obra repara nisso antes de tudo.
    setValor((compra.amountCents / 100).toFixed(2).replace(".", ","));
    setMes(compra.invoiceMonth);
  }

  function limpar() {
    setValor("");
    setQtd("");
    setVinculo(null);
    setParcelas(null);
  }

  function salvar() {
    if (cents === null) {
      toast.error("Informe o valor da compra.");
      return;
    }
    const quantidade = qtd.trim() === "" ? null : Number(qtd.replace(",", "."));
    if (quantidade !== null && (!Number.isFinite(quantidade) || quantidade <= 0)) {
      toast.error("Quantidade inválida.");
      return;
    }
    startTransition(async () => {
      const r = await addPurchase({
        itemId,
        itemName,
        amountCents: cents,
        quantity: quantidade,
        date: new Date().toISOString().slice(0, 10),
        paymentMethod: metodo,
        transactionId: vinculo?.id ?? null,
        installmentTotal: parcelas,
        supplier,
        // Sem lançar, o mês ainda é gravado na compra: ele diz quando a
        // despesa cai, e serve mesmo sem aparecer nos totais.
        invoiceMonth: mes,
        // O lançamento só nasce quando a forma de pagamento pede E a casa
        // confirmou. Cartão nunca pede: a fatura já trouxe.
        postToLedger: needsLedgerEntry(metodo) && lancar,
      });
      if (r.error && !r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.error) toast.warning(r.error);
      else if (r.postedTransactionId) toast.success(`Compra registrada e lançada em ${monthLabel(mes)}.`);
      else toast.success("Compra registrada.");
      limpar();
    });
  }

  return (
    <div className="mt-2 space-y-2">
      {/* A pergunta que organiza o resto. Quatro botões e não um menu: são
          quatro, cabem, e um toque é menos que abrir-escolher-fechar. */}
      <div>
        <p className="mb-1 text-[12px] text-ink-faint">Como pagou</p>
        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMetodo(m);
                // Vínculo é coisa de cartão: trocar para boleto e manter o
                // lançamento apontado deixaria a compra dizendo duas coisas.
                if (m !== "card") {
                  setVinculo(null);
                  setParcelas(null);
                }
              }}
              aria-pressed={metodo === m}
              className={cn(
                "min-h-9 rounded-[--radius-control] px-2.5 py-1.5 text-[12px]",
                metodo === m
                  ? "bg-brand/15 text-brand"
                  : "bg-surface-2 text-ink-faint",
              )}
            >
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Input
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          placeholder={unit ? `Qtd (${unit})` : "Qtd"}
          inputMode="decimal"
          className="w-24"
          aria-label="Quantidade comprada"
        />
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="R$"
          inputMode="decimal"
          className="min-w-0 flex-1"
          aria-label="Valor da compra"
        />
      </div>

      {metodo === "card" ? (
        <VincularLancamento
          supplier={supplier}
          expectedCents={expectedCents}
          escolhido={vinculo}
          onEscolher={escolherLancamento}
          onDesfazer={() => {
            setVinculo(null);
            setParcelas(null);
          }}
        />
      ) : (
        <ForaDoCartao
          mes={mes}
          setMes={setMes}
          lancar={lancar}
          setLancar={setLancar}
          metodo={metodo}
          categoryLabel={categoryLabel}
        />
      )}

      {/* A diferença aparece ANTES de gravar, e some se for zero: obra tem
          frete, desconto e caixa fechada, e a diferença é informação — mas
          "R$ 0,00 a mais" seria só ruído numa tela de celular. */}
      {gap !== null && gap.diffCents !== 0 ? (
        <p
          className={cn(
            "text-[12px]",
            gap.diffCents > 0 ? "text-attention" : "text-positive",
          )}
        >
          {formatCents(Math.abs(gap.diffCents))}{" "}
          {gap.diffCents > 0 ? "acima" : "abaixo"} do previsto
          {expectedCents ? ` (${formatCents(expectedCents)})` : ""} ·{" "}
          {Math.abs(Math.round(gap.ratio * 100))}%
        </p>
      ) : null}

      <Button
        size="sm"
        variant="outline"
        disabled={pending || cents === null}
        onClick={salvar}
      >
        {cents === null ? "Registrar" : `Registrar ${formatCents(cents)}`}
      </Button>
    </div>
  );
}

/** Mês da despesa e a confirmação do lançamento, para o que não é cartão. */
function ForaDoCartao({
  mes,
  setMes,
  lancar,
  setLancar,
  metodo,
  categoryLabel,
}: {
  mes: string;
  setMes: (m: string) => void;
  lancar: boolean;
  setLancar: (v: boolean) => void;
  metodo: PaymentMethod;
  categoryLabel: string | null;
}) {
  return (
    <div className="space-y-1.5 rounded-[--radius-control] bg-surface-2 p-2.5">
      <label className="flex items-center justify-between gap-2 text-[12px] text-ink-muted">
        <span>Mês em que sai do bolso</span>
        <input
          type="month"
          value={mes}
          onChange={(e) => e.target.value && setMes(e.target.value)}
          className="min-h-9 rounded-[--radius-control] border border-line bg-surface px-2 text-[13px] text-ink"
          aria-label="Mês da despesa"
        />
      </label>
      <label className="flex items-start gap-2 text-[12px] text-ink-muted">
        <input
          type="checkbox"
          checked={lancar}
          onChange={(e) => setLancar(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-brand"
        />
        <span>
          Entra nos totais de {monthLabel(mes)}
          {categoryLabel ? `, em ${categoryLabel}` : ""}.{" "}
          <span className="text-ink-faint">
            {PAYMENT_LABEL[metodo]} não chega por fatura — sem isto, esta
            despesa não aparece no mês nem no orçamento.
            {/* Dito aqui, na hora de lançar, e não só na tela do projeto:
                uma despesa sem categoria não entra em orçamento nenhum, e
                quem está registrando a compra é quem pode resolver agora. */}
            {categoryLabel
              ? null
              : " Vai entrar sem categoria — escolha uma no topo do projeto."}
          </span>
        </span>
      </label>
    </div>
  );
}

/** A busca do lançamento que já existe, com os mais parecidos na frente. */
function VincularLancamento({
  supplier,
  expectedCents,
  escolhido,
  onEscolher,
  onDesfazer,
}: {
  supplier: string | null;
  expectedCents: number | null;
  escolhido: LinkableTransaction | null;
  onEscolher: (t: LinkableTransaction) => void;
  onDesfazer: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<LinkableTransaction[] | null>(null);
  const [carregando, startCarregar] = useTransition();

  function procurar(termo: string) {
    startCarregar(async () => {
      const r = await findTransactionsForItem({
        supplier,
        expectedCents,
        search: termo || undefined,
      });
      if (r.error) toast.error(r.error);
      else setLista(r.candidates ?? []);
    });
  }

  if (escolhido !== null) {
    const compra = purchaseFromTransaction(escolhido);
    return (
      <div className="rounded-[--radius-control] bg-surface-2 p-2.5 text-[12px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 break-words text-ink-muted">
            {escolhido.merchant ?? escolhido.description}
          </span>
          <button
            type="button"
            onClick={onDesfazer}
            className="-my-3 -mr-1 shrink-0 px-1 py-3 text-ink-faint underline underline-offset-2"
          >
            trocar
          </button>
        </div>
        {/* O que a detecção de parcela achou, dito por extenso: o número que
            entra na obra é a soma, e foi DEDUZIDO da fatura, não lido dela. */}
        {compra.installment ? (
          <p className="mt-0.5 text-ink-faint">
            Parcela {compra.installment.current} de {compra.installment.total} ·{" "}
            {formatCents(compra.installment.perMonthCents)} por mês · a compra
            inteira dá {formatCents(compra.amountCents)} (deduzido das parcelas)
          </p>
        ) : (
          <p className="mt-0.5 text-ink-faint">
            À vista · {formatCents(escolhido.amountCents)}
            {escolhido.cardLabel ? ` · ${escolhido.cardLabel}` : ""}
          </p>
        )}
      </div>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          procurar("");
        }}
        className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-brand underline underline-offset-2"
      >
        <Link2 className="size-3.5" aria-hidden />
        Vincular a um gasto do cartão
      </button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-[--radius-control] bg-surface-2 p-2.5">
      <div className="flex gap-1.5">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") procurar(busca);
          }}
          placeholder="Buscar por nome"
          className="min-w-0 flex-1"
          aria-label="Buscar lançamento"
        />
        <Button size="sm" variant="ghost" onClick={() => procurar(busca)}>
          {carregando ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>

      {lista === null ? null : lista.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          Nenhum gasto encontrado no último ano.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {lista.map((t) => {
            const compra = purchaseFromTransaction(t);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onEscolher(t)}
                  className="flex w-full items-baseline gap-2 py-2 text-left text-[12px]"
                >
                  <span className="min-w-0 flex-1 break-words text-ink-muted">
                    {t.merchant ?? t.description}
                    <span className="block text-ink-faint">
                      {t.date.slice(8, 10)}/{t.date.slice(5, 7)}
                      {compra.installment
                        ? ` · ${compra.installment.current}/${compra.installment.total}`
                        : ""}
                      {t.cardLabel ? ` · ${t.cardLabel}` : ""}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-ink">
                    {formatCents(compra.amountCents)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAberto(false)}
        className="min-h-9 text-[12px] text-ink-faint underline underline-offset-2"
      >
        Deixar sem vínculo
      </button>
    </div>
  );
}
