"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import Papa from "papaparse";
import { importProjectItems } from "@/actions/project";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  readProjectSheet,
  scoreSheet,
  type Cell,
  type SheetItemRow,
  type SheetReading,
} from "@/domain/project-sheet";

/**
 * Subir a planilha de itens do projeto (secao 15).
 *
 * O ARQUIVO NÃO SAI DO APARELHO, como na leitura de fatura e na de PDF: a
 * planilha é aberta no navegador e o que vai para o servidor é a lista que a
 * pessoa conferiu. O `lib/xlsx` entra por import dinâmico porque só quem sobe
 * planilha precisa dele.
 *
 * A TELA É UMA CONFERÊNCIA, e não um botão de importar. Planilha de obra não
 * tem formato: a de quem usa isto tem seis abas, quatro blocos com cabeçalhos
 * diferentes na mesma aba, linhas de subtotal no meio e três colunas de
 * quantidade. O leitor acerta bastante, mas quem decide é quem escreveu a
 * planilha — por isso cada linha vem marcável, cada descarte vem dito com o
 * motivo, e a aba e a coluna de quantidade se trocam num toque.
 */

const QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** Limite de tamanho (secao 22). Uma planilha de obra tem dezenas de KB. */
const MAX_BYTES = 8 * 1024 * 1024;

interface Aba {
  name: string;
  grid: Cell[][];
}

