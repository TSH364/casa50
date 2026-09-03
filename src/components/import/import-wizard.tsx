"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  RotateCcw,
  Upload,
} from "lucide-react";
import { commitImport, reviewImport, revertImport } from "@/actions/import";
import { parseCsv, MAX_FILE_BYTES } from "@/importers/parse";
import type {
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
  cards,
  members,
  currentMonth,
}: {
  cards: CardType[];
  members: MemberSummary[];
  currentMonth: string;
}) {
  const [step, setStep] = useState<Step>("arquivo");
  const [pending, startTransition] = useTransition();

  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [month, setMonth] = useState(currentMonth);
  const [cardId, setCardId] = useState("");
  const [memberId, setMemberId] = useState("");

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
  }

  function runParse(text: string, name: string, overrides: {
    signConvention?: SignConvention;
    invoiceMonth?: string;
  } = {}) {
    const result = parseCsv(text, { fileName: name, ...overrides });
    setParsed(result);
    if (result.detectedMonth) setMonth(result.detectedMonth);
    return result;
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
        drafts: parsed.drafts,
        invoiceMonth: month,
        cardId: cardId || null,
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
        cardId: cardId || null,
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

            <Field
              label="Cartão"
              htmlFor="card"
              hint={
                cardId === ""
                  ? "O arquivo não traz os 4 últimos dígitos — escolha manualmente."
                  : undefined
              }
            >
              <Select
                id="card"
                placeholder="Sem cartão"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                options={cards
                  .filter((c) => c.isActive)
                  .map((c) => ({
                    value: c.id,
                    label: c.lastFour ? `${c.name} ···· ${c.lastFour}` : c.name,
                  }))}
              />
            </Field>

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
                onChange={(e) =>
                  runParse(rawText, fileName, {
                    signConvention: e.target.value as SignConvention,
                    invoiceMonth: month,
                  })
                }
                options={[
                  { value: "expense_positive", label: "Despesa vem positiva" },
                  { value: "expense_negative", label: "Despesa vem negativa" },
                ]}
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
