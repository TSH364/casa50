import Papa from "papaparse";
import { parseAmountCents } from "@/lib/money";
import { isMonthKey } from "@/domain/month";
import {
  classifyType,
  detectColumns,
  detectSignConvention,
  duplicateKey,
  extractInstallment,
  monthFromDates,
  monthFromFilename,
  normalizeMerchant,
  parseCardLastFour,
  parseInstallmentCell,
} from "./detect";
import type {
  ColumnMap,
  DraftTransaction,
  ImportIssue,
  ParseResult,
  SignConvention,
} from "./types";

/**
 * Leitura de CSV e planilha.
 *
 * Roda no navegador: o arquivo só sai da máquina depois que o casal revisa e
 * confirma. Nenhuma dependência de DOM aqui, para os testes rodarem no Node.
 */

/** Limite de tamanho (secao 22). Uma fatura de CSV tem alguns KB. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".pdf"] as const;

/**
 * Datas: ISO (`2026-08-12`) e brasileira (`12/08/2026`, `12-08-2026`).
 * Devolve sempre `YYYY-MM-DD`, ou `null` quando não reconhece.
 *
 * A conversão é textual de propósito: `new Date("2026-08-12")` é interpretado
 * como UTC e voltaria um dia atrás no fuso de Brasília.
 */
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validDate(iso[1]!, iso[2]!, iso[3]!);

  const br = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const year = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
    return validDate(year, br[2]!.padStart(2, "0"), br[1]!.padStart(2, "0"));
  }
  return null;
}

function validDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rejeita 31 de fevereiro e afins comparando com a data reconstruída.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${year}-${month}-${day}`;
}

export interface ParseOptions {
  fileName: string;
  /** Força a convenção em vez de detectar - usado quando o usuário inverte. */
  signConvention?: SignConvention;
  /** Mês confirmado pelo usuário, que vence a detecção. */
  invoiceMonth?: string;
  /** Mapeamento manual de colunas, quando a detecção erra. */
  columns?: Partial<ColumnMap>;
}

/**
 * Transforma linhas já em formato de objeto em rascunhos de lançamento.
 * Compartilhado por CSV e planilha, que só diferem em como viram objeto.
 */
export function buildDrafts(
  rows: readonly Record<string, unknown>[],
  headers: readonly string[],
  options: ParseOptions,
): ParseResult {
  const issues: ImportIssue[] = [];
  const columns: ColumnMap = { ...detectColumns(headers), ...options.columns };

  if (!columns.date || !columns.description || !columns.amount) {
    const missing = [
      !columns.date ? "data" : null,
      !columns.description ? "descrição" : null,
      !columns.amount ? "valor" : null,
    ].filter(Boolean);
    issues.push({
      level: "error",
      message: `Não identifiquei a coluna de ${missing.join(", ")}. Indique manualmente qual é.`,
    });
    return {
      format: "csv",
      drafts: [],
      columns,
      headers: [...headers],
      signConvention: options.signConvention ?? "expense_positive",
      detectedMonth: monthFromFilename(options.fileName),
      monthSource: monthFromFilename(options.fileName) ? "filename" : null,
      institution: guessInstitution(options.fileName),
      reportedTotalCents: null,
      issues,
    };
  }

  // Primeira passada: lê data e valor bruto, sem decidir tipo ainda - a
  // convenção de sinal depende do conjunto todo.
  const staged: {
    row: number;
    date: string;
    description: string;
    signedCents: number;
    categoryHint: string | null;
    installmentCell: string | null;
    cardLastFour: string | null;
  }[] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 1;
    const rawDate = String(row[columns.date!] ?? "");
    const rawDescription = String(row[columns.description!] ?? "").trim();
    const rawAmount = row[columns.amount!];

    // Linha totalmente vazia (rodapé de planilha, linha em branco no CSV).
    if (rawDate === "" && rawDescription === "" && (rawAmount ?? "") === "") {
      return;
    }

    const date = parseDate(rawDate);
    const signedCents = parseAmountCents(rawAmount);

    if (date === null) {
      issues.push({
        level: "warning",
        message: `Data não reconhecida ("${rawDate}"). Linha ignorada.`,
        row: lineNumber,
      });
      return;
    }
    if (signedCents === null) {
      // Nunca importar silenciosamente dado incompleto (secao 6).
      issues.push({
        level: "warning",
        message: `Valor não reconhecido ("${String(rawAmount ?? "")}"). Linha ignorada.`,
        row: lineNumber,
      });
      return;
    }
    if (rawDescription === "") {
      issues.push({
        level: "warning",
        message: "Linha sem descrição. Ignorada.",
        row: lineNumber,
      });
      return;
    }

    staged.push({
      row: lineNumber,
      date,
      description: rawDescription,
      signedCents,
      categoryHint: columns.category
        ? (String(row[columns.category] ?? "").trim() || null)
        : null,
      installmentCell: columns.installment
        ? (String(row[columns.installment] ?? "").trim() || null)
        : null,
      cardLastFour: columns.card
        ? parseCardLastFour(String(row[columns.card] ?? ""))
        : null,
    });
  });

  // Uma fatura inteira zerada quase nunca é uma fatura zerada: é a coluna
  // errada. Foi o que aconteceu com "Valor (em US$)", que vem antes de
  // "Valor (em R$)" e é 0 em toda compra nacional. Avisar em vez de gravar 96
  // lançamentos de R$ 0,00 (secao 6: nunca importar em silêncio).
  if (staged.length > 0 && staged.every((s) => s.signedCents === 0)) {
    issues.push({
      level: "error",
      message: `Todas as linhas vieram com valor zero lendo a coluna "${columns.amount}". Provavelmente não é a coluna certa — escolha outra abaixo.`,
    });
  }

  const convention =
    options.signConvention ??
    detectSignConvention(staged.map((s) => s.signedCents));

  const fromName = monthFromFilename(options.fileName);
  const fromDates = monthFromDates(staged.map((s) => s.date));
  const confirmed =
    options.invoiceMonth && isMonthKey(options.invoiceMonth)
      ? options.invoiceMonth
      : null;
  const invoiceMonth = confirmed ?? fromName ?? fromDates;

  if (invoiceMonth === null) {
    issues.push({
      level: "error",
      message: "Não consegui deduzir o mês da fatura. Escolha o mês antes de continuar.",
    });
  }

  const drafts: DraftTransaction[] = invoiceMonth
    ? staged.map((s) => {
        // A coluna de parcela, quando existe, vale mais que a descrição:
        // "ADAPTAORG" não diz nada, mas a coluna ao lado diz "2/12".
        const installment =
          (s.installmentCell ? parseInstallmentCell(s.installmentCell) : null) ??
          extractInstallment(s.description);
        const merchantNormalized = normalizeMerchant(s.description);
        const amountCents = Math.abs(s.signedCents);
        return {
          row: s.row,
          date: s.date,
          invoiceMonth,
          description: s.description,
          merchantOriginal: s.description,
          merchantNormalized,
          amountCents,
          type: classifyType(s.description, s.signedCents, convention),
          categoryHint: s.categoryHint,
          categoryId: null,
          cardLastFour: s.cardLastFour,
          cardId: null,
          installmentCurrent: installment?.current ?? null,
          installmentTotal: installment?.total ?? null,
          duplicateKey: duplicateKey({
            invoiceMonth,
            date: s.date,
            merchantNormalized,
            amountCents,
            installmentCurrent: installment?.current ?? null,
            installmentTotal: installment?.total ?? null,
          }),
        };
      })
    : [];

  if (drafts.length > 0 && staged.length !== rows.length) {
    issues.push({
      level: "info",
      message: `${rows.length - staged.length} linha(s) do arquivo não puderam ser lidas.`,
    });
  }

  return {
    format: "csv",
    drafts,
    columns,
    headers: [...headers],
    signConvention: convention,
    detectedMonth: invoiceMonth,
    monthSource: confirmed ? null : fromName ? "filename" : fromDates ? "dates" : null,
    institution: guessInstitution(options.fileName),
    // Nem CSV nem planilha do Nubank trazem o total impresso; só o PDF traz.
    reportedTotalCents: null,
    issues,
  };
}

const INSTITUTIONS = [
  { pattern: /nubank|nu_|^nu-/i, name: "Nubank" },
  { pattern: /itau|ita[uú]/i, name: "Itaú" },
  { pattern: /bradesco/i, name: "Bradesco" },
  { pattern: /santander/i, name: "Santander" },
  { pattern: /inter\b/i, name: "Inter" },
  { pattern: /c6\b/i, name: "C6" },
  { pattern: /caixa/i, name: "Caixa" },
  { pattern: /\bbb\b|banco.?do.?brasil/i, name: "Banco do Brasil" },
];

/** Palpite de instituição pelo nome do arquivo. Só rótulo, nada depende dele. */
export function guessInstitution(fileName: string): string | null {
  return INSTITUTIONS.find((i) => i.pattern.test(fileName))?.name ?? null;
}

/** Lê um CSV completo. */
export function parseCsv(text: string, options: ParseOptions): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    // Deixa tudo como texto: a conversão automática do Papa Parse leria
    // "1.023,73" como 1.023, e o nosso parseAmount trata o formato certo.
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const result = buildDrafts(parsed.data, headers, options);

  // Erros do Papa Parse viram avisos: linhas quebradas não devem derrubar o
  // arquivo inteiro, mas precisam aparecer na revisão.
  for (const error of parsed.errors.slice(0, 10)) {
    result.issues.push({
      level: "warning",
      message: `Linha malformada: ${error.message}`,
      row: typeof error.row === "number" ? error.row + 1 : undefined,
    });
  }

  return result;
}
