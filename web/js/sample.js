/** A trimmed sample of the second JSON the user shared, for the "Load sample" button. */
export const SAMPLE_JSON = `{
  "covenant": "Cairn-born, Faithful of the First Grandlich",
  "totalObols": 300,
  "manaPool": { "bone": 3, "blood": 0, "plasm": 0 },
  "gathering": [
    { "modelName": "Brenna",
      "profile": { "name": "Revenant", "affinity": "Bone", "keywords": ["Leader"],
        "hp": 17, "mana": 3, "startingAdditionalSpells": 1, "actionPoints": 2,
        "move": 3, "violence": 4, "ranged": 7, "obols": 0,
        "special": [
          {"name": "Ancient Skill", "effect": "On unmodified 10 the dice is a critical hit; criticals do +1 damage."},
          {"name": "Fighter", "effect": "Max 4 spells (incl. Summon) and 4 mana points."}
        ]
      },
      "traits": [
        {"name": "Osseous Sacrifice", "source": "Cairn-born Leader Trait"},
        {"name": "Combatant", "source": "Basic Leader Trait"}
      ],
      "spells":  [ {"name": "Summon"}, {"name": "Puppet"} ],
      "weapons": [ {"name": "Blade", "handed": 1} ],
      "armour":  [ {"name": "Light Armour", "armour": 1} ]
    },
    { "modelName": "Old Hollow",
      "profile": { "name": "Skeletal Husk", "affinity": "Bone", "keywords": ["Husk"],
        "hp": 10, "actionPoints": 2, "move": 3, "violence": 6, "ranged": 7, "obols": 50 },
      "weapons": [ {"name": "Light Polearm", "handed": 1} ]
    },
    { "modelName": "Mournful Vaulter",
      "profile": { "name": "Necromantic Remnant", "affinity": "Bone", "keywords": ["Husk","Remnant"],
        "hp": 6, "actionPoints": 2, "move": 3, "violence": 9, "ranged": 9, "obols": 35 },
      "weapons": [ {"name": "Blade", "handed": 1} ],
      "armour":  [ {"name": "Shield", "armour": 1} ],
      "miscEquipment": [ {"name": "Wardart"} ]
    }
  ]
}`;
