# Calculadoras de bolsillo

Web de finanzas para Argentina: dólar, inflación, noticias del día y calculadoras (plazo fijo, sueldo vs inflación, ahorro mensual, conversor de dólares).

## Cómo está armada

- `index.html`: la página entera (diseño, calculadoras y gráficos).
- `datos.json`: los datos del día. La página los lee de acá.
- `scripts/actualizar.mjs`: programa que trae los datos nuevos y reescribe `datos.json`.
- `.github/workflows/actualizar.yml`: le dice a GitHub que corra ese programa todas las noches a las 21:17 (hora de Argentina).

## De dónde salen los datos

| Dato | Fuente |
|---|---|
| Dólar (oficial, blue, MEP, CCL, tarjeta, mayorista) | dolarapi.com |
| Inflación mensual e interanual | INDEC, vía argentinadatos.com |
| Riesgo país | JP Morgan, vía argentinadatos.com |
| Tasas de plazo fijo | BCRA, vía argentinadatos.com |
| Noticias | Google Noticias (titulares con link a la nota) |

Si alguna fuente falla una noche, se conserva el dato anterior.

## Probarlo en tu compu (opcional)

Con Node.js 20 o más nuevo instalado:

```
node scripts/actualizar.mjs
```

Después abrí la carpeta con un servidor local (por ejemplo `npx serve`), porque si abrís `index.html` con doble clic el navegador no deja leer `datos.json`.
