-- Radar de produtos: as outras lojas da ultima conferencia.
--
-- A busca acha varias ofertas; o historico guarda so a melhor de cada dia. A
-- tela mostra tambem as outras da conferencia mais recente - loja, preco e
-- link - para a casa comparar sem buscar de novo.
alter table public.radar_products add column if not exists last_offers jsonb
  check (last_offers is null or jsonb_typeof(last_offers) = 'array');
