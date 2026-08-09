import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/spike-t1-extraction";
const RUNS = `${ROOT}/spike/fixtures/runs/google/gemini-3-flash-preview/google-ai-studio`;

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dataUri = (page) =>
  `data:image/jpeg;base64,${readFileSync(`${ROOT}/spike/fixtures/pages/${page}.jpg`).toString("base64")}`;

const run = (page) => JSON.parse(readFileSync(`${RUNS}/${page}-1.json`, "utf8"));

const PAGES = [
  {
    id: "a", role: "A", source: "mono1", verified: true,
    caption: "Mono-recette. Ingrédients et étapes en puces rouges, contraste franc.",
    truth: "1 recette · 11 puces d'ingrédients · 8 puces d'étapes",
    verdict: "conforme",
    verdictLine: "11 sur 11, 8 sur 8. Le « fraîchement râpé » que le modèle précédent perdait est ici.",
    marks: { "0:ingredient:8": { kind: "fixed", note: "le modèle précédent écrivait « parmesan râpé »" } },
  },
  {
    id: "b", role: "B", source: "4recettes", verified: true,
    caption: "Quatre recettes en grille 2×2, en-têtes de pays plus gros que les titres, ingrédients en flux, étapes en prose non puçée.",
    truth: "4 recettes · dinde 17 puces · gazelle 15 puces · foie gras 10 · canard 10",
    verdict: "à discuter",
    verdictLine: "Comptes exacts et segmentation parfaite, mais c'est la seule page où les deux passes ne s'accordent pas.",
    marks: {
      "1:ingredient:7": { kind: "fixed", note: "manquait chez le modèle précédent" },
      "1:ingredient:8": { kind: "fixed", note: "manquait chez le modèle précédent" },
      "1:ingredient:5": { kind: "minor", note: "la passe 2 écrit « Pour la pâte : 250 g de farine » — l'étiquette de section entre ou non dans la ligne selon l'appel" },
      "1:ingredient:10": { kind: "minor", note: "la passe 2 écrit « Pour la salade : 10 oranges » — même hésitation" },
    },
  },
  {
    id: "c", role: "C", source: "complexe", verified: true,
    caption: "Texte sur photo, contraste faible, surface incurvée et brillante. La page la plus dure du lot.",
    truth: "1 recette · 10 puces d'ingrédients · 8 phrases d'étapes",
    verdict: "conforme",
    verdictLine: "Les quatre défauts du modèle précédent ont disparu, dont deux corruptions silencieuses.",
    marks: {
      "0:ingredient:1": { kind: "fixed", note: "manquait entièrement chez le modèle précédent" },
      "0:ingredient:2": { kind: "fixed", note: "était lu « 1 vinaigre de pommes de terre » — corruption silencieuse" },
      "0:ingredient:7": { kind: "fixed", note: "était lu « 1/4 verre » — un chiffre avait bougé" },
    },
  },
  {
    id: "e", role: "E", source: "duo1", verified: true,
    caption: "Un titre unique coiffant deux versions du même plat. Aucune liste d'ingrédients imprimée : les quantités sont noyées dans la prose.",
    truth: "2 recettes · aucune liste d'ingrédients sur la page",
    verdict: "à discuter",
    verdictLine: "Segmentation en 2 réussie sur le cas le plus ambigu. Mais le modèle a déduit les ingrédients, ce que le prompt lui interdit.",
    marks: {
      "0:ingredient:0": { kind: "minor", note: "déduit de la prose : la page n'imprime aucune liste d'ingrédients" },
      "0:step:7": { kind: "minor", note: "la page se contredit — 4 œufs cassés à l'étape 3, 3 jaunes ici. Transcription fidèle" },
    },
  },
  {
    id: "f", role: "F", source: "duo3", verified: false,
    caption: "Deux recettes sur une même coupure.",
    truth: "non vérifiée — à toi de juger",
    verdict: "non annoté",
    verdictLine: "Deux passes identiques, aucune réparation de schéma. Le contenu reste à confronter à la photo.",
    marks: {},
  },
  {
    id: "g", role: "G", source: "mono2", verified: false,
    caption: "Mono-recette.",
    truth: "non vérifiée — à toi de juger",
    verdict: "non annoté",
    verdictLine: "Deux passes identiques, aucune réparation de schéma. Le contenu reste à confronter à la photo.",
    marks: {},
  },
  {
    id: "h", role: "H", source: "mono3", verified: false,
    caption: "Mono-recette.",
    truth: "non vérifiée — à toi de juger",
    verdict: "non annoté",
    verdictLine: "Deux passes identiques, aucune réparation de schéma. Le contenu reste à confronter à la photo.",
    marks: {},
  },
];

