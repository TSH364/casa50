import Link from "next/link";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DoriBarra } from "@/domain/home";

/**
 * O gasto do mes com a Dori: a barra e o corpo dela, a cabeca vai na ponta.
 *
 * O desenho segue `doriBarra` (domain/home.ts): calma e sorrindo no ritmo,
 * orelha em pe e numero em ambar acima dele, parada na ponta quando passa do
 * previsto, o rabinho abanando so num mes fechado abaixo. A setinha "hoje"
 * marca onde ela deveria estar - e o unico sinal que a barra da de ritmo,
 * entao o texto dela vai inteiro no rotulo acessivel.
 *
 * Tudo em % da largura, para caber em qualquer tela; a margem da direita
 * guarda o focinho quando a barra chega ao fim.
 */
export function DoriRitmo({ barra }: { barra: DoriBarra }) {
  const { estado, alerta } = barra;
  const semBarra = estado === "vazio" || estado === "sem-previsao";
  const pequena = estado === "pequena";
  const p = Math.min(100, barra.pct);
  const dentro = !semBarra && !pequena && p >= 30;

  return (
    <div role="img" aria-label={barra.rotulo} className="relative h-[88px] w-full">
      <div className="absolute inset-y-0 left-0 right-8">
        <div
          className={cn(
            "absolute inset-x-0 top-[26px] h-8 rounded-full",
            semBarra ? "border-[1.5px] border-dashed border-line-strong" : "bg-dori-trilho shadow-[inset_0_1px_3px_rgba(0,0,0,0.18)]",
          )}
        />

        {semBarra ? (
          <p className="absolute left-16 top-[26px] flex h-8 items-center text-corpo font-semibold">
            {estado === "vazio" ? (
              <Link href="/importar" className="text-brand hover:underline">
                Importe a primeira fatura →
              </Link>
            ) : (
              <span className="font-medium text-ink-muted">A previsão aparece com mais um mês de faturas.</span>
            )}
          </p>
        ) : null}

        {estado === "fechou" ? (
          <svg width="44" height="40" viewBox="0 0 44 40" className="absolute -left-3.5 -top-1 overflow-visible" aria-hidden>
            <path d="M22 38 Q9 32 12 12" fill="none" stroke="var(--color-dori-contorno)" strokeWidth="9" strokeLinecap="round" />
            <path d="M22 38 Q9 32 12 12" fill="none" stroke="#0b0c10" strokeWidth="6" strokeLinecap="round" />
            <path d="M4 14 Q1 9 4 4M23 10 Q27 6 25 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-ink-muted" />
          </svg>
        ) : null}

        {!semBarra && !pequena ? (
          <>
            {p >= 40 ? <span className="absolute left-3.5 top-[50px] h-4 w-2.5 rounded-full bg-[#0b0c10] shadow-[0_0_0_1.5px_var(--color-dori-contorno)]" /> : null}
            <span
              className="absolute top-[50px] h-4 w-2.5 rounded-full bg-[#0b0c10] shadow-[0_0_0_1.5px_var(--color-dori-contorno)]"
              style={{ left: `max(20px, calc(${p}% - 30px))` }}
            />
            <span
              className={cn(
                "tabular absolute left-0 top-[26px] flex h-8 items-center rounded-full pl-3.5 text-corpo font-bold shadow-[0_0_0_1.5px_var(--color-dori-contorno)]",
                alerta ? "text-[#f2b23c]" : "text-white",
              )}
              style={{ width: `max(40px, calc(${p}% - 12px))`, background: "linear-gradient(90deg, #0b0c10, #2c303b)" }}
            >
              {dentro ? `${barra.pct}%` : null}
            </span>
            <span
              className="absolute top-9 h-[22px] w-5 rounded-[10px_10px_11px_11px] bg-white"
              style={{ left: `max(10px, calc(${p}% - 34px))` }}
            />
          </>
        ) : null}

        <Cabeca
          estado={estado}
          alerta={alerta}
          left={semBarra || pequena ? "-6px" : `calc(${p}% - 28px)`}
        />

        {!semBarra && !dentro ? (
          <span
            className={cn(
              "tabular absolute top-[26px] flex h-8 items-center text-corpo font-bold",
              alerta ? "text-attention" : "text-ink",
            )}
            style={{ left: pequena ? "56px" : `calc(${p}% + 32px)` }}
          >
            {barra.pct}%
          </span>
        ) : null}

        {barra.ritmo !== null && !semBarra && estado !== "passou" ? (
          <>
            <svg
              width="12"
              height="8"
              viewBox="0 0 12 8"
              className="absolute top-[62px] text-ink"
              style={{ left: `calc(${barra.ritmo}% - 6px)` }}
              aria-hidden
            >
              <path d="M6 0 L12 8 H0 Z" fill="currentColor" />
            </svg>
            <span
              className="absolute top-[70px] w-10 text-center text-legenda font-semibold text-ink-muted"
              style={{ left: `calc(${barra.ritmo}% - 20px)` }}
            >
              hoje
            </span>
          </>
        ) : null}
      </div>

      {estado === "passou" ? (
        <span className="tabular absolute right-0 top-16 rounded-full bg-attention-soft px-2.5 py-0.5 text-legenda font-bold text-attention">
          +{formatCents(barra.excessoCents)} acima do previsto
        </span>
      ) : null}
    </div>
  );
}

function Cabeca({ estado, alerta, left }: { estado: DoriBarra["estado"]; alerta: boolean; left: string }) {
  const dormindo = estado === "vazio";
  return (
    <svg
      width="56"
      height="46"
      viewBox="0 0 56 46"
      className="absolute top-1.5 overflow-visible"
      style={{ left }}
      aria-hidden
    >
      <g stroke="var(--color-dori-contorno)" strokeWidth="1.5" strokeLinejoin="round">
        <ellipse cx="21" cy="22" rx="16" ry="15" fill="#2c303b" />
        <path d="M26 13 Q46 15 53 23 Q46 31 26 31 Z" fill="#2c303b" />
      </g>
      <ellipse cx="21" cy="22" rx="15" ry="14" fill="#2c303b" />
      <circle cx="52.5" cy="23" r="2.8" fill="#0b0c10" />
      {alerta ? (
        <>
          {/* Orelha levantada para tras: atenta, e ainda de salsicha. */}
          <path d="M18 10 Q6 3 0 11 Q4 17 16 17 Z" fill="#0b0c10" />
          <circle cx="30" cy="18" r="3.2" fill="#ffffff" />
          <circle cx="30.8" cy="18.3" r="1.7" fill="#0b0c10" />
        </>
      ) : (
        <>
          <path d="M14 11 Q2 17 6 35 Q11 40 17 34 Q16 22 21 13 Z" fill="#0b0c10" />
          <path
            d={dormindo ? "M27 19 h6" : "M27 18 q3 -3 6 0"}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
