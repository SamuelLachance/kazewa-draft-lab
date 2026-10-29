import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
const corpus = path.resolve(app, "..");
const read = async (relative) => readFile(path.join(corpus, relative), "utf8");
const specifications = [
  [
    "frontline_missing",
    "Absence de frontline fonctionnelle",
    "frontline",
    3,
    ["tank_absent"],
    ["2p0DCiayuz8", "ISAb1T_ORUU"],
  ],
  [
    "dps_missing",
    "Absence de dégâts soutenus",
    "damage",
    3,
    ["dps_absent", "sans_dps_soutenu"],
    [],
  ],
  [
    "burst_into_tanks",
    "Le burst ne traverse pas le bloc de tanks",
    "damage",
    3,
    [],
    ["2DVB7PhKaSA", "xscoqh9K05I"],
  ],
  [
    "tank_without_dps",
    "La frontline manque de DPS à protéger",
    "damage",
    2,
    ["tank_plus_dps_soutenu"],
    [],
  ],
  [
    "immobile_into_catch",
    "Accumulation de cibles immobiles face au catch",
    "reach",
    3,
    ["immobiles_vs_catcheur", "immobiles_x2_vs_catch"],
    [],
  ],
  [
    "isolated_catcher",
    "Un catcheur isolé sans relais",
    "identity",
    1,
    [],
    ["-B3b80GYtDM", "7gvPKJVPDy0", "GnJPSjKmRrM"],
  ],
  [
    "savers_against_catch",
    "Des gardiens pour absorber le catch",
    "protection",
    1.5,
    [],
    ["EirFDpT6E5Q", "S7aorVJ4wQQ", "8Z_PXnrLbiM"],
  ],
  [
    "disengage_against_engage",
    "Un bloc de disengage face à un plan all-in",
    "protection",
    2,
    [],
    ["G_DBTj3PDUI", "EirFDpT6E5Q", "2DVB7PhKaSA"],
  ],
  [
    "poke_without_peel",
    "Le poke manque de protection et de recul",
    "identity",
    2,
    [],
    ["urI4eASNSNc", "1VlERsENAR8"],
  ],
  [
    "carry_without_peel",
    "Un carry scaling sans protection alliée",
    "protection",
    2,
    ["adc_sans_peel", "jinx_support_cover"],
    [],
  ],
  [
    "followup_missing",
    "Une initiation sans relais de contrôle",
    "identity",
    1.5,
    [
      "jarvan_sans_follow_up",
      "nocturne_sans_follow_up",
      "kennen_engage_jungle",
    ],
    ["cSQP5oImnRo", "cXnjfe8aBxA"],
  ],
  [
    "early_timer",
    "Le plan early doit créer une avance pour finir",
    "tempo",
    1.5,
    [],
    ["76u-ZX7VoTU", "XQYZMHTJTPE", "NKYY2NzHBnw"],
  ],
  [
    "scaling_without_bridge",
    "Plusieurs scalers sans pont early-mid",
    "tempo",
    2,
    [],
    ["aBZbd1OxPI8", "ZxGZIIO91Tk", "yUuo2k7YLwI"],
  ],
  [
    "protected_scaling",
    "Un scaling soutenu par frontline et protection",
    "tempo",
    1.5,
    [],
    ["G9qKZ7TRf9I", "UaKcH6eYbpQ", "JZecUmvga3M"],
  ],
  [
    "global_against_split",
    "Un ultime global pour punir la side lane",
    "macro",
    1.5,
    ["global_ult_vs_carry_1v1", "yorick_vs_double_locker"],
    [],
  ],
  [
    "unanswered_globals",
    "Double pression globale sans réponse globale",
    "macro",
    1,
    ["double_global_ult"],
    [],
  ],
  [
    "anti_dash",
    "Poppy répond aux dashs répétés",
    "terrain",
    2,
    ["poppy_anti_dash"],
    [],
  ],
  [
    "objective_plan",
    "Tank, DPS et terrain pour préparer les objectifs",
    "macro",
    1.5,
    ["tank_plus_dps_soutenu"],
    ["ObEvK-hR9bs", "2DVB7PhKaSA", "91R-kQSi4_U"],
  ],
  [
    "coherent_block",
    "Un bloc frontline-DPS-disengage complet",
    "identity",
    1.5,
    [],
    ["jfVT0Qguz7E"],
  ],
  [
    "named_synergy",
    "Une synergie de champions documentée",
    "synergy",
    2,
    [
      "azir_maokai",
      "yasuo_knockup_combo",
      "sion_jinx",
      "triple_cc_catch",
      "kalista_renata",
      "camille_galio",
      "azir_xayah_socle",
      "kalista_azir",
      "xin_brand_zac_karma",
      "viego_resets",
    ],
    ["pxAtXqWFf5Y", "XaSxxhFVAZQ", "1aNsp7bWHVA", "wBOLqxRxObg"],
  ],
  [
    "isolated_partner",
    "Un champion privé du partenaire de son plan",
    "identity",
    1,
    [],
    ["2QkQYFPQF48", "5JppK7MCE30", "ZaCo3Wutcj8"],
  ],
  [
    "terrain_against_commit",
    "Le contrôle de terrain reçoit une compo qui entre",
    "terrain",
    1.5,
    ["zone_control_stack", "zone_control_vs_immobiles"],
    ["Y2ezLdCXtO4"],
  ],
  [
    "split_global_plan",
    "Une side lane soutenue par des ultimes globaux",
    "macro",
    1,
    ["tf_familles"],
    ["RQPcizPRQJA", "EirFDpT6E5Q"],
  ],
  [
    "sylas_ultimates",
    "Sylas dispose de plusieurs ultimes de grande valeur",
    "synergy",
    1.5,
    ["silas_ults_volables"],
    [],
  ],
  [
    "xayah_ezreal_lane",
    "La réponse Ezreal ne neutralise pas Xayah en lane",
    "lane",
    1,
    ["xayah_vs_ezreal"],
    [],
  ],
  [
    "triple_catch_no_saver",
    "Triple catch sans gardien face à Nocturne",
    "reach",
    2,
    ["triple_catch_sans_peel_vs_global"],
    [],
  ],
  [
    "named_antisynergy",
    "Des partenaires poursuivent des plans incompatibles",
    "identity",
    1.5,
    [
      "conflit_engage_courte_vs_poke_longue",
      "carries_portees_opposees",
      "longue_portee_courte_portee_sans_pont",
    ],
    ["t3vNRW8DMDc", "pxAtXqWFf5Y", "5zOvsTP_BWU", "p5YA0gyY0b0", "cSQP5oImnRo"],
  ],
  [
    "named_lane_counter",
    "Un matchup de lane documenté",
    "lane",
    1.25,
    [
      "lux_vs_mid_statique",
      "contres_azir",
      "azir_contres_mid",
      "azir_contre_ranged",
      "orianna_contres",
      "contres_gnar",
      "gnar_matchups",
      "cassio_contree_true_dmg",
      "galio_vs_rumble",
      "contres_tf_top",
      "shen_vs_auto_attaque",
      "nasus_matchups",
    ],
    [],
  ],
  [
    "anti_tank_damage",
    "Des dégâts anti-tanks répondent à la frontline",
    "damage",
    1.5,
    [
      "anti_tank_nommes",
      "anti_tanks_nommes",
      "trundle_vs_tanks",
      "trundle_anti_tank_immobile",
    ],
    [],
  ],
  [
    "double_tank_limited_damage",
    "Plusieurs tanks concentrent les dégâts sur trop peu de carries",
    "damage",
    1.5,
    [
      "double_tank_sans_degats",
      "trois_tanks_un_carry",
      "sur_tanke",
      "dps_concentre_un_carry",
    ],
    [],
  ],
  [
    "catch_against_mobile",
    "Le catch committal manque de cibles accessibles",
    "reach",
    1.5,
    ["nocturne_vs_dashs"],
    ["o5PX9BO6Lh4", "zn2EpFiCFwI", "XZYVApZ2_Ts"],
  ],
  [
    "carry_reach",
    "Un accès fiable à un carry peu protégé",
    "reach",
    1.5,
    [
      "jarvan_vs_carry_immobile",
      "carry_range_immobile_vs_dashs",
      "lockers_vs_hypercarry",
      "smolder_vs_hard_cc",
    ],
    [],
  ],
  [
    "hypercarry_no_answer",
    "Le carry protégé manque de réponse adverse",
    "protection",
    1.5,
    [
      "hypercarry_stack_sans_reponse",
      "pas_d_engage_vs_hypercarry",
      "carry_protege_sans_range_ni_zoning",
    ],
    [],
  ],
  [
    "multi_winconditions",
    "Plusieurs voies de victoire indépendantes",
    "grid",
    1,
    ["couverture_win_conditions", "plan_teamfight_coherent"],
    ["xlFlfJFdXk8", "u73_c_7OQIg"],
  ],
  [
    "grid_scaling",
    "Avantage comparatif de scaling utilisable",
    "grid",
    1.25,
    [
      "sans_scaling_vs_scaling",
      "hypercarry_scaling_protege",
      "scaling_accepte_early",
    ],
    [],
  ],
  [
    "grid_teamfight",
    "Avantage comparatif du bloc de teamfight",
    "grid",
    1,
    ["tank_plus_dps_soutenu", "plan_teamfight_coherent"],
    [],
  ],
  [
    "grid_objectives",
    "Avantage comparatif du setup d’objectifs",
    "grid",
    0.75,
    ["compo_nashor", "solo_objectif_dps"],
    [],
  ],
  [
    "grid_range",
    "La portée adverse manque de réponse de fermeture",
    "grid",
    1,
    ["sans_range_vs_range", "longue_portee_vs_courte_sans_front"],
    [],
  ],
  [
    "grid_side",
    "Une menace de side lane sans réponse globale",
    "grid",
    0.75,
    ["split_131_vs_sans_global", "jax_split_sans_reponse"],
    [],
  ],
  [
    "no_proactivity",
    "Pas d’outil fiable pour convertir la pression",
    "identity",
    1,
    ["aucun_catcheur", "enchanteur_sans_engage", "catch_reactif_sans_pression"],
    [],
  ],
  [
    "named_context_counter",
    "Un contre de composition documenté",
    "terrain",
    1.25,
    [
      "contres_xayah",
      "xayah_vs_displacement",
      "nocturne_contres",
      "trundle_vs_immobiles_poke_kalista",
      "jax_perd_vs_mages",
      "braum_vs_melee",
      "braum_vs_engage_fiable",
      "zac_vs_immobiles_ranged",
      "zeri_mobile_carry_vs_triple_cc",
    ],
    [],
  ],
  [
    "early_bot_support",
    "Le carry bot early manque d’un support adapté",
    "identity",
    1,
    ["kalista_sans_engage", "adc_engage_avec_enchanteur"],
    [],
  ],
];