const COMPARISON = [
  ["Page A — « fraîchement râpé »", "perdu", "présent"],
  ["Page B — cornes de gazelle", "13 lignes sur 15", "15 sur 15"],
  ["Page B — étiquette de section", "absorbée dans la ligne", "propre"],
  ["Page C — oignons grelots", "manquant", "présent"],
  ["Page C — « 1 vingtaine »", "lu « 1 vinaigre »", "exact"],
  ["Page C — « ½ verre »", "lu « 1/4 verre »", "« ½ »"],
  ["Page C — accord vin", "versé dans les étapes", "absent"],
  ["Réparations de schéma", "1", "0"],
  ["Latence page B", "14,3 s", "8,8 s"],
  ["Prix par appel, mesuré sur 14", "0,00064 $", "0,00452 $"],
];

// Mesuré le 2026-08-09 sur les sept mêmes pages, deux passes chacune. « Pages instables » compte les
// pages dont les deux appels ne rendent pas exactement le même texte — la seule colonne qui sépare
// vraiment ces modèles, et la seule qu'aucune fiche produit ne publie.
const RIVALS = [
  ["google/gemini-3-flash-preview", "0,00452", "6,1 s", "0", "1", "—", true],
  ["google/gemini-2.5-flash-lite", "0,00064", "5,0 s", "0", "0", "corrompt en silence : « 1 vingtaine » lu « 1 vinaigre »"],
  ["openai/gpt-5.6-luna", "0,00130", "18,1 s", "0", "7", "durées de cuisson qui apparaissent et disparaissent"],
  ["mistralai/ministral-8b-2512", "0,00041", "18,0 s", "0", "6", "fusionne les étapes en un bloc, liste d'ingrédients mouvante"],
  ["qwen/qwen3.5-9b", "0,00085", "302 s", "0", "2 / 3", "15 min pour un appel, 17 t/s"],
  ["qwen/qwen3-vl-32b-instruct", "0,00097", "20,4 s", "0", "5", "redécoupe les étapes différemment à chaque appel"],
  ["qwen/qwen3.5-35b-a3b", "0,00663", "41,5 s", "6", "4", "mesure invalide : le harnais n'envoyait aucun contrôle de raisonnement — non rejugé"],
  ["qwen/qwen3.6-flash", "0,00217", "25,0 s", "14", "—", "mesure invalide, même cause — non rejugé"],
];

function renderRecipe(recipe, recipeIndex, marks) {
  const line = (kind, index, content) => {
    const flag = marks[`${recipeIndex}:${kind}:${index}`];
    return `<li class="line${flag ? ` is-${flag.kind}` : ""}"><span class="line-text">${content}</span>${
      flag ? `<span class="line-note">${escape(flag.note)}</span>` : ""
    }</li>`;
  };

  return `<article class="recipe">
    <h3 class="recipe-title">${escape(recipe.title)}</h3>
    <p class="recipe-meta">
      <span class="tag">${escape(recipe.type)}</span>
      <span>${recipe.servings === null ? "portions non renseignées" : `${recipe.servings} portions`}</span>
      <span>${recipe.ingredients.length} ingrédients</span>
      <span>${recipe.steps.length} étapes</span>
    </p>
    <h4 class="field-label">Ingrédients</h4>
    <ul class="lines">${recipe.ingredients.map((item, index) => line("ingredient", index, escape(item.raw))).join("")}</ul>
    <h4 class="field-label">Étapes</h4>
    <ol class="lines lines-numbered">${recipe.steps.map((step, index) => line("step", index, escape(step))).join("")}</ol>
  </article>`;
}

const sections = PAGES.map((page) => {
  const artefact = run(page.id);
  return `<section class="page" id="page-${page.id}">
    <header class="page-head">
      <div class="page-id">
        <span class="page-role">Page ${page.role}</span>
        <span class="page-source">${escape(page.source)}.jpeg</span>
        <span class="page-source">${(artefact.latencyMs / 1000).toFixed(1)} s</span>
      </div>
      <p class="page-caption">${escape(page.caption)}</p>
      <p class="page-truth"><span class="field-label">Ce que porte la page</span> ${escape(page.truth)}</p>
      <p class="verdict verdict-${page.verified ? page.verdict.replace(/ /g, "-") : "non-annoté"}">
        <span class="verdict-tag">${escape(page.verdict)}</span>${escape(page.verdictLine)}
      </p>
    </header>
    <div class="split">
      <div class="plate">
        <figure>
          <img src="${dataUri(page.id)}" alt="Page ${page.role} du magazine" class="scan" loading="lazy" />
          <figcaption>Clique l'image pour l'agrandir.</figcaption>
        </figure>
      </div>
      <div class="reading">
        ${artefact.parsed.recipes.map((recipe, index) => renderRecipe(recipe, index, page.marks)).join("")}
      </div>
    </div>
  </section>`;
}).join("");

