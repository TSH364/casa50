"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createTransaction, updateTransaction } from "@/actions/transactions";
import { suggestCategoryFromText } from "@/actions/jev";
import type { CategorySuggestion } from "@/actions/jev";
import { probabilityLabel } from "@/domain/jev";
import { parseAmountCents } from "@/lib/money";
import type { FormState } from "@/actions/shared";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { monthLabel, monthOf, addMonths } from "@/domain/month";
import { DOS_DOIS } from "@/domain/schemas";
import type { Card, Category, Transaction } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

/**
 * PIX e dinheiro nao sao tipos proprios: sao formas de pagamento. Uma
 * despesa paga em PIX e uma `expense` sem cartao. Criar um tipo para cada
 * meio de pagamento faria os totais precisarem somar categorias que na
 * verdade sao a mesma coisa.
 */
const TYPES = [
  { value: "expense", label: "Despesa" },
  { value: "income", label: "Receita" },
  { value: "payment", label: "Pagamento de fatura" },
  { value: "refund", label: "Estorno" },
  { value: "fee", label: "Tarifa" },
  { value: "adjustment", label: "Ajuste" },
];

const VISIBILITY = [
  { value: "shared", label: "Compartilhado" },
  { value: "individual", label: "Individual" },
];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function Footer({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2">
      <DialogClose
        type="button"
        disabled={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] border border-line-strong text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        Cancelar
      </DialogClose>
      <button
        type="submit"
        form="transaction-form"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] bg-brand text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : isEdit ? "Salvar alterações" : "Adicionar"}
      </button>
    </div>
  );
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  transaction,
  categories,
  cards,
  members,
  defaultMonth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: Transaction;
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
  defaultMonth: string;
}) {
  const isEdit = transaction !== undefined;
  const action = isEdit
    ? updateTransaction.bind(null, transaction.id)
    : createTransaction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? "");
  const [subcategoryId, setSubcategoryId] = useState(
    transaction?.subcategoryId ?? "",
  );
  const [visibility, setVisibility] = useState(transaction?.visibility ?? "shared");
  const [date, setDate] = useState(transaction?.date ?? todayIso());
  // Sugestao de categoria pela descricao. So em lancamento NOVO e com a
  // categoria vazia: editar um lancamento nao pode trocar o que alguem ja
  // escolheu.
  const [sugestao, setSugestao] = useState<(CategorySuggestion & { aplicada?: boolean }) | null>(null);
  const [sugerindo, startSugestao] = useTransition();

  function sugerir(descricao: string, amountRaw: string) {
    if (isEdit || categoryId !== "" || descricao.trim().length < 3) return;
    const cents = parseAmountCents(amountRaw);
    startSugestao(async () => {
      const r = await suggestCategoryFromText({
        description: descricao,
        ...(cents !== null && cents > 0 ? { amountCents: cents } : {}),
      }).catch(() => ({}) as CategorySuggestion);
      if (!r.categoryId) {
        setSugestao(null);
        return;
      }
      // Regra da casa e loja conhecida sao decisoes ja tomadas: entram
      // direto. Palpite do Jev espera o toque em "Usar".
      if (r.via !== "jev") {
        setCategoryId(r.categoryId);
        setSubcategoryId(r.subcategoryId ?? "");
        setSugestao({ ...r, aplicada: true });
      } else {
        setSugestao(r);
      }
    });
  }

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Lançamento atualizado." : "Lançamento adicionado.");
      onOpenChange(false);
    }
  }, [state.ok, isEdit, onOpenChange]);

  const err = state.fieldErrors ?? {};
  const parents = categories.filter((c) => c.parentId === null);
  const children = categories.filter((c) => c.parentId === categoryId);

  // O mês da fatura raramente é o da compra: uma compra depois do fechamento
  // cai na fatura seguinte. Oferecemos os três meses em torno da data.
  const baseMonth = monthOf(date);
  const monthOptions = [-1, 0, 1].map((delta) => {
    const month = addMonths(baseMonth, delta);
    return { value: month, label: monthLabel(month) };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar lançamento" : "Novo lançamento"}
        footer={<Footer isEdit={isEdit} />}
      >
        <form
          id="transaction-form"
          action={formAction}
          className="space-y-4"
          noValidate
        >
          <Field label="Descrição" htmlFor="description" error={err.description}>
            <Input
              id="description"
              name="description"
              required
              maxLength={200}
              defaultValue={transaction?.description ?? ""}
              placeholder="Mercado, aluguel, jantar…"
              aria-invalid={err.description ? true : undefined}
              onBlur={(e) => {
                const form = e.currentTarget.form;
                const valor = form?.elements.namedItem("amount") as HTMLInputElement | null;
                sugerir(e.currentTarget.value, valor?.value ?? "");
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor" htmlFor="amount" error={err.amount}>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                required
                defaultValue={transaction?.amount ?? ""}
                placeholder="0,00"
                className="tabular"
                aria-invalid={err.amount ? true : undefined}
              />
            </Field>
            <Field label="Tipo" htmlFor="type" error={err.type}>
              <Select
                id="type"
                name="type"
                options={TYPES}
                defaultValue={transaction?.type ?? "expense"}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data" htmlFor="date" error={err.date}>
              <Input
                id="date"
                name="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={err.date ? true : undefined}
              />
            </Field>
            <Field
              label="Mês da fatura"
              htmlFor="invoiceMonth"
              error={err.invoiceMonth}
              hint="Compra após o fechamento cai na fatura seguinte."
            >
              <Select
                id="invoiceMonth"
                name="invoiceMonth"
                options={monthOptions}
                defaultValue={transaction?.invoiceMonth ?? defaultMonth}
              />
            </Field>
          </div>

          {/* A subcategoria só aparece quando a categoria escolhida tem alguma.
              Antes ela ficava sempre visível e desabilitada - e como nenhuma
              das categorias iniciais tem filhas, era um campo permanentemente
              inútil ocupando metade da linha. */}
          <div className={children.length > 0 ? "grid grid-cols-2 gap-3" : ""}>
            <Field label="Categoria" htmlFor="categoryId" error={err.categoryId}>
              <Select
                id="categoryId"
                name="categoryId"
                placeholder="Sem categoria"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  // A subcategoria pertencia à categoria anterior; mantê-la
                  // gravaria uma filha sob outro pai.
                  setSubcategoryId("");
                }}
                options={parents.map((c) => ({ value: c.id, label: c.name }))}
              />
              {sugerindo ? (
                <p className="mt-1 text-[12px] text-ink-muted">Procurando a categoria…</p>
              ) : sugestao?.categoryId ? (
                sugestao.aplicada ? (
                  sugestao.categoryId === categoryId ? (
                    <p className="mt-1 text-[12px] text-ink-muted">
                      {sugestao.via === "regra" ? "Pela regra da casa." : "Pelo nome da loja."}
                    </p>
                  ) : null
                ) : (
                  <button
                    type="button"
                    className="mt-1 inline-flex min-h-9 items-center rounded-full border border-brand/50 bg-brand-soft px-3 text-left text-[12px] text-ink"
                    onClick={() => {
                      setCategoryId(sugestao.categoryId!);
                      setSubcategoryId(sugestao.subcategoryId ?? "");
                      setSugestao({ ...sugestao, aplicada: true });
                    }}
                  >
                    Usar {categories.find((c) => c.id === sugestao.categoryId)?.name}
                    {sugestao.subcategoryId
                      ? ` › ${categories.find((c) => c.id === sugestao.subcategoryId)?.name ?? ""}`
                      : ""}
                    <span className="ml-1 text-ink-muted">
                      (Jev{sugestao.probability ? ` · ${probabilityLabel(sugestao.probability)}` : ""})
                    </span>
                  </button>
                )
              ) : null}
            </Field>
            {children.length > 0 ? (
              <Field
                label="Subcategoria"
                htmlFor="subcategoryId"
                error={err.subcategoryId}
              >
                <Select
                  id="subcategoryId"
                  name="subcategoryId"
                  placeholder="—"
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value)}
                  options={children.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Quem gastou"
              htmlFor="memberId"
              error={err.memberId}
            >
              <Select
                id="memberId"
                name="memberId"
                placeholder="—"
                defaultValue={transaction?.isJoint ? DOS_DOIS : (transaction?.memberId ?? "")}
                options={[
                  ...members.map((m) => ({ value: m.userId, label: m.fullName })),
                  // Com duas pessoas, "Os dois"; com mais, "Todos". Nome de
                  // gente nunca vai fixo no codigo (secao 4).
                  ...(members.length > 1
                    ? [{ value: DOS_DOIS, label: members.length === 2 ? "Os dois" : "Todos" }]
                    : []),
                ]}
              />
            </Field>
            <Field
              label="Cartão ou conta"
              htmlFor="cardId"
              error={err.cardId}
              hint="Deixe vazio para PIX ou dinheiro."
            >
              <Select
                id="cardId"
                name="cardId"
                placeholder="Sem cartão"
                defaultValue={transaction?.cardId ?? ""}
                options={cards
                  .filter((c) => c.isActive || c.id === transaction?.cardId)
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Visibilidade" htmlFor="visibility" error={err.visibility}>
              <Select
                id="visibility"
                name="visibility"
                options={VISIBILITY}
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as "shared" | "individual")
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Parcela"
              htmlFor="installmentCurrent"
              error={err.installmentCurrent}
            >
              <Input
                id="installmentCurrent"
                name="installmentCurrent"
                inputMode="numeric"
                defaultValue={transaction?.installment?.current ?? ""}
                placeholder="3"
                aria-invalid={err.installmentCurrent ? true : undefined}
              />
            </Field>
            <Field
              label="De quantas"
              htmlFor="installmentTotal"
              error={err.installmentTotal}
            >
              <Input
                id="installmentTotal"
                name="installmentTotal"
                inputMode="numeric"
                defaultValue={transaction?.installment?.total ?? ""}
                placeholder="10"
                aria-invalid={err.installmentTotal ? true : undefined}
              />
            </Field>
          </div>

          <Field
            label="Apelido do estabelecimento"
            htmlFor="merchantAlias"
            error={err.merchantAlias}
            hint="Nome legível para substituir o que veio da fatura."
          >
            <Input
              id="merchantAlias"
              name="merchantAlias"
              defaultValue={transaction?.merchantAlias ?? ""}
              placeholder="99 Táxi"
            />
          </Field>

          <Field label="Observação" htmlFor="note" error={err.note}>
            <Textarea
              id="note"
              name="note"
              defaultValue={transaction?.note ?? ""}
              placeholder="Opcional"
            />
          </Field>

          {state.error ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {state.error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