const allRules = JSON.parse(await read("draft_rules_final.json"));
const rules = specifications.map(
  ([id, title, family, weight, sourceRuleIds, extra]) => {
    const originals = allRules.filter(
      (r) => sourceRuleIds.includes(r.id) && r.meta === null,
    );
    return {
      id,
      title,
      family,
      weight,
      sources: [
        ...new Set([...extra, ...originals.flatMap((r) => r.sources ?? [])]),
      ].sort(),
      sourceRuleIds,
      provenance:
        "Traduction opérationnelle du corpus ; seuils et poids heuristiques, non énoncés par Kazewa.",
      sourceFiles: [
        "kb/KAZEWA_METHOD.md",
        ...new Set(
          originals.length ? ["draft_rules_final.json"] : ["taxo/def_*.md"],
        ),
      ],
    };
  },
);
const knownIssues = {
  Gangplank: [
    "Le profil source indique dashs=1 et immobile=0 : valeur de kit suspecte, conservée pour audit.",
  ],
  Azir: [
    "Le corpus le classe immobile malgré un dash de kit ; jugement Kazewa conservé, dépendant du contexte.",
  ],
  Poppy: [
    "Frontline et engage varient selon équipement et partenaires dans les sources.",
  ],
  Nautilus: [
    "Le rôle support ne remplace pas nécessairement une vraie frontline ; le profil source est contextuel.",
  ],
  Rakan: [
    "Catch, engage et follow-up varient entre vidéos ; son profil ne vaut pas un tank pur.",
  ],
  Cassiopeia: [
    "DPS et burst sont décrits différemment selon les vidéos et les builds.",
  ],
  Zeri: ["Le corpus hésite entre DPS soutenu et semi-DPS/burst."],
  Trundle: ["Le statut frontline et scaling varie entre vidéos."],
  Locke: [
    "Profil local à vérifier contre le roster officiel et le patch du fournisseur live.",
  ],
};
const files = (await readdir(path.join(corpus, "taxo")))
  .filter((f) => /^class_\d+\.json$/.test(f))
  .sort();
