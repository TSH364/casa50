/**
 * Atalhos para os blocos da Analise, presos logo abaixo da barra do app.
 *
 * Sao oito blocos numa rolagem so: no celular, Parcelas e a matriz ficavam
 * a varias telas de distancia, sem caminho mais curto. Links comuns para as
 * ancoras da pagina - funcionam sem JavaScript.
 */
export function AtalhosDaAnalise({ itens }: { itens: { id: string; rotulo: string }[] }) {
  return (
    <nav
      aria-label="Ir para"
      className="sticky top-14 z-20 -mx-4 bg-canvas/90 px-4 py-2 backdrop-blur-md sm:mx-0 sm:px-0"
    >
      <ul className="flex gap-1.5 overflow-x-auto pb-0.5">
        {itens.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-line bg-surface px-3 text-legenda text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {i.rotulo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
