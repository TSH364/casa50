/**
 * Monta um .xlsx de verdade em memoria, para os testes nao dependerem de um
 * arquivo binario no repositorio - e para o caminho de descompressao ser
 * exercitado de fato, e nao simulado.
 */
import { deflateRawSync } from "node:zlib";

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export interface Entrada {
  nome: string;
  conteudo: string;
  /** Sem compressao, para exercitar os dois métodos do formato. */
  guardado?: boolean;
}

/** Monta um zip valido, com diretorio central e tudo. */
export function zip(entradas: readonly Entrada[]): ArrayBuffer {
  const codificador = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let offset = 0;

  for (const e of entradas) {
    const cru = codificador.encode(e.conteudo);
    const dados = e.guardado ? cru : new Uint8Array(deflateRawSync(cru));
    const nome = codificador.encode(e.nome);
    const metodo = e.guardado ? 0 : 8;
    const soma = crc32(cru);

    const local = new Uint8Array(30 + nome.length + dados.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, metodo, true);
    lv.setUint32(14, soma, true);
    lv.setUint32(18, dados.length, true);
    lv.setUint32(22, cru.length, true);
    lv.setUint16(26, nome.length, true);
    local.set(nome, 30);
    local.set(dados, 30 + nome.length);
    locais.push(local);

    const central = new Uint8Array(46 + nome.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, metodo, true);
    cv.setUint32(16, soma, true);
    cv.setUint32(20, dados.length, true);
    cv.setUint32(24, cru.length, true);
    cv.setUint16(28, nome.length, true);
    cv.setUint32(42, offset, true);
    central.set(nome, 46);
    centrais.push(central);

    offset += local.length;
  }

  const corpo = [...locais, ...centrais];
  const tamanhoCentral = centrais.reduce((n, c) => n + c.length, 0);
  const fim = new Uint8Array(22);
  const fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, entradas.length, true);
  fv.setUint16(10, entradas.length, true);
  fv.setUint32(12, tamanhoCentral, true);
  fv.setUint32(16, offset, true);
  corpo.push(fim);

  const total = corpo.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let p = 0;
  for (const parte of corpo) {
    saida.set(parte, p);
    p += parte.length;
  }
  return saida.buffer;
}