const champions = {};
const hashes = {};
for (const filename of files) {
  const relative = "taxo/" + filename;
  const raw = await read(relative);
  hashes[relative] = createHash("sha256").update(raw).digest("hex");
  for (const champion of JSON.parse(raw)) {
    if (champions[champion.champion])
      throw new Error("Profil dupliqué : " + champion.champion);
    champions[champion.champion] = {
      ...champion,
      _provenance: {
        file: relative,
        sources: [
          ...new Set(
            (champion.note ?? "").match(/(?<![\w-])[\w-]{11}(?![\w-])/g) ?? [],
          ),
        ].sort(),
        warnings: knownIssues[champion.champion] ?? [],
      },
    };
  }
}
const ordered = Object.fromEntries(
  Object.entries(champions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
hashes["kb/KAZEWA_METHOD.md"] = createHash("sha256")
  .update(await read("kb/KAZEWA_METHOD.md"))
  .digest("hex");
const knowledge = {
  version: "1.1.0",
  champions: ordered,
  rules,
  method: {
    name: "Lecture structurelle Kazewa",
    description:
      "Identité, frontline, dégâts, accès aux carries, protection, tempo et objectifs, à partir des dix champions et de leurs rôles.",
    sourceFiles: [...Object.keys(hashes), "draft_rules_final.json"],
    hashes,
    sourceNoteCount: (await readdir(path.join(corpus, "notes"))).filter((f) =>
      f.endsWith(".md"),
    ).length,
    championCount: Object.keys(ordered).length,
    ruleCount: rules.length,
    weights:
      "Heuristiques figées ; non calibrées sur des résultats de matchs. Révision 1.1 guidée par les définitions, profils et règles du corpus sans ajustement aux labels du benchmark.",
    operationalContext:
      "Les profils originaux sont conservés. Les résumés tiennent compte du rôle, du DPS de niveau 1, des faux immobiles, des gardiens et des combos nommés ; les seuils restent des choix d’implémentation.",
    excludedFeatures: [
      "identité des équipes",
      "niveau des joueurs",
      "résultat",
      "gold",
      "items",
      "événements en jeu",
      "bans",
      "ordre des picks",
      "patch comme variable prédictive",
    ],
    limits: [
      "Les profils héritent des erreurs et contradictions du corpus.",
      "Les lanes sont limitées aux matchups nommés ; dégâts AD/AP, portée exacte et méta actuelle ne sont pas modélisés.",
      "Une marge de score ne représente pas une probabilité de victoire.",
      "La fidélité aux jugements et la prédiction du résultat sont deux mesures distinctes.",
    ],
  },
};
await mkdir(path.join(app, "data"), { recursive: true });
await writeFile(
  path.join(app, "data", "knowledge.json"),
  JSON.stringify(knowledge, null, 2) + "\n",
);
await writeFile(
  path.join(app, "data", "rules.json"),
  JSON.stringify(rules, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    champions: Object.keys(ordered).length,
    rules: rules.length,
    sourceNotes: knowledge.method.sourceNoteCount,
  }),
);
