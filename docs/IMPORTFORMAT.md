# Manuell import

Brukes når en kilde ikke har API, eller for å laste inn lagrede API-svar. Kjør fra kommandolinjen (`npm run import:file -- fil.json`) eller last opp i **Admin → Importer**.

Importerte kunngjøringer får kilden «Manuell import». Samme `id` en gang til oppdaterer kunngjøringen i stedet for å lage en ny. Rader med feil hoppes over og vises med årsak.

**Importer aldri oppdiktede data.** Alt som importeres vises for kundene som ekte kunngjøringer.

## Format 1: JSON (AnbudRadar)

En liste med objekter (eller ett objekt):

```json
[
  {
    "id": "KOMMUNE-2026-014",
    "title": "Vakthold ved rådhuset",
    "description": "Stasjonært vakthold og resepsjon …",
    "buyer_name": "Eksempel kommune",
    "buyer_org_number": "123456789",
    "country": "NO",
    "nuts": ["NO060"],
    "place": "Trondheim",
    "cpv": ["79713000", "79710000"],
    "contract_type": "services",
    "procedure_type": "open",
    "estimated_value": 4200000,
    "currency": "NOK",
    "published_at": "2026-10-29",
    "deadline_at": "2026-11-24T12:00",
    "status": "competition",
    "source_url": "https://…",
    "documents_url": "https://…",
    "awards": [
      { "supplier_name": "Leverandør AS", "supplier_org_number": "987654321", "value": 4100000, "currency": "NOK", "award_date": "2026-12-15" }
    ]
  }
]
```

| Felt | Påkrevd | Merknad |
| --- | --- | --- |
| `id` | ja | Unik og stabil ID hos kilden |
| `title` | ja | |
| `status` | nei | `planned`, `competition` (standard), `awarded`, `cancelled`, `direct_award` |
| `deadline_at` | nei | `ÅÅÅÅ-MM-DD` (tolkes som slutten av dagen, klokkeslett ukjent) eller `ÅÅÅÅ-MM-DDTtt:mm` (norsk tid hvis tidssone mangler) |
| `cpv` | nei | Liste eller tekst skilt med komma/semikolon. Kontrollsiffer (`-7`) fjernes. Gir bransje automatisk. |
| `nuts` | nei | NUTS-koder (2021). Gir fylke automatisk for Norge. |
| `buyer_org_number` | nei | Norske numre kontrolleres (MOD11) – ugyldige forkastes |
| `contract_type` | nei | `works`, `supplies`, `services` |
| `estimated_value` | nei | Tall. Valuta standard NOK |
| `awards` | nei | Bare i JSON. Brukes i konkurrentinnsikt |

## Format 2: CSV

Første rad er kolonnenavn (samme navn som JSON-feltene, unntatt `awards`). Komma eller semikolon som skilletegn, anførselstegn rundt felt med skilletegn eller linjeskift. Tomme celler betyr «ikke oppgitt». Lister (CPV, NUTS) skilles med `|` eller `;` inne i cellen når kommaet er skilletegn.

```csv
id;title;buyer_name;cpv;nuts;estimated_value;deadline_at;status
KOMMUNE-2026-014;Vakthold ved rådhuset;Eksempel kommune;79713000|79710000;NO060;4200000;2026-11-24T12:00;competition
```

## Format 3: lagrede API-svar

- TED: JSON-svaret fra søke-API-et (`{ "notices": [...] }`) – kilden blir «TED».
- Doffin: JSON-svaret fra det offentlige søke-API-et (`{ "hits": [...] }`) – kilden blir «Doffin».

Formatet gjenkjennes automatisk.
