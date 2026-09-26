import "server-only";
import { JEV_MODEL } from "@/domain/ai-models";
import { decide, OpenRouterError } from "./openrouter";
import type { ChoiceAnswer, ChoiceQuestion } from "./openrouter";

/**
 * Muitas perguntas ao Jev, com teto de tempo e de gasto (secao 15).
 *
 * Uma fatura tem dezenas de estabelecimentos, e cada um e uma chamada. Em
 * fila, 60 chamadas de 0,8 s seriam 48 s olhando para "revisando..."; em
 * paralelo sem limite, o OpenRouter devolve 429. Seis de cada vez fica no
 * meio: ~8 s para 60.
 *
 * TRES FREIOS, e cada um existe por um motivo:
 *
 *   - `maxJobs`: teto de chamadas por operacao. E o que protege a conta de
 *     uma fatura enorme, ou de um bug que gere perguntas demais.
 *   - `deadlineMs`: o que nao comecou ate la nao comeca. A funcao na Vercel
 *     tem limite, e passar dele derruba a revisao inteira - inclusive o que
 *     o Jev ja tinha respondido.
 *   - falha que vale para todas (chave recusada, sem credito): para na
 *     primeira. Repetir 60 vezes a mesma recusa so gasta tempo.
 *
 * Nada aqui joga erro para quem chama: o Jev e um extra. Se ele falhar, a
 * importacao segue com o que ja tinha, e `stoppedBy` diz por que.
 */

export interface JevJob {
  key: string;
  state: string;
  questions: Record<string, ChoiceQuestion>;
}

export interface JevRun {
  answers: Map<string, Record<string, ChoiceAnswer>>;
  /** Quantas perguntas nao foram feitas (teto ou tempo). */
  skipped: number;
  /** Quantas foram feitas e falharam. */
  failed: number;
  /** Frase para a tela quando o Jev parou antes do fim. */
  stoppedBy: string | null;
  /** Chamadas feitas ao OpenRouter e o custo delas, para o registro de gasto. */
  calls: number;
  costUsd: number;
}

export interface JevRunOptions {
  apiKey: string;
  concurrency?: number;
  maxJobs?: number;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Falhas que se repetiriam em todas as chamadas seguintes. */
const PARA_TUDO = new Set([401, 402, 403, 404]);

function frase(status: number): string {
  if (status === 401 || status === 403) return "O OpenRouter não aceitou a chave da casa.";
  if (status === 402) return "A conta do OpenRouter está sem créditos.";
  if (status === 404) return "O Jev não está disponível no OpenRouter agora.";
  if (status === 429) return "Muitas perguntas seguidas ao Jev; o resto ficou sem palpite.";
  return "O Jev não respondeu.";
}

export async function runJev(
  jobs: readonly JevJob[],
  options: JevRunOptions,
): Promise<JevRun> {
  const now = options.now ?? Date.now;
  const limite = now() + (options.deadlineMs ?? 25_000);
  const fila = jobs.slice(0, options.maxJobs ?? 80);
  const answers = new Map<string, Record<string, ChoiceAnswer>>();
  let skipped = jobs.length - fila.length;
  let failed = 0;
  let stoppedBy: string | null = null;
  let proximo = 0;
  let calls = 0;
  let costUsd = 0;

  async function trabalhador() {
    while (proximo < fila.length) {
      const job = fila[proximo++]!;
      if (now() > limite) {
        skipped += 1;
        continue;
      }
      try {
        calls += 1;
        const r = await decide(job.state, job.questions, {
          apiKey: options.apiKey,
          model: JEV_MODEL,
          fetchImpl: options.fetchImpl,
          onUsage: (u) => {
            costUsd += u.costUsd;
          },
        });
        answers.set(job.key, r);
      } catch (e) {
        failed += 1;
        const status = e instanceof OpenRouterError ? e.status : 0;
        stoppedBy ??= frase(status);
        if (PARA_TUDO.has(status)) {
          // O resto da fila nao sai: marca tudo como pulado de uma vez.
          skipped += fila.length - proximo;
          proximo = fila.length;
        }
      }
    }
  }

  const n = Math.max(1, Math.min(options.concurrency ?? 6, fila.length));
  await Promise.all(Array.from({ length: n }, trabalhador));

  if (stoppedBy === null && skipped > 0) {
    stoppedBy = "O Jev não chegou a ver todos os estabelecimentos desta vez.";
  }
  return { answers, skipped, failed, stoppedBy, calls, costUsd };
}
