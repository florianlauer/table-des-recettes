# Vérité terrain d'acceptation

Après le gel du prompt et l'ingestion de D, créez `d-acceptation.json` au chronomètre. Ne transcrivez
que l'ensemble d'identité ci-dessous ; `quantity`, `unit` et `label` sont volontairement absents.

```json
{
  "recipes": [
    {
      "title": "<titre transcrit>",
      "type": "<entree|plat|dessert|apero|petitDej|autre>",
      "servings": 4,
      "ingredients": [
        { "raw": "<ligne complète, dans l'ordre>" }
      ],
      "steps": ["<étape complète, dans l'ordre>"]
    }
  ]
}
```

Notez `T_saisie` dans `spike/RESULTS.md`. Si le prompt est réécrit ou si un candidat échoue,
cette page est brûlée pour le chronomètre : créez une page fraîche D′, E, F… au moment requis.
