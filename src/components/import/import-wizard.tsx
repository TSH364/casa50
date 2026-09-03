"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";
import { commitImport, reviewImport, revertImport } from "@/actions/import";
import { createCardFromLastFour } from "@/actions/cards";
import { parseCsv, MAX_FILE_BYTES } from "@/importers/parse";
import type {
  DraftTransaction,
  ImportSummary,
  ParseResult,
  ReviewedDraft,
  SignConvention,
} from "@/importers/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { formatCents } from "@/lib/money";
import { addMonths, monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { Card as CardType } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

type Step = "arquivo" | "conferir" | "revisar" | "pronto";

const TYPE_LABEL: Record<string, string> = {
  expense: "Despesa",
  income: "Receita",
  payment: "Pagamento",
  refund: "Estorno",
  fee: "Tarifa",
  adjustment: "Ajuste",
};

/** SHA-256 do conteúdo, para reconhecer o mesmo arquivo importado duas vezes. */
async function hashFile(text: string): Promise<string | null> {
  if (typeof crypto?.subtle?.digest !== "function") return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function IssueLine({ level, text }: { level: string; text: string }) {
  const Icon = level === "error" ? AlertTriangle : level === "warning" ? AlertTriangle : Info;
  return (
    <li
      className={cn(
        "flex items-start gap-2 text-[13px]",
        level === "error" && "text-danger",
        level === "warning" && "text-attention",
        level === "info" && "text-ink-muted",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </li>
  );
}

export function ImportWizard({
  cards: initialCards,
  members,
  currentMonth,
}: {
  cards: CardType[];
  members: MemberSummary[];
  currentMonth: string;
}) {
  const [step, setStep] = useState<Step>("arquivo");
  const [pending, startTransition] = useTransition();
  /**
   * Cópia local dos cartões: um cartão criado aqui precisa aparecer no
   * seletor na hora, sem recarregar a página e perder o arquivo já lido.
   */
  const [cards, setCards] = useState(initialCards);

  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [month, setMonth] = useState(currentMonth);
  const [cardId, setCardId] = useState("");
  const [memberId, setMemberId] = useState("");
  /** Coluna de valor escolhida à mão. Vazio = a que a detecção achou. */
  const [amountColumn, setAmountColumn] = useState("");
  /** Convenção de sinal forçada. Vazio = a que a detecção achou. */
  const [signOverride, setSignOverride] = useState<SignConvention | "">("");
  /** Final do cartão no arquivo -> cartão cadastrado. */
  const [cardByLastFour, setCardByLastFour] = useState<Record<string, string>>({});

  const [reviewed, setReviewed] = useState<ReviewedDraft[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  function reset() {
    setStep("arquivo");
    setFileName("");
    setFileHash(null);
    setRawText("");
    setParsed(null);
    setFileError(null);
    setReviewed([]);
    setSummary(null);
    setNotes([]);
    setInvoiceId(null);
    setAmountColumn("");
    setSignOverride("");
    setCardByLastFour({});
  }

  /**
   * Relê o arquivo com os ajustes que o usuário já fez.
   *
   * Os ajustes vêm do estado, e não do evento, para um não apagar o outro:
   * trocar a coluna de valor não pode desfazer a inversão de sinal.
   */
  function runParse(text: string, name: string, overrides: {
    signConvention?: SignConvention | "";
    invoiceMonth?: string;
    amountColumn?: string;
  } = {}) {
    const amount = overrides.amountColumn ?? amountColumn;
    const sign = overrides.signConvention ?? signOverride;
    const result = parseCsv(text, {
      fileName: name,
      ...(overrides.invoiceMonth ? { invoiceMonth: overrides.invoiceMonth } : {}),
      ...(sign ? { signConvention: sign } : {}),
      ...(amount ? { columns: { amount } } : {}),
    });
    setParsed(result);
    if (result.detectedMonth) setMonth(result.detectedMonth);

    // Quando o arquivo traz o final do cartão, já liga cada um ao cartão
    // cadastrado com o mesmo final. O que não casar fica em branco, para o
    // usuário escolher - nunca chuta um cartão qualquer.
    const auto: Record<string, string> = {};
    for (const draft of result.drafts) {
      const lastFour = draft.cardLastFour;
      if (!lastFour || auto[lastFour]) continue;
      const match = cards.find((c) => c.isActive && c.lastFour === lastFour);
      if (match) auto[lastFour] = match.id;
    }
    setCardByLastFour(auto);
    return result;
  }

  /** Cria o cartão que falta e já o associa ao final que veio no arquivo. */
  function createCard(lastFour: string) {
    startTransition(async () => {
      const result = await createCardFromLastFour(lastFour);
      if (result.error || !result.card) {
        toast.error(result.error ?? "Não foi possível criar o cartão.");
        return;
      }
      const created = result.card;
      setCards((prev) => [...prev, created]);
      setCardByLastFour((prev) => ({ ...prev, [lastFour]: created.id }));
      toast.success(`Cartão ···· ${lastFour} criado. Dá para renomear em Cartões.`);
    });
  }

  /** Aplica o cartão de cada linha antes de mandar para o servidor. */
  function withCards(drafts: readonly DraftTransaction[]) {
    return drafts.map((d) => ({
      ...d,
      cardId: d.cardLastFour
        ? (cardByLastFour[d.cardLastFour] ?? null)
        : (cardId || null),
    }));
  }

  async function onFile(file: File) {
    setFileError(null);

    if (file.size > MAX_FILE_BYTES) {
      setFileError(
        `Arquivo de ${(file.size / 1024 / 1024).toFixed(1)} MB. O limite é ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    const lower = file.name.toLowerCase();

    // Mensagem clara em vez de importação parcial silenciosa (secao 6).
    if (lower.endsWith(".pdf")) {
      setFileError(
        "Leitura de PDF ainda não está pronta. Exporte a fatura em CSV pelo app do banco, ou lance manualmente.",
      );
      return;
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      setFileError(
        "Leitura de planilha ainda não está pronta. Salve a planilha como CSV e importe.",
      );
      return;
    }
    if (!lower.endsWith(".csv")) {
      setFileError("Formato não reconhecido. Envie um arquivo .csv.");
      return;
    }

    const text = await file.text();
    setRawText(text);
    setFileName(file.name);
    setFileHash(await hashFile(text));
    runParse(text, file.name);
    setStep("conferir");
  }

  function goReview() {
    if (!parsed) return;
    startTransition(async () => {
      const result = await reviewImport({
        drafts: withCards(parsed.drafts),
        invoiceMonth: month,
        cardId: invoiceCardId,
        memberId: memberId || null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setReviewed(result.reviewed ?? []);
      setSummary(result.summary ?? null);
      setNotes(result.notes ?? []);
      setStep("revisar");
    });
  }

  function toggleDecision(row: number) {
    setReviewed((prev) =>
      prev.map((d) =>
        d.row === row
          ? { ...d, decision: d.decision === "new" ? "ignored" : "new" }
          : d,
      ),
    );
  }

  function confirm() {
    if (!parsed) return;
    startTransition(async () => {
      const result = await commitImport({
        drafts: reviewed,
        invoiceMonth: month,
        cardId: invoiceCardId,
        memberId: memberId || null,
        fileName,
        fileHash,
        institution: parsed.institution,
        format: "csv",
        reportedTotalCents: null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setInvoiceId(result.invoiceId ?? null);
      setSummary(result.summary ?? null);
      setStep("pronto");
      toast.success("Fatura importada.");
    });
  }

  function undo() {
    if (!invoiceId) return;
    startTransition(async () => {
      const result = await revertImport(invoiceId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Importação desfeita. ${result.removed ?? 0} lançamento(s) removidos.`,
      );
      reset();
    });
  }

  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const monthOptions = [-2, -1, 0, 1].map((delta) => {
    const value = addMonths(parsed?.detectedMonth ?? currentMonth, delta);
    return { value, label: monthLabel(value) };
  });

  /** Finais de cartão presentes no arquivo, na ordem em que aparecem. */
  const fileCards = [
    ...new Set(
      (parsed?.drafts ?? [])
        .map((d) => d.cardLastFour)
        .filter((v): v is string => v !== null),
    ),
  ];
  const cardOptions = cards
    .filter((c) => c.isActive)
    .map((c) => ({
      value: c.id,
      label: c.lastFour ? `${c.name} ···· ${c.lastFour}` : c.name,
    }));
  // A fatura em si só aponta para um cartão. Com vários no arquivo ela fica
  // sem cartão e cada lançamento leva o seu.
  const invoiceCardId =
    fileCards.length === 1
      ? (cardByLastFour[fileCards[0]!] ?? null)
      : fileCards.length > 1
        ? null
        : cardId || null;

  // ------------------------------------------------------------------ passos
  if (step === "arquivo") {
    return (
      <Card>
        <CardHeader
          title="Escolher arquivo"
          description="CSV da fatura, exportado pelo app do banco."
        />
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[--radius-card] border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center transition-colors hover:border-brand"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
        >
          <Upload className="size-6 text-ink-muted" aria-hidden />
          <span className="text-sm text-ink">
            Arraste o arquivo ou toque para escolher
          </span>
          <span className="text-[13px] text-ink-faint">
            .csv · até {MAX_FILE_BYTES / 1024 / 1024} MB
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>

        {fileError ? (
          <p
            role="alert"
            className="mt-4 rounded-[--radius-control] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
          >
            {fileError}
          </p>
        ) : null}
      </Card>
    );
  }

  if (step === "conferir" && parsed) {
    return (
      <>
        <Card>
          <CardHeader
            title="Conferir o que foi lido"
            description={`${fileName} · ${parsed.drafts.length} linha(s)`}
            action={
              <Button variant="ghost" size="sm" onClick={reset}>
                Trocar arquivo
              </Button>
            }
          />

          {parsed.issues.length > 0 ? (
            <ul className="mb-4 space-y-1.5">
              {parsed.issues.slice(0, 8).map((issue, i) => (
                <IssueLine
                  key={i}
                  level={issue.level}
                  text={issue.row ? `Linha ${issue.row}: ${issue.message}` : issue.message}
                />
              ))}
            </ul>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Mês da fatura"
              htmlFor="month"
              hint={
                parsed.monthSource === "filename"
                  ? "Deduzido do nome do arquivo."
                  : parsed.monthSource === "dates"
                    ? "Deduzido das datas do arquivo."
                    : "Confirme o mês."
              }
            >
              <Select
                id="month"
                options={monthOptions}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </Field>

            {fileCards.length === 0 ? (
              <Field
                label="Cartão"
                htmlFor="card"
                hint="O arquivo não traz os 4 últimos dígitos — escolha manualmente."
              >
                <Select
                  id="card"
                  placeholder="Sem cartão"
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                  options={cardOptions}
                />
              </Field>
            ) : (
              fileCards.map((lastFour) => (
                <Field
                  key={lastFour}
                  label={`Cartão ···· ${lastFour}`}
                  htmlFor={`card-${lastFour}`}
                  hint={
                    cardByLastFour[lastFour]
                      ? "Reconhecido pelo final."
                      : "Nenhum cartão com este final. Dá para criar agora."
                  }
                >
                  <div className="flex gap-2">
                    {/* O wrapper do Select é que é o item do flex; a classe
                        passada ao componente cai no <select> de dentro. */}
                    <div className="min-w-0 flex-1">
                      <Select
                        id={`card-${lastFour}`}
                        placeholder="Sem cartão"
                        value={cardByLastFour[lastFour] ?? ""}
                        onChange={(e) =>
                          setCardByLastFour((prev) => ({
                            ...prev,
                            [lastFour]: e.target.value,
                          }))
                        }
                        options={cardOptions}
                      />
                    </div>
                    {cardByLastFour[lastFour] ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => createCard(lastFour)}
                      >
                        <Plus aria-hidden /> Criar
                      </Button>
                    )}
                  </div>
                </Field>
              ))
            )}

            <Field
              label="Quem gastou"
              htmlFor="member"
              hint="Aplicado a todas as linhas. Dá para ajustar depois, um a um."
            >
              <Select
                id="member"
                placeholder="—"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                options={members.map((m) => ({
                  value: m.userId,
                  label: m.fullName,
                }))}
              />
            </Field>

            <Field
              label="Convenção de sinal"
              htmlFor="sign"
              hint="Se a fatura vier invertida, troque aqui."
            >
              <Select
                id="sign"
                value={parsed.signConvention}
                onChange={(e) => {
                  const value = e.target.value as SignConvention;
                  setSignOverride(value);
                  runParse(rawText, fileName, {
                    signConvention: value,
                    invoiceMonth: month,
                  });
                }}
                options={[
                  { value: "expense_positive", label: "Despesa vem positiva" },
                  { value: "expense_negative", label: "Despesa vem negativa" },
                ]}
              />
            </Field>

            <Field
              label="Coluna de valor"
              htmlFor="amount-column"
              hint="Faturas internacionais trazem mais de uma. Se os valores vierem zerados, é aqui que se corrige."
            >
              <Select
                id="amount-column"
                value={amountColumn || (parsed.columns.amount ?? "")}
                onChange={(e) => {
                  setAmountColumn(e.target.value);
                  runParse(rawText, fileName, {
                    amountColumn: e.target.value,
                    invoiceMonth: month,
                  });
                }}
                options={parsed.headers.map((h) => ({ value: h, label: h }))}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Prévia" description="Primeiras linhas do arquivo." />
          <ul className="divide-y divide-line">
            {parsed.drafts.slice(0, 8).map((d) => (
              <li key={d.row} className="flex items-center gap-3 py-2">
                <span className="tabular w-16 shrink-0 text-[12px] text-ink-faint">
                  {d.date.slice(8)}/{d.date.slice(5, 7)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {d.description}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {TYPE_LABEL[d.type]}
                </span>
                <span className="tabular shrink-0 text-sm text-ink">
                  {formatCents(d.amountCents)}
                </span>
              </li>
            ))}
          </ul>
          {parsed.drafts.length > 8 ? (
            <p className="mt-3 text-[13px] text-ink-faint">
              e mais {parsed.drafts.length - 8} linha(s).
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={pending || errors.length > 0 || parsed.drafts.length === 0}
              onClick={goReview}
            >
              {pending ? "Verificando…" : "Verificar duplicidades"}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  if (step === "revisar" && summary) {
    return (
      <>
        <Card>
          <CardHeader
            title="Revisar antes de gravar"
            description="Nada foi gravado ainda."
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Novos", value: summary.new, tone: "text-positive" },
              { label: "Repetidos", value: summary.duplicates, tone: "text-attention" },
              { label: "Ignorados", value: summary.ignored, tone: "text-ink-muted" },
              { label: "Sem categoria", value: summary.withoutCategory, tone: "text-ink-muted" },
            ].map((k) => (
              <div key={k.label} className="rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">
                  {k.label}
                </p>
                <p className={cn("tabular mt-1 text-lg font-semibold", k.tone)}>
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[13px] text-ink-muted">
            Total calculado:{" "}
            <span className="tabular font-medium text-ink">
              {formatCents(summary.computedTotalCents)}
            </span>
          </p>

          {notes.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {notes.map((note, i) => (
                <IssueLine key={i} level="info" text={note} />
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Linhas"
            description="Toque para alternar entre importar e ignorar."
          />
          <ul className="divide-y divide-line">
            {reviewed.map((d) => (
              <li key={d.row} className="flex items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleDecision(d.row)}
                  aria-pressed={d.decision === "new"}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full border px-2.5 text-[11px] transition-colors",
                    d.decision === "new" && "border-positive/50 bg-positive-soft text-positive",
                    d.decision === "duplicate" && "border-attention/50 bg-attention-soft text-attention",
                    d.decision === "ignored" && "border-line bg-surface-2 text-ink-faint",
                  )}
                >
                  {d.decision === "new"
                    ? "Importar"
                    : d.decision === "duplicate"
                      ? "Repetido"
                      : "Ignorar"}
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {d.description}
                  {d.installmentTotal ? (
                    <span className="ml-1.5 text-[12px] text-ink-faint">
                      {d.installmentCurrent}/{d.installmentTotal}
                    </span>
                  ) : null}
                  {d.cardLastFour ? (
                    <span className="ml-1.5 text-[12px] text-ink-faint">
                      ···· {d.cardLastFour}
                    </span>
                  ) : null}
                  <span className="block truncate text-[12px] text-ink-faint">
                    {d.categoryName ?? "Sem categoria"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm text-ink">
                  {formatCents(d.amountCents)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep("conferir")}
            >
              Voltar
            </Button>
            <Button className="flex-1" disabled={pending} onClick={confirm}>
              {pending ? "Gravando…" : `Importar ${summary.new}`}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  if (step === "pronto" && summary) {
    return (
      <Card>
        <CardHeader title="Importação concluída" />
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="size-8 text-positive" aria-hidden />
          <p className="mt-3 text-sm text-ink">
            {summary.new} lançamento(s) gravados em {monthLabel(month)}.
          </p>
          <p className="tabular mt-1 text-lg font-semibold text-ink">
            {formatCents(summary.computedTotalCents)}
          </p>
          {summary.duplicates > 0 ? (
            <p className="mt-2 text-[13px] text-ink-faint">
              {summary.duplicates} repetição(ões) não foram gravadas.
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={pending}
            onClick={undo}
          >
            <RotateCcw aria-hidden /> Desfazer
          </Button>
          <Button className="flex-1" onClick={reset}>
            <FileText aria-hidden /> Importar outra
          </Button>
        </div>
      </Card>
    );
  }

  return null;
}
