/**
 * Endereços pelo OpenStreetMap (Nominatim): 1 pedido por localização, com identificação do app, como pede a política
 * de uso. Sem rede ou desligado (AGRO_GEOCODIFICAR=off), a coordenada vale como nome.
 */
const UA = 'K7-AgroMinds/0.3 (projeto academico UFG)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

interface Endereco {
  address?: Record<string, string>;
  lat?: string;
  lon?: string;
}

function cidadeDe(a: Record<string, string>): { cidade: string | undefined; uf: string | null } {
  const cidade = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const uf = /^BR-([A-Z]{2})$/.exec(a['ISO3166-2-lvl4'] ?? '')?.[1] ?? null;
  return { cidade: cidade ? `${cidade}${uf ? `/${uf}` : a.state ? `/${a.state}` : ''}` : undefined, uf };
}

/** Coordenada → "Cidade/UF" (ou a coordenada arredondada). */
export async function nomeDoLugar(lat: number, lon: number, geocodificar = true): Promise<{ nome: string; uf: string | null }> {
  const coordenada = { nome: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, uf: null };
  if (!geocodificar) return coordenada;
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return coordenada;
    const { cidade, uf } = cidadeDe(((await r.json()) as Endereco).address ?? {});
    return cidade ? { nome: cidade, uf } : coordenada;
  } catch {
    return coordenada;
  }
}

/** "-16.68, -49.25" ou "-16,68 -49,25" (como o Google Maps copia), em graus decimais. */
export function coordenadaDigitada(texto: string): { lat: number; lon: number } | undefined {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(texto);
  if (!m) return undefined;
  const lat = Number(m[1]!.replace(',', '.'));
  const lon = Number(m[2]!.replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

/**
 * O que a pessoa digitou (cidade, endereço, nome de fazenda conhecida ou coordenada) → o ponto e a cidade. Busca no
 * Brasil primeiro; sem rede ou sem resultado, undefined.
 */
export async function buscarLugar(texto: string, geocodificar = true): Promise<{ cidade: string; uf: string | null; lat: number; lon: number } | undefined> {
  const coord = coordenadaDigitada(texto);
  if (coord) {
    const n = await nomeDoLugar(coord.lat, coord.lon, geocodificar);
    return { ...coord, cidade: n.nome, uf: n.uf };
  }
  const q = texto.trim().slice(0, 120);
  if (!geocodificar || q.length < 2) return undefined;
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return undefined;
    const [achado] = (await r.json()) as Endereco[];
    if (!achado?.lat || !achado.lon) return undefined;
    const lat = Number(achado.lat);
    const lon = Number(achado.lon);
    const { cidade, uf } = cidadeDe(achado.address ?? {});
    return { lat, lon, cidade: cidade ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`, uf };
  } catch {
    return undefined;
  }
}
