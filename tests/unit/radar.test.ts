import { describe, expect, it } from "vitest";
import {
  avisosDoRadar,
  imagemDaPagina,
  lerOutras,
  outrasOfertas,
  ler,
  melhorOferta,
  normalizarNome,
  precisaConferir,
  suspeito,
  type RadarPreco,
  type RadarProduto,
} from "@/domain/radar";
import { escolherAvisos } from "@/domain/home";
import type { Offer } from "@/domain/shopping";

/**
 * Radar de produtos - as regras.
 *
 * O que guarda: confere uma vez por dia; o preco que entra no historico e de
 * anuncio de verdade (visto na pagina antes de so dito pela IA); preco bom
 * demais nao vira "caiu!"; e o aviso do Inicio sai so de meta batida ou queda
 * de 5%+, e so de conferencia recente.
 */

const agora = new Date("2026-10-06T12:00:00Z");

function oferta(extra: Partial<Offer>): Offer {
  return { title: "Air fryer", store: "Loja", priceCents: 40_000, installments: null, url: "https://loja.com/p", priceSeen: true, ...extra };
}

function produto(extra: Partial<RadarProduto> = {}): RadarProduto {
  return { id: "p1", nome: "Air fryer Mondial 4L", metaCents: null, ativo: true, conferidoEm: null, erro: null, melhor: null, imagem: null, outras: [], ...extra };
}

function preco(cents: number, horasAtras: number, loja = "Amazon"): RadarPreco {
  return {
    em: new Date(agora.getTime() - horasAtras * 3_600_000).toISOString(),
    cents,
    loja,
    url: "https://loja.com/p",
    titulo: null,
    vistoNaPagina: true,
  };
}

describe("quando conferir", () => {
  it("nunca conferido, ou há 20 h ou mais", () => {
    expect(precisaConferir(null, agora)).toBe(true);
    expect(precisaConferir("2026-10-05T17:00:00Z", agora)).toBe(false);
    expect(precisaConferir("2026-10-05T16:00:00Z", agora)).toBe(true);
  });
});

describe("a oferta que entra no histórico", () => {
  it("preço visto na página ganha de preço só dito pela IA, mesmo mais caro", () => {
    const m = melhorOferta([
      oferta({ priceCents: 35_000, priceSeen: false, store: "Barata" }),
      oferta({ priceCents: 39_000, priceSeen: true, store: "Conferida" }),
      oferta({ priceCents: 41_000, priceSeen: true, store: "Cara" }),
    ]);
    expect(m?.store).toBe("Conferida");
  });

  it("sem nenhum visto, o menor anúncio; link de busca da loja nunca", () => {
    expect(melhorOferta([oferta({ priceCents: 30_000, linkKind: "busca" }), oferta({ priceCents: 45_000, priceSeen: false })])?.priceCents).toBe(45_000);
    expect(melhorOferta([oferta({ linkKind: "busca" })])).toBeNull();
    expect(melhorOferta([])).toBeNull();
  });
});

describe("a leitura do histórico", () => {
  it("queda desde a anterior, menor já visto e meta", () => {
    const l = ler({ metaCents: 40_000 }, [preco(38_900, 1), preco(42_900, 25), preco(41_000, 49)]);
    expect(l).toMatchObject({ atualCents: 38_900, anteriorCents: 42_900, quedaCents: 4_000, menorCents: 38_900, abaixoDaMeta: true, suspeito: false });
  });

  it("preço menor que metade do usual é suspeito (acessório, refil, usado)", () => {
    expect(suspeito(15_000, [40_000, 41_000, 39_000])).toBe(true);
    expect(suspeito(30_000, [40_000, 41_000, 39_000])).toBe(false);
    // Com pouco histórico, não dá para dizer o que é usual.
    expect(suspeito(15_000, [40_000, 41_000])).toBe(false);
  });
});

describe("aviso no Início", () => {
  it("meta batida e queda de 5%+ avisam; queda pequena, preço suspeito e conferência velha não", () => {
    const avisos = avisosDoRadar(
      [
        { produto: produto({ id: "meta", nome: "Air fryer", metaCents: 40_000 }), historico: [preco(39_000, 2), preco(39_500, 26)] },
        { produto: produto({ id: "queda", nome: "Cadeira" }), historico: [preco(90_000, 2), preco(100_000, 26)] },
        { produto: produto({ id: "pouco", nome: "Mesa" }), historico: [preco(98_000, 2), preco(100_000, 26)] },
        {
          produto: produto({ id: "suspeito", nome: "Fone" }),
          historico: [preco(10_000, 2), preco(40_000, 26), preco(41_000, 50), preco(39_000, 74)],
        },
        { produto: produto({ id: "velho", nome: "Tapete", metaCents: 50_000 }), historico: [preco(40_000, 48)] },
        { produto: produto({ id: "pausado", nome: "TV", ativo: false, metaCents: 500_000 }), historico: [preco(300_000, 2)] },
      ],
      agora,
    );
    expect(avisos.map((a) => [a.produtoId, a.motivo])).toEqual([
      ["meta", "meta"],
      ["queda", "queda"],
    ]);
  });

  it("vira aviso com aba Radar, logo depois do orçamento estourado", () => {
    const [radar] = avisosDoRadar([{ produto: produto({ nome: "Cadeira" }), historico: [preco(90_000, 2, "Magalu"), preco(100_000, 26)] }], agora);
    const avisos = escolherAvisos(
      {
        orcamentos: [
          { nome: "Mercado", categoryId: "c1", ratio: 1.2, overCents: 10_000 },
          { nome: "Lazer", categoryId: "c2", ratio: 0.9, overCents: 0 },
        ],
        contasFaltando: [{ nome: "Internet" }],
        radar: [radar!],
      },
      3,
    );
    expect(avisos.map((a) => a.tipo)).toEqual(["passou", "radar", "conta"]);
    expect(avisos[1]).toMatchObject({ aba: "Radar", href: "/radar" });
    expect(avisos[1]!.texto.replace(/\s/g, " ")).toBe("Cadeira caiu R$ 100,00: agora R$ 900,00 na Magalu.");
  });
});

