-- Radar de produtos: a imagem do produto.
--
-- A imagem que a loja publica para compartilhar o anuncio (og:image), lida da
-- pagina da melhor oferta. So o endereco; a imagem continua na loja.
alter table public.radar_products add column if not exists image_url text
  check (image_url is null or image_url like 'https://%');