const html = `<title>Spike T1 — sept pages, jugées à l'œil</title>
<style>
  :root {
    --paper: #F8F8F8; --surface: #FFFFFF; --ink: #2E2723; --ink-muted: #6E645C;
    --ochre: #9A5B2B; --rule: #C6BDB4; --rule-strong: #8A7F74;
    --verified: #4F6A46; --defect: #A32E22;
    --display: "Iowan Old Style", "Hoefler Text", Palatino, Georgia, serif;
    --body: "Avenir Next", "Lucida Grande", Verdana, sans-serif;
    --data: "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.5; }
  .shell { max-width: 1400px; margin: 0 auto; padding: 3rem 1.5rem 6rem; }

  .masthead { border-bottom: 2px solid var(--ochre); padding-bottom: 1.25rem; margin-bottom: 2.5rem; }
  .masthead h1 { font-family: var(--display); font-weight: 600; font-size: clamp(1.9rem, 1.2rem + 2.2vw, 3rem); letter-spacing: -0.02em; line-height: 1.02; margin: 0 0 0.6rem; text-wrap: balance; }
  .masthead p { margin: 0 0 0.6rem; max-width: 70ch; color: var(--ink-muted); }
  .stamp { font-family: var(--data); font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ochre); }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin-bottom: 2.5rem; }
  .cell { background: var(--surface); padding: 1rem 1.1rem; }
  .cell dt { font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 0.3rem; }
  .cell dd { margin: 0; font-family: var(--display); font-size: 1.45rem; font-variant-numeric: tabular-nums; }
  .cell dd small { font-family: var(--body); font-size: 0.82rem; color: var(--ink-muted); display: block; letter-spacing: 0; }

  .compare { margin-bottom: 3.5rem; }
  .compare h2, .closing h2 { font-family: var(--display); font-weight: 600; font-size: 1.5rem; margin: 0 0 0.8rem; }
  .scroller { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; min-width: 520px; }
  th, td { text-align: left; padding: 0.5rem 1rem 0.5rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-size: 0.72rem; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-muted); }
  .was { color: var(--defect); }
  .now { color: var(--verified); }

  .page { border-top: 1px solid var(--rule-strong); padding-top: 1.75rem; margin-bottom: 4.5rem; }
  .page-head { margin-bottom: 1.5rem; }
  .page-id { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
  .page-role { font-family: var(--display); font-size: 1.5rem; font-weight: 600; }
  .page-source { font-family: var(--data); font-size: 0.8rem; color: var(--ink-muted); }
  .page-caption { margin: 0 0 0.5rem; max-width: 72ch; }
  .page-truth { margin: 0 0 0.9rem; font-family: var(--data); font-size: 0.85rem; color: var(--ink-muted); }
  .page-truth .field-label { display: inline; margin-right: 0.4rem; }

  .verdict { margin: 0; padding: 0.6rem 0 0; border-top: 1px solid var(--rule); max-width: 78ch; }
  .verdict-tag { display: inline-block; font-family: var(--data); font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.15rem 0.5rem; margin-right: 0.6rem; border: 1px solid currentColor; }
  .verdict-conforme .verdict-tag { color: var(--verified); }
  .verdict-à-discuter .verdict-tag { color: var(--ochre); }
  .verdict-non-annoté .verdict-tag { color: var(--rule-strong); }

  .split { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 2.5rem; align-items: start; }
  @media (max-width: 900px) { .split { grid-template-columns: 1fr; gap: 1.5rem; } }

  .plate { position: sticky; top: 1.5rem; }
  .plate figure { margin: 0; }
  .scan { width: 100%; height: auto; display: block; border: 1px solid var(--rule-strong); background: var(--surface); cursor: zoom-in; }
  figcaption { font-size: 0.8rem; color: var(--ink-muted); margin-top: 0.5rem; }

  .reading { display: flex; flex-direction: column; gap: 2rem; }
  .recipe { border-top: 1px solid var(--rule); padding-top: 1rem; }
  .recipe-title { font-family: var(--display); font-weight: 600; font-size: 1.3rem; letter-spacing: -0.015em; line-height: 1.15; margin: 0 0 0.4rem; text-wrap: balance; }
  .recipe-meta { display: flex; flex-wrap: wrap; gap: 0.9rem; margin: 0 0 1rem; font-size: 0.84rem; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
  .tag { color: var(--ochre); text-transform: uppercase; letter-spacing: 0.07em; font-size: 0.76rem; }
  .field-label { font-size: 0.73rem; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-muted); margin: 1rem 0 0.4rem; font-weight: 600; }

  .lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .lines-numbered { counter-reset: step; }
  .line { padding: 0.3rem 0 0.3rem 1.6rem; position: relative; }
  .lines-numbered .line { counter-increment: step; }
  .lines-numbered .line .line-text::before { content: counter(step) ". "; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
  .line::before { content: ""; position: absolute; left: 0; top: 0.72em; width: 0.5rem; border-top: 1px solid var(--rule-strong); }
  .line-text { display: block; }
  .line-note { display: block; margin-top: 0.2rem; font-size: 0.8rem; line-height: 1.4; }
  .is-fixed { background: #F1F5EF; }
  .is-fixed::before { border-top-color: var(--verified); border-top-width: 2px; }
  .is-fixed .line-note { color: var(--verified); }
  .is-minor { background: #FAF4EE; }
  .is-minor::before { border-top-color: var(--ochre); border-top-width: 2px; }
  .is-minor .line-note { color: var(--ochre); }

  .closing { border-top: 2px solid var(--ochre); margin-top: 3rem; padding-top: 1.5rem; }
  .closing p, .closing li { max-width: 70ch; }
  .closing ul { padding-left: 1.1rem; }
  .closing li { margin-bottom: 0.6rem; }
  code { font-family: var(--data); font-size: 0.9em; }
  a { color: var(--ochre); }
  :focus-visible { outline: 2px solid var(--ochre); outline-offset: 2px; }
</style>

<div class="shell">
  <header class="masthead">
    <p class="stamp">Spike T1 · gemini-3-flash-preview · google-ai-studio · prompt v2 · 2026-08-09</p>
    <h1>Sept pages, huit modèles, un seul qui tient</h1>
    <p>
      Toutes les extractions ci-dessous viennent de <code>gemini-3-flash-preview</code>. Les quatre
      dernières pages sortent de la réserve : le modèle ne les avait jamais vues, et je n'en connais
      pas le contenu. Photo à gauche, extraction à droite, chaque ligne notable marquée dans la marge.
    </p>
    <p>
      Aucune vérité terrain n'a été transcrite. Le jugement se fait à l'œil, et les pages F, G et H
      sont délibérément laissées sans annotation. Sept modèles moins chers ont été passés sur les
      mêmes sept pages ; le tableau plus bas dit ce qu'ils valent.
    </p>
  </header>

  <dl class="summary">
    <div class="cell"><dt>Passes réussies</dt><dd>14 / 14<small>7 pages × 2 passes</small></dd></div>
    <div class="cell"><dt>Pages instables</dt><dd>1 / 7<small>la page B, sur l'étiquette de section</small></dd></div>
    <div class="cell"><dt>Réparations de schéma</dt><dd>0<small>le schéma est respecté nativement</small></dd></div>
    <div class="cell"><dt>Latence</dt><dd>3,4 – 12,6 s<small>selon la densité</small></dd></div>
    <div class="cell"><dt>Concurrents écartés</dt><dd>7<small>aucun ne fait mieux</small></dd></div>
  </dl>

  <section class="compare">
    <h2>Ce que le changement de modèle a corrigé</h2>
    <div class="scroller">
      <table>
        <thead><tr><th>Sur les trois pages du protocole</th><th>gemini-2.5-flash-lite</th><th>gemini-3-flash-preview</th></tr></thead>
        <tbody>
          ${COMPARISON.map(([what, was, now], index) =>
            `<tr><td>${escape(what)}</td><td class="${index < 7 ? "was" : ""}">${escape(was)}</td><td class="${index < 7 ? "now" : ""}">${escape(now)}</td></tr>`,
          ).join("")}
        </tbody>
      </table>
    </div>
  </section>

  <section class="compare" id="concurrents">
    <h2>Les sept concurrents moins chers, sur les mêmes sept pages</h2>
    <p style="max-width:70ch;margin:0 0 1rem;">
      Deux passes par page, image et prompt identiques. La colonne qui décide n'est pas le prix :
      c'est le nombre de pages où les deux appels ne rendent pas la même chose.
    </p>
    <p style="max-width:70ch;margin:0 0 1rem;">
      Les deux dernières lignes portent une mesure que je retire : le harnais n'envoyait alors aucun
      contrôle de raisonnement, et ces modèles dépensaient leur budget de sortie à réfléchir avant
      d'écrire. Leurs échecs m'étaient imputables. Le modèle retenu était déjà arrêté, ils n'ont pas
      été rejugés.
    </p>
    <div class="scroller">
      <table>
        <thead><tr><th>Modèle</th><th>$ / appel</th><th>Latence</th><th>Échecs /14</th><th>Pages instables /7</th><th>Ce qui le disqualifie</th></tr></thead>
        <tbody>
          ${RIVALS.map((row) => {
            const [name, price, latency, failures, unstable, why, reference] = row;
            return `<tr${reference ? ' class="now"' : ""}>
              <td><code>${escape(name)}</code>${reference ? " <em>référence</em>" : ""}</td>
              <td>${escape(price)}</td><td>${escape(latency)}</td>
              <td class="${failures === "0" ? "" : "was"}">${escape(failures)}</td>
              <td class="${unstable === "0" || unstable === "1" ? "" : "was"}">${escape(unstable)}</td>
              <td>${escape(why)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </section>

  ${sections}

  <section class="closing">
    <h2>Ce que le spike a établi</h2>
    <ul>
      <li>
        <strong>Trier l'échelle par le prix a mené au mauvais endroit.</strong> Six barreaux écartés,
        un septième retenu qui produisait des quantités fausses, et la réponse se trouvait trois
        centimes plus haut. Numériser cinq cents pages coûte moins de quatre dollars : le prix devait
        être un garde-fou, pas un ordre de marche.
      </li>
      <li>
        <strong>Un défaut plausible coûte bien plus cher qu'un défaut visible.</strong> Une ligne
        oubliée se voit à la relecture ; <code>1 vingtaine</code> lu <code>1 vinaigre</code> passe, et
        la recette reste fausse pour toujours. C'est ce critère qui a disqualifié le modèle précédent.
      </li>
      <li>
        <strong><code>strict: true</code> n'est pas contraignant sur OpenRouter.</strong> Vérifié sur
        deux providers du même modèle, qui ont rendu une chaîne dans un champ déclaré numérique. La
        validation devra rester défensive à la réception.
      </li>
      <li>
        <strong>La repasse de correction rattrape les coquilles, jamais les mélectures.</strong> Elle
        ne voit pas la photo. Elle polit un bon résultat, elle ne sauve pas un mauvais modèle.
      </li>
      <li>
        <strong>Le discriminant réel est la stabilité entre deux appels identiques.</strong> Aucune
        fiche produit ne la publie, et elle ne se voit qu'en lançant deux passes sur la même image :
        quatre des sept concurrents rendent une extraction différente à chaque appel sans rien casser
        de visible. Sur 500 pages, tout l'écart de prix du tableau pèse 2,26 $ contre 0,21 $ — le prix
        n'avait pas à décider.
      </li>
      <li>
        <strong>Le débit compte plus que le prix au token.</strong> <code>qwen3.5-9b</code> était le
        moins cher de sa famille et tournait à 17 t/s : quinze minutes pour une page. Les deux
        grandeurs ne sont pas corrélées.
      </li>
      <li>
        <strong>Une page sans liste d'ingrédients déclenche un comportement non déclaré.</strong> Sur
        la page E, le modèle déduit les ingrédients de la prose — le prompt le lui interdit, et il le
        fait bien. Le risque est l'imprévisibilité : à déclarer explicitement.
      </li>
    </ul>
  </section>
</div>

<script>
  document.querySelectorAll(".scan").forEach((image) => {
    image.addEventListener("click", () => {
      const zoomed = image.style.maxWidth !== "none";
      image.closest(".plate").style.position = zoomed ? "static" : "sticky";
      image.style.maxWidth = zoomed ? "none" : "";
      image.style.width = zoomed ? "min(1600px, 92vw)" : "";
      image.style.cursor = zoomed ? "zoom-out" : "zoom-in";
    });
  });
</script>
`;

writeFileSync(`${ROOT}/spike/review-barreau-6.html`, html);
console.log("écrit, taille :", (html.length / 1024 / 1024).toFixed(2), "Mo");