it("nome do produto sem espaços sobrando", () => {
  expect(normalizarNome("  Air   fryer\nMondial ")).toBe("Air fryer Mondial");
});

describe("a foto do produto", () => {
  const pagina = "https://www.magazineluiza.com.br/air-fryer/p/123/";

  it("og:image da página, relativa vira absoluta", () => {
    expect(imagemDaPagina('<head><meta property="og:image" content="https://a-static.mlcdn.com.br/foto.jpg"></head>', pagina)).toBe(
      "https://a-static.mlcdn.com.br/foto.jpg",
    );
    expect(imagemDaPagina("<meta content='/img/foto.png?w=600&amp;h=600' property='og:image' />", pagina)).toBe(
      "https://www.magazineluiza.com.br/img/foto.png?w=600&h=600",
    );
  });

  it("sem og:image, twitter:image ou link image_src; só https", () => {
    expect(imagemDaPagina('<meta name="twitter:image" content="https://cdn.loja.com/t.jpg">', pagina)).toBe("https://cdn.loja.com/t.jpg");
    expect(imagemDaPagina('<link rel="image_src" href="https://cdn.loja.com/l.jpg">', pagina)).toBe("https://cdn.loja.com/l.jpg");
    expect(imagemDaPagina('<meta property="og:image" content="http://cdn.loja.com/inseguro.jpg">', pagina)).toBeNull();
    expect(imagemDaPagina("<html><title>Loja</title></html>", pagina)).toBeNull();
  });
});

describe("as outras lojas", () => {
  it("uma por loja (a mais barata), sem a loja da melhor, sem link de busca, da mais barata à mais cara, até 4", () => {
    const melhor = oferta({ store: "Carrefour", priceCents: 125_910 });
    const outras = outrasOfertas(
      [
        melhor,
        oferta({ store: "carrefour ", priceCents: 126_000, url: "https://carrefour.com/2" }),
        oferta({ store: "Amazon", priceCents: 139_900, url: "https://amazon.com.br/a" }),
        oferta({ store: "Amazon", priceCents: 129_900, url: "https://amazon.com.br/b", priceSeen: false }),
        oferta({ store: "Magalu", priceCents: 134_900, url: "https://magalu.com/p" }),
        oferta({ store: "Kabum", priceCents: 120_000, url: "https://kabum.com.br/busca?q=x", linkKind: "busca" }),
        oferta({ store: "Casas Bahia", priceCents: 149_900, url: "https://casasbahia.com.br/p" }),
        oferta({ store: "Fast Shop", priceCents: 159_900, url: "https://fastshop.com.br/p" }),
        oferta({ store: "Inseguro", priceCents: 99_000, url: "http://inseguro.com/p" }),
      ],
      melhor,
    );
    expect(outras).toEqual([
      { loja: "Amazon", cents: 129_900, url: "https://amazon.com.br/b", vistoNaPagina: false },
      { loja: "Magalu", cents: 134_900, url: "https://magalu.com/p", vistoNaPagina: true },
      { loja: "Casas Bahia", cents: 149_900, url: "https://casasbahia.com.br/p", vistoNaPagina: true },
      { loja: "Fast Shop", cents: 159_900, url: "https://fastshop.com.br/p", vistoNaPagina: true },
    ]);
  });

  it("do banco, só o que tem formato de oferta", () => {
    expect(
      lerOutras([
        { loja: "Amazon", cents: 129_900, url: "https://amazon.com.br/b", vistoNaPagina: true },
        { loja: "Sem link", cents: 1 },
        { loja: "http", cents: 10, url: "http://x.com" },
        { loja: "Zero", cents: 0, url: "https://x.com" },
        "lixo",
      ]),
    ).toEqual([{ loja: "Amazon", cents: 129_900, url: "https://amazon.com.br/b", vistoNaPagina: true }]);
    expect(lerOutras(null)).toEqual([]);
  });
});
