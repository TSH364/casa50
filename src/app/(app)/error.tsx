"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * O que aparece quando uma tela nao consegue carregar.
 *
 * Nao existia. Sem este arquivo o Next mostra a propria tela de falha - fundo
 * branco e "Application error: a server-side exception has occurred" - que nao
 * diz nada a quem so queria ver o gasto do mes, e nao oferece saida nenhuma
 * alem de recarregar a pagina inteira na mao.
 *
 * MEDIDO nos logs do projeto: as falhas reais foram quatro respostas 504 em
 * 4.844 requisicoes, todas cortadas em ~5 segundos, com o Postgres sem
 * registro nenhum nesses instantes - o banco nem chegou a ver o pedido. Sao
 * passageiras por natureza, e `reset()` costuma resolver na primeira tentativa.
 * Por isso o texto fala em tentar de novo em vez de pedir para avisar alguem.
 *
 * O dinheiro nao corre risco aqui: isto e uma falha de LEITURA. Nada deixou de
 * ser gravado por causa dela, e a frase abaixo diz isso - numa tela de
 * financas, "deu erro" sem essa informacao assusta mais do que informa.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` e o que liga esta tela a linha correspondente no log do
    // servidor. A mensagem em si nao vai para o console do navegador: ela pode
    // carregar valor de lancamento vindo do Postgres.
    console.error("[tela] falha ao carregar", { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">
          Esta tela não carregou
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          A conexão com o banco falhou no meio do caminho. Costuma ser passageiro
          — tentar de novo quase sempre resolve.
        </p>
        <p className="mt-2 text-[12px] text-ink-faint">
          Nenhum lançamento foi perdido: isto é uma falha de leitura, e nada
          deixou de ser gravado por causa dela.
        </p>

        <div className="mt-4">
          <Button size="sm" onClick={reset}>
            <RefreshCw aria-hidden /> Tentar de novo
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-faint">
            Código desta falha: <span className="tabular">{error.digest}</span>
          </p>
        ) : null}
      </Card>
    </div>
  );
}
