/**
 * A Dori, a marca da Dor.IA: uma salsicha preta de peito branco, em formas
 * simples (corpo em capsula, cabeca redonda, focinho reto, a orelha num traco).
 *
 * `corpo` e `peito` mudam para o recorte de uma cor so (barra de baixo): o
 * corpo na cor do icone e o peito na cor do fundo, vazado.
 */
export function DoriMark({
  size = 120,
  corpo = "#0b0c10",
  peito = "#ffffff",
  className,
  title,
}: {
  size?: number;
  corpo?: string;
  peito?: string;
  className?: string;
  /** Sem titulo, o desenho e decorativo (quem esta ao lado ja diz o nome). */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 60"
      width={size}
      height={size / 2}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M22 30 L9 19" stroke={corpo} strokeWidth="5" strokeLinecap="round" />
      <rect x="25" y="40" width="8" height="14" rx="4" fill={corpo} />
      <rect x="77" y="40" width="8" height="14" rx="4" fill={corpo} />
      <rect x="18" y="24" width="72" height="22" rx="11" fill={corpo} />
      <path d="M78 30 L89 11 L101 18 L90 38 Z" fill={corpo} />
      <circle cx="95" cy="16" r="10" fill={corpo} />
      <path d="M97 8 H109 A5.5 5.5 0 0 1 109 19 H97 Z" fill={corpo} />
      <path d="M91 10 Q83 16 86 29" fill="none" stroke={peito} strokeOpacity="0.55" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M80 31 Q89 31 90 38 L86 46 L76 46 Q75 36 80 31 Z" fill={peito} />
      <circle cx="98" cy="12.5" r="1.7" fill={peito} />
    </svg>
  );
}