export function SheetImport({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [abas, setAbas] = useState<Aba[] | null>(null);
  const [aba, setAba] = useState(0);
  const [colunaQtd, setColunaQtd] = useState<number | null>(null);
  const [fora, setFora] = useState<ReadonlySet<number>>(new Set());
  const [verDescartes, setVerDescartes] = useState(false);

  // A leitura é recalculada a cada troca de aba ou de coluna: é uma varredura
  // de algumas dezenas de linhas, e guardar o resultado abriria espaço para a
  // tela mostrar uma aba e mandar outra.
  const leitura: SheetReading | null =
    abas === null
      ? null
      : readProjectSheet(abas[aba]?.grid ?? [], {
          quantityColumn: colunaQtd ?? undefined,
        });

  const escolhidos = (leitura?.items ?? []).filter((i) => !fora.has(i.row));

  function limpar() {
    setAbas(null);
    setAba(0);
    setColunaQtd(null);
    setFora(new Set());
    setVerDescartes(false);
    if (input.current) input.current.value = "";
  }

  async function abrir(file: File) {
    setErro(null);
    if (file.size > MAX_BYTES) {
      setErro(`Arquivo de ${(file.size / 1024 / 1024).toFixed(1)} MB. O limite é 8 MB.`);
      return;
    }
    setLendo(true);
    try {
      let lidas: Aba[];
      if (/\.csv$/i.test(file.name)) {
        // CSV entra pelo mesmo caminho: o leitor trabalha sobre uma grade, e
        // de onde ela veio não muda nenhuma das decisões dele.
        const texto = await file.text();
        const { data } = Papa.parse<string[]>(texto, { skipEmptyLines: false });
        lidas = [{ name: file.name, grid: data as Cell[][] }];
      } else {
        const { readWorkbook } = await import("@/lib/xlsx");
        lidas = await readWorkbook(await file.arrayBuffer());
      }

      // Abre já na aba mais provável: num arquivo de seis abas, a primeira
      // costuma ser rascunho, e mostrar a errada faz parecer que não leu.
      let melhor = 0;
      let melhorNota = -1;
      lidas.forEach((a, i) => {
        const nota = scoreSheet(readProjectSheet(a.grid));
        if (nota > melhorNota) {
          melhorNota = nota;
          melhor = i;
        }
      });

      setAbas(lidas);
      setAba(melhor);
      setColunaQtd(null);
      setFora(new Set());
    } catch (e) {
      console.error("[projetos] falha ao ler planilha", e);
      setErro(
        "Não consegui abrir esta planilha. Salve como .xlsx ou .csv e tente de novo.",
      );
    } finally {
      setLendo(false);
      if (input.current) input.current.value = "";
    }
  }

  function importar() {
    if (escolhidos.length === 0) return;
    startTransition(async () => {
      const r = await importProjectItems({
        projectId,
        items: escolhidos.map((i) => ({
          name: i.name.slice(0, 160),
          stage: i.stage,
          unit: i.unit,
          plannedQuantity: i.quantity,
          note: i.note?.slice(0, 500) ?? null,
          supplier: i.supplier,
          amountCents: i.amountCents,
        })),
      });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      const partes = [`${r.created} ${r.created === 1 ? "item" : "itens"}`];
      if (r.quotes) partes.push(`${r.quotes} com preço`);
      if (r.duplicates?.length) partes.push(`${r.duplicates.length} já existiam`);
      toast.success(partes.join(" · "));
      limpar();
    });
  }

  if (leitura === null) {
    return (
      <div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          id="planilha-projeto"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void abrir(f);
          }}
        />
        <label
          htmlFor="planilha-projeto"
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] text-brand underline underline-offset-2"
        >
          {lendo ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="size-4" aria-hidden />
          )}
          {lendo ? "Lendo a planilha…" : "Subir uma planilha de itens"}
        </label>
        {erro ? <p className="mt-1 text-[12px] text-attention">{erro}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {abas !== null && abas.length > 1 ? (
        <div>
          <p className="mb-1 text-[12px] text-ink-faint">Aba da planilha</p>
          <div className="flex flex-wrap gap-1.5">
            {abas.map((a, i) => {
              const quantos = readProjectSheet(a.grid).items.length;
              return (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => {
                    setAba(i);
                    setColunaQtd(null);
                    setFora(new Set());
                  }}
                  aria-pressed={i === aba}
                  className={cn(
                    "min-h-9 rounded-[--radius-control] px-2.5 py-1.5 text-[12px]",
                    i === aba ? "bg-brand/15 text-brand" : "bg-surface-2 text-ink-faint",
                  )}
                >
                  {a.name}
                  <span className="ml-1 opacity-60">{quantos}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* A escolha que a planilha real obriga a oferecer: ela tem "Qtd projeto",
          "Qtd + perda" e "COMPRAR" lado a lado, e só quem montou sabe qual das
          três é a que vai ser comprada. O palpite é a última; trocar é um toque. */}
      {leitura.quantityOptions.length > 1 ? (
        <div>
          <p className="mb-1 text-[12px] text-ink-faint">Qual coluna é a quantidade</p>
          <div className="flex flex-wrap gap-1.5">
            {leitura.quantityOptions.map((o) => {
              const ativa =
                colunaQtd === null
                  ? o.column ===
                    leitura.quantityOptions[leitura.quantityOptions.length - 1]?.column
                  : colunaQtd === o.column;
              return (
                <button
                  key={o.column}
                  type="button"
                  onClick={() => setColunaQtd(o.column)}
                  aria-pressed={ativa}
                  className={cn(
                    "min-h-9 rounded-[--radius-control] px-2.5 py-1.5 text-[12px]",
                    ativa ? "bg-brand/15 text-brand" : "bg-surface-2 text-ink-faint",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {leitura.items.length === 0 ? (
        <p className="text-[13px] text-ink-faint">
          Não encontrei itens nesta aba. Tente outra, ou monte a lista à mão.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {leitura.items.map((item) => (
            <LinhaDoItem
              key={item.row}
              item={item}
              dentro={!fora.has(item.row)}
              onToggle={() =>
                setFora((prev) => {
                  const proximo = new Set(prev);
                  if (proximo.has(item.row)) proximo.delete(item.row);
                  else proximo.add(item.row);
                  return proximo;
                })
              }
            />
          ))}
        </ul>
      )}

      {/* O descarte é DITO, e não silencioso: a regra da secao 6 vale igual
          aqui. Se o leitor jogou fora uma linha que era item, é olhando esta
          lista que se descobre. */}
      {leitura.skipped.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setVerDescartes((v) => !v)}
            className="min-h-9 text-[12px] text-ink-faint underline underline-offset-2"
          >
            {leitura.skipped.length} linhas fora da lista
            {verDescartes ? " — esconder" : " — ver por quê"}
          </button>
          {verDescartes ? (
            <ul className="mt-1 space-y-0.5">
              {leitura.skipped.map((s) => (
                <li key={s.row} className="text-[11px] text-ink-faint">
                  <span className="tabular opacity-60">L{s.row}</span> {s.reason}:{" "}
                  <span className="opacity-80">{s.text.slice(0, 60)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button disabled={pending || escolhidos.length === 0} onClick={importar}>
          {pending
            ? "Gravando…"
            : `Importar ${escolhidos.length} ${escolhidos.length === 1 ? "item" : "itens"}`}
        </Button>
        <Button variant="ghost" onClick={limpar} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function LinhaDoItem({
  item,
  dentro,
  onToggle,
}: {
  item: SheetItemRow;
  dentro: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={cn("py-2", !dentro && "opacity-40")}>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={dentro}
          onChange={onToggle}
          className="mt-0.5 size-4 shrink-0 accent-brand"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[13px] text-ink">{item.name}</span>
            {item.stage ? (
              <span className="text-[11px] text-ink-faint">{item.stage}</span>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-faint">
            {item.quantity !== null ? (
              <span className="tabular">
                {QTD.format(item.quantity)} {item.unit ?? ""}
              </span>
            ) : null}
            {/* Sem repetir: quando o produto vem vazio o nome cai para a marca,
                e "Cerâmica Sul · Cerâmica Sul" na mesma linha só ocupa espaço
                de celular para não dizer nada. */}
            {item.supplier && item.supplier !== item.name ? (
              <span>{item.supplier}</span>
            ) : null}
            {item.amountCents !== null ? (
              <span className="tabular text-ink">{formatCents(item.amountCents)}</span>
            ) : (
              <span>sem preço</span>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}
