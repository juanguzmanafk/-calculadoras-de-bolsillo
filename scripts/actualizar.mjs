// Actualiza datos.json con los datos del día.
// Lo corre GitHub Actions todas las noches (ver .github/workflows/actualizar.yml).
// También lo podés correr a mano con:  node scripts/actualizar.mjs
//
// Si una fuente falla, se conserva el dato anterior: la web nunca queda vacía.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = path.join(RAIZ, "datos.json");

const URLS = {
  dolares: "https://dolarapi.com/v1/dolares",
  inflacion: "https://api.argentinadatos.com/v1/finanzas/indices/inflacion",
  interanual: "https://api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual",
  riesgo: "https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo",
  plazoFijo: "https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo",
  noticias: "https://news.google.com/rss/search?q=" +
    encodeURIComponent("(dólar OR inflación OR \"plazo fijo\" OR \"riesgo país\" OR BCRA) Argentina when:1d") +
    "&hl=es-419&gl=AR&ceid=AR:es-419",
};

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function fechaHoy() {
  return new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric" });
}

function ahoraISO() {
  // Hora de Argentina (UTC-3, sin horario de verano)
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 19) + "-03:00";
}

const redondear = (x, dec = 2) => Math.round(x * 10 ** dec) / 10 ** dec;

// ---------- Partes (funciones puras, fáciles de probar) ----------

export function armarDolar(prev, lista) {
  const por = Object.fromEntries(lista.map((d) => [d.casa, d]));
  const v = (casa, campo) => (por[casa] && typeof por[casa][campo] === "number" ? por[casa][campo] : null);
  const out = structuredClone(prev);
  const set = (obj, campo, val) => { if (val != null) obj[campo] = val; };
  set(out.oficial, "compra", v("oficial", "compra"));
  set(out.oficial, "venta", v("oficial", "venta"));
  set(out.blue, "compra", v("blue", "compra"));
  set(out.blue, "venta", v("blue", "venta"));
  set(out.mep, "venta", v("bolsa", "venta"));
  set(out.ccl, "venta", v("contadoconliqui", "venta"));
  set(out.tarjeta, "venta", v("tarjeta", "venta"));
  set(out.mayorista, "venta", v("mayorista", "venta"));
  out.fuente = "dolarapi.com, " + fechaHoy();
  return out;
}

export function armarInflacion(prev, mensual, interanual) {
  // mensual / interanual: [{ fecha: "2026-09-30", valor: 1.9 }, ...]
  if (!Array.isArray(mensual) || mensual.length === 0) return prev;
  const orden = [...mensual].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = orden[orden.length - 1];
  const [anio, mes] = ultimo.fecha.split("-").map(Number);
  const delAnio = orden.filter((x) => Number(x.fecha.slice(0, 4)) === anio);
  const acumulada = (delAnio.reduce((acc, x) => acc * (1 + x.valor / 100), 1) - 1) * 100;
  const out = structuredClone(prev);
  // Si no hay mes nuevo, no tocamos nada
  if (prev.ultimoMes === `${MESES_LARGO[mes - 1]} ${anio}`) return prev;
  out.ultimoMes = `${MESES_LARGO[mes - 1]} ${anio}`;
  out.mensual = redondear(ultimo.valor, 1);
  out.acumuladaAnio = redondear(acumulada, 1);
  if (Array.isArray(interanual) && interanual.length) {
    const ia = [...interanual].sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
    if (ia.fecha.slice(0, 7) === ultimo.fecha.slice(0, 7)) out.interanual = redondear(ia.valor, 1);
  }
  // La clave se llama serie2026 porque así la lee la página; guarda los meses del año en curso.
  out.serie2026 = delAnio.map((x) => ({ mes: MESES[Number(x.fecha.slice(5, 7)) - 1], valor: redondear(x.valor, 1) }));
  // El dato de un mes sale a mediados del mes siguiente
  const sig = MESES_LARGO[mes % 12] + " " + (mes === 12 ? anio + 1 : anio);
  const publica = MESES_LARGO[(mes + 1) % 12].toLowerCase();
  out.proximoDato = `${sig}, a mediados de ${publica} (ver calendario del INDEC)`;
  out.fuente = "INDEC vía argentinadatos.com";
  return out;
}

