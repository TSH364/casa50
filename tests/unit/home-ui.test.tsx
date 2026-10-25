import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { doriBarra } from "@/domain/home";
import { DoriRitmo } from "@/components/home/dori-ritmo";
import { AvisoLinha } from "@/components/home/aviso-linha";
import { Barras } from "@/components/home/barras";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * O novo Inicio na tela: a barra da Dori diz o que mostra (leitor de tela),
 * marca o ritmo so quando ele existe, e cada estado tem o seu texto; o aviso
 * nao depende so da cor e a acao dele e alvo de toque; e as barras dizem a
 * porcentagem.
 */

const HOJE = new Date(2026, 8, 15, 12);
const barra = (spentCents: number, extra: Partial<Parameters<typeof doriBarra>[0]> = {}) =>
  doriBarra({ spentCents, expectedCents: 1_000_000, month: "2026-09", hasData: true, now: HOJE, ...extra });

describe("barra da Dori", () => {
  it("no ritmo: rótulo completo, porcentagem dentro e a setinha 'hoje'", () => {
    render(<DoriRitmo barra={barra(480_000)} />);
    expect(screen.getByRole("img", { name: /48% do previsto; ritmo esperado para hoje: 50%/ })).toBeTruthy();
    expect(screen.getByText("48%")).toBeTruthy();
    expect(screen.getByText("hoje")).toBeTruthy();
  });

  it("passou: pílula com o excesso, sem setinha", () => {
    render(<DoriRitmo barra={barra(1_120_000)} />);
    expect(screen.getByText(/\+R\$\s*1\.200,00 acima do previsto/)).toBeTruthy();
    expect(screen.queryByText("hoje")).toBeNull();
  });

  it("casa nova: leva a importar a primeira fatura", () => {
    render(<DoriRitmo barra={barra(0, { hasData: false })} />);
    expect(screen.getByRole("link", { name: /Importe a primeira fatura/ }).getAttribute("href")).toBe("/importar");
  });
});

describe("aviso e barras", () => {
  it("o aviso diz o assunto por escrito, não só pela cor", () => {
    render(
      <ul>
        <AvisoLinha aviso={{ tipo: "passou", aba: "Orçamento", texto: "Lazer passou R$ 120,00 do limite.", acao: "Ver os gastos", href: "/extratos?categoria=c2" }} />
      </ul>,
    );
    expect(screen.getByText("Orçamento")).toBeTruthy();
    const acao = screen.getByRole("link", { name: /Ver os gastos/ });
    expect(acao.getAttribute("href")).toBe("/extratos?categoria=c2");
    // 44px de altura: a acao e texto, mas e alvo de toque.
    expect(acao.className).toContain("min-h-11");
  });

  it("o aviso dos e-mails mostra a linha de detalhe e leva ao Secretário", () => {
    render(
      <ul>
        <AvisoLinha
          aviso={{ tipo: "email", aba: "E-mails", texto: "2 e-mails pedem algo de vocês.", detalhe: "Condomínio de outubro, R$ 850,00 · e mais 1", acao: "Abrir o Secretário", href: "/secretario" }}
        />
      </ul>,
    );
    expect(screen.getByText("Condomínio de outubro, R$ 850,00 · e mais 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abrir o Secretário/ }).getAttribute("href")).toBe("/secretario");
  });

  it("barra de meta: porcentagem acessível e situação escrita", () => {
    render(
      <Barras
        itens={[{ id: "m1", nome: "Viagem", razao: 1, detalhe: "R$ 5.000 de R$ 5.000", cor: "#35d29a", situacao: { texto: "Meta alcançada", tom: "positive" } }]}
      />,
    );
    const barraMeta = screen.getByRole("progressbar", { name: "Viagem" });
    expect(barraMeta.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("Meta alcançada")).toBeTruthy();
  });

  it("barra de meta com os tokens: cor lisa e a tinta pedida", () => {
    render(
      <Barras
        itens={[{ id: "m2", nome: "Reserva", razao: 0.62, detalhe: "R$ 6,2 mil de R$ 10 mil", cor: "var(--color-meta)", tinta: "var(--color-on-meta)" }]}
      />,
    );
    const preenchido = screen.getByText("62%") as HTMLElement;
    expect(preenchido.style.background).toBe("var(--color-meta)");
    expect(preenchido.style.color).toBe("var(--color-on-meta)");
  });
});
