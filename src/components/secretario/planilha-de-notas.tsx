"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { lerNotasAgora, salvarPlanilhaDeNotas } from "@/actions/notas";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

function haQuanto(iso: string | null): string {
  if (!iso) return "ainda não leu";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "leu agora há pouco";
  if (min < 60) return `leu há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `leu há ${h} h` : `leu há ${Math.round(h / 24)} dia(s)`;
}

/**
 * A planilha de notas fiscais que o Gemini preenche, ligada ao Google de quem
 * esta usando o app. O app le a planilha junto com o Gmail e liga cada nota
 * a compra da fatura - a linha "MERCADOLIVRE" passa a dizer o que foi
 * comprado.
 */
export function PlanilhaDeNotas({
  sheetId,
  lastSyncAt,
  lastError,
  total,
  ligadas,
}: {
  sheetId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  total: number;
  ligadas: number;
}) {
  const router = useRouter();
  const [link, setLink] = useState(sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : "");
  const [pending, start] = useTransition();

  function salvar() {
    start(async () => {
      const r = await salvarPlanilhaDeNotas({ link });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!link.trim()) {
        toast.success("Planilha desligada.");
        router.refresh();
        return;
      }
      const l = await lerNotasAgora();
      if (l.error) toast.error(l.error);
      else toast.success(`${l.novas} nota(s) lida(s); ${l.ligadas} ligada(s) a compras agora.`);
      router.refresh();
    });
  }

  function lerAgora() {
    start(async () => {
      const l = await lerNotasAgora();
      if (l.error) toast.error(l.error);
      else toast.success(`${l.novas} nota(s) lida(s); ${l.ligadas} ligada(s) a compras agora.`);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <FileSpreadsheet className="size-4 text-ink-muted" aria-hidden /> Planilha de notas fiscais
      </p>
      <p className="mt-0.5 text-legenda text-ink-faint">
        A planilha que o Gemini preenche com as notas do seu e-mail. Cada nota é ligada à compra da fatura, e o
        Extratos passa a mostrar o que foi comprado. O endereço e o CPF da planilha não são lidos.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <Field label="Link da planilha" htmlFor="planilha-notas">
          <Input
            id="planilha-notas"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            inputMode="url"
          />
          </Field>
        </div>
        <Button size="sm" onClick={salvar} disabled={pending}>
          Salvar
        </Button>
        {sheetId ? (
          <Button size="sm" variant="outline" onClick={lerAgora} disabled={pending}>
            <RefreshCw aria-hidden className={cn(pending && "animate-spin")} /> Ler agora
          </Button>
        ) : null}
      </div>
      {sheetId ? (
        <p className={cn("mt-1.5 text-legenda", lastError ? "text-danger" : "text-ink-faint")}>
          {lastError ?? `${total} nota(s) · ${ligadas} ligada(s) a compras · ${haQuanto(lastSyncAt)}`}
        </p>
      ) : null}
    </div>
  );
}