export function armarRiesgo(prev, dato) {
  if (!dato || typeof dato.valor !== "number") return prev;
  return { valor: Math.round(dato.valor), fuente: "JP Morgan vía argentinadatos.com, " + fechaHoy() };
}

export function armarPlazoFijo(prev, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return prev;
  // Las tasas vienen como fracción (0.24 = 24%)
  const conTasa = lista.filter((b) => typeof b.tnaClientes === "number" && b.tnaClientes > 0);
  if (!conTasa.length) return prev;
  const mejor = conTasa.reduce((a, b) => (b.tnaClientes > a.tnaClientes ? b : a));
  const tna = mejor.tnaClientes < 1 ? mejor.tnaClientes * 100 : mejor.tnaClientes;
  const nombre = String(mejor.entidad || "un banco").replace(/\s+S\.?A\.?U?\.?$/i, "").trim();
  return {
    tnaReferencia: redondear(tna, 2),
    detalle: `Tasa más alta a 30 días que informan los bancos al BCRA (${nombre}). Los bancos grandes suelen pagar menos.`,
    fuente: "BCRA vía argentinadatos.com, " + fechaHoy(),
  };
}

function limpiar(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export function armarNoticias(prev, xml, cantidad = 6) {
  if (!xml || typeof xml !== "string") return prev;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const vistas = new Set();
  const out = [];
  for (const it of items) {
    const titulo = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const fuente = (it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1];
    if (!titulo || !link) continue;
    let t = limpiar(titulo);
    const f = fuente ? limpiar(fuente) : "";
    if (f && t.endsWith(" - " + f)) t = t.slice(0, -(f.length + 3));
    const clave = t.toLowerCase().slice(0, 50);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push({ titulo: t, resumen: "", bolsillo: "", fuente: f || "Google Noticias", url: limpiar(link) });
    if (out.length >= cantidad) break;
  }
  return out.length >= 3 ? out : prev;
}

// ---------- Programa principal ----------

async function traer(url, tipo = "json") {
  const r = await fetch(url, { headers: { "User-Agent": "calculadoras-de-bolsillo/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return tipo === "json" ? r.json() : r.text();
}

async function intentar(nombre, fn) {
  try { return await fn(); }
  catch (e) { console.warn(`⚠️  ${nombre}: ${e.message} (se conserva el dato anterior)`); return undefined; }
}

async function main() {
  const prev = JSON.parse(await readFile(ARCHIVO, "utf8"));
  const datos = structuredClone(prev);

  const [dolares, mensual, interanual, riesgo, plazos, rss] = await Promise.all([
    intentar("dólar", () => traer(URLS.dolares)),
    intentar("inflación", () => traer(URLS.inflacion)),
    intentar("inflación interanual", () => traer(URLS.interanual)),
    intentar("riesgo país", () => traer(URLS.riesgo)),
    intentar("plazo fijo", () => traer(URLS.plazoFijo)),
    intentar("noticias", () => traer(URLS.noticias, "text")),
  ]);

  if (Array.isArray(dolares)) datos.dolar = armarDolar(prev.dolar, dolares);
  datos.inflacion = armarInflacion(prev.inflacion, mensual, interanual);
  datos.riesgoPais = armarRiesgo(prev.riesgoPais, riesgo);
  datos.plazoFijo = armarPlazoFijo(prev.plazoFijo, plazos);
  datos.noticias = armarNoticias(prev.noticias, rss);
  datos.actualizado = ahoraISO();

  await writeFile(ARCHIVO, JSON.stringify(datos, null, 2) + "\n");
  console.log("✅ datos.json actualizado:", datos.actualizado);
  console.log(`   Blue $${datos.dolar.blue.venta} · MEP $${datos.dolar.mep.venta} · Inflación ${datos.inflacion.ultimoMes} ${datos.inflacion.mensual}% · Riesgo país ${datos.riesgoPais.valor} · ${datos.noticias.length} noticias`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
