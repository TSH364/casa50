"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, House } from "lucide-react";
import { desligarHA, gerarCodigoHA, salvarTarifaHA } from "@/actions/home-assistant";
import { configuracaoHA } from "@/domain/home-assistant";
import type { EstadoHA } from "@/data/home-assistant";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";

function quando(iso: string | null): string {
  if (!iso) return "ainda não consultou";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "consultou agora há pouco";
  if (min < 60) return `consultou há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `consultou há ${h} h` : `consultou há ${Math.round(h / 24)} dia(s)`;
}

function Copiavel({ rotulo, texto }: { rotulo: string; texto: string }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado.");
    } catch {
      toast.error("Não deu para copiar. Selecione o texto e copie à mão.");
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="text-legenda font-semibold uppercase tracking-[0.08em] text-ink-faint">{rotulo}</p>
        <Button type="button" size="sm" variant="ghost" onClick={copiar}>
          <Copy aria-hidden /> Copiar
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-(--radius-control) bg-surface-2 p-3 font-mono text-legenda text-ink">
        {texto}
      </pre>
    </div>
  );
}

/**
 * O Home Assistant na tela da Casa: um codigo da casa (aparece uma vez), a
 * configuracao para colar nele e a tarifa de energia. O Home Assistant le um
 * resumo do mes e as tarefas, cria e conclui tarefas, e manda o consumo de
 * energia - sempre com o codigo, nunca com o login de ninguem.
 */
export function HomeAssistantCard({
  estado,
  podeConfigurar,
  base,
}: {
  estado: EstadoHA;
  podeConfigurar: boolean;
  /** O endereco do app, para o YAML. */
  base: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [verConfig, setVerConfig] = useState(false);
  const [confirmar, setConfirmar] = useState<"trocar" | "desligar" | null>(null);
  const [tarifa, setTarifa] = useState(estado.tarifaKwh === null ? "" : String(estado.tarifaKwh).replace(".", ","));

  function gerar() {
    start(async () => {
      const r = await gerarCodigoHA();
      setConfirmar(null);
      if (r.error || !r.codigo) {
        toast.error(r.error ?? "Não foi possível gerar o código.");
        return;
      }
      setCodigo(r.codigo);
      router.refresh();
    });
  }

  function desligar() {
    start(async () => {
      const r = await desligarHA();
      setConfirmar(null);
      if (r.error) toast.error(r.error);
      else {
        setCodigo(null);
        toast.success("Home Assistant desligado. O código antigo parou de valer.");
      }
      router.refresh();
    });
  }

  function salvarTarifa() {
    const texto = tarifa.trim().replace(/\s/g, "").replace(",", ".");
    const valor = texto === "" ? null : Number(texto);
    if (valor !== null && !Number.isFinite(valor)) {
      toast.error("Use o valor em reais por kWh, como 0,95.");
      return;
    }
    start(async () => {
      const r = await salvarTarifaHA({ tarifa: valor });
      if (r.error) toast.error(r.error);
      else toast.success(valor === null ? "Tarifa removida." : "Tarifa salva.");
      router.refresh();
    });
  }

  const config = configuracaoHA(base, codigo);

  return (
    <Card>
      <div id="home-assistant" className="scroll-mt-20" />
      <CardHeader
        title="Home Assistant"
        description="O mês do Fluxo como sensores (gasto, previsto, contas, metas), as tarefas da casa e o consumo de energia que o Home Assistant mede."
      />

      {!estado.disponivel ? (
        <p className="text-corpo text-ink-muted">Falta aplicar a atualização do banco de dados do Home Assistant.</p>
      ) : (
        <div className="space-y-4">
          {estado.ativo ? (
            <div className="flex items-start gap-3 rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
              <House className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-corpo text-ink">
                  Ligado desde {new Date(estado.criadoEm!).toLocaleDateString("pt-BR")}
                </p>
                <p className="text-legenda text-ink-faint">{quando(estado.ultimoAcessoEm)}</p>
              </div>
            </div>
          ) : null}

          {codigo ? (
            <div className="space-y-3 rounded-(--radius-control) border border-attention/40 bg-attention-soft p-3">
              <p className="text-corpo text-attention">
                O código aparece só agora. Cole a primeira linha no <code>secrets.yaml</code> do Home Assistant; o resto,
                no <code>configuration.yaml</code>. Se perder o código, gere outro.
              </p>
              <Copiavel rotulo="secrets.yaml" texto={config.segredo} />
              <Copiavel rotulo="configuration.yaml" texto={config.configuracao} />
            </div>
          ) : estado.ativo && verConfig ? (
            <div className="space-y-3">
              <Copiavel rotulo="secrets.yaml" texto={config.segredo} />
              <Copiavel rotulo="configuration.yaml" texto={config.configuracao} />
            </div>
          ) : null}

          {podeConfigurar ? (
            <div className="flex flex-wrap gap-2">
              {estado.ativo ? (
                <>
                  {!codigo ? (
                    <Button size="sm" variant="outline" onClick={() => setVerConfig((v) => !v)}>
                      {verConfig ? "Esconder a configuração" : "Ver a configuração"}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmar("trocar")} disabled={pending}>
                    Trocar o código
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmar("desligar")} disabled={pending}>
                    Desligar
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={gerar} disabled={pending}>
                  Gerar o código da casa
                </Button>
              )}
            </div>
          ) : null}

          {estado.ativo ? (
            // O botao ao lado do campo, e a dica embaixo dos dois: com a dica
            // dentro do Field, o botao descia para o fim dela.
            <div className="border-t border-line pt-4">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Tarifa de energia (R$ por kWh)" htmlFor="ha-tarifa">
                    <Input
                      id="ha-tarifa"
                      inputMode="decimal"
                      placeholder="0,95"
                      value={tarifa}
                      onChange={(e) => setTarifa(e.target.value)}
                      disabled={!podeConfigurar}
                      aria-describedby="ha-tarifa-dica"
                    />
                  </Field>
                </div>
                {podeConfigurar ? (
                  <Button variant="outline" onClick={salvarTarifa} disabled={pending}>
                    Salvar
                  </Button>
                ) : null}
              </div>
              <p id="ha-tarifa-dica" className="mt-1.5 text-legenda text-ink-faint">
                A conta de luz dividida pelo consumo dela, com impostos e bandeira. Vira o custo estimado do mês.
              </p>
            </div>
          ) : null}

          <p className="text-legenda text-ink-faint">
            O Home Assistant só recebe números do mês (totais, contas com data, metas) e os títulos das tarefas: nenhum
            lançamento, loja ou e-mail. O código é da casa; trocar ou desligar faz o anterior parar de valer na hora.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmar !== null}
        onOpenChange={(aberto) => setConfirmar(aberto ? confirmar : null)}
        title={confirmar === "trocar" ? "Trocar o código" : "Desligar o Home Assistant"}
        itemLabel="Home Assistant"
        description={
          confirmar === "trocar"
            ? "O código atual para de valer na hora. O Home Assistant só volta a ler o Fluxo com o código novo no secrets.yaml."
            : "O Home Assistant para de ler o Fluxo e de mandar o consumo. As leituras de energia já recebidas ficam."
        }
        confirmLabel={confirmar === "trocar" ? "Trocar" : "Desligar"}
        pending={pending}
        onConfirm={confirmar === "trocar" ? gerar : desligar}
      />
    </Card>
  );
}
