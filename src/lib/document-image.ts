/**
 * Transformar foto e PDF escaneado em imagem que caiba numa chamada (secao 15).
 *
 * Roda no navegador, com `canvas`. Fica num arquivo proprio porque e a unica
 * parte da leitura com IA que o ambiente de teste nao executa - separada
 * assim, o resto do fluxo tem teste e isto e trocado por um duble.
 */

/**
 * Lado maior da imagem enviada.
 *
 * Os modelos com visao reduzem a imagem de qualquer jeito, para perto de
 * 1500px; mandar a foto de 4000px do celular so gastaria banda e creditos
 * para chegar no mesmo lugar. 1600 mantem legivel a letra miuda de um
 * orcamento impresso.
 */
const LADO_MAIOR = 1600;

/** JPEG com qualidade alta o bastante para numero pequeno nao borrar. */
const QUALIDADE = 0.85;

function paraJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", QUALIDADE);
}

function escala(largura: number, altura: number): number {
  return Math.min(1, LADO_MAIOR / Math.max(largura, altura));
}

/**
 * Foto do orcamento, reduzida e em JPEG.
 *
 * Passar pelo canvas resolve duas coisas de uma vez: o tamanho, e o formato -
 * o iPhone fotografa em HEIC, que os provedores nao aceitam, e o navegador
 * entrega a foto ja decodificada ao desenhar.
 */
export async function photoToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("imagem ilegível"));
      i.src = url;
    });
    const s = escala(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * s);
    canvas.height = Math.round(img.naturalHeight * s);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    // Fundo branco: PNG com transparencia viraria preto no JPEG, e texto
    // preto em fundo preto nao se le.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return paraJpeg(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A pagina do pdfjs, so no que se usa aqui. */
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}

/**
 * As primeiras paginas de um PDF sem texto, cada uma como imagem.
 *
 * Ate tres: orcamento escaneado raramente passa disso, e o total costuma
 * estar na ULTIMA pagina - mandar so a primeira leria os itens e perderia a
 * soma. Mais que tres e documento que nao e orcamento, ou custaria caro ler.
 */
export async function pdfPagesToJpeg(
  doc: { numPages: number; getPage(n: number): Promise<PdfPage> },
  maxPages = 3,
): Promise<string[]> {
  const saida: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // PDF vem em pontos (72 por polegada); escala 2 da ~150 dpi numa folha A4,
    // limitada pelo mesmo lado maior da foto.
    const s = Math.min(2, LADO_MAIOR / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: s });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    saida.push(paraJpeg(canvas));
  }
  return saida;
}
