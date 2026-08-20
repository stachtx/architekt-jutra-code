# Wynik: fit-positive.md — Contract Service

## Archetype Fit Assessment: ✅ Fits

Core question: agent bywa też klientem (dwie role, jedna Party, req. 18), widoczność wynika z
trawersji grafu relacji (agencja sprzedająca → hierarchia poddrzewa → sesja obsługi), nie z
pojedynczego pola na rekordzie. Sygnały: rola qualified by counterparty ("agent *swojej* agencji"),
hierarchia z czymś płynącym (widoczność, req. 8), acting-on-behalf (sesja, req. 9), tożsamość
rozproszona (numer agenta, krajowy ID, nr rejestracyjny firmy, req. 16-17).

## Party Domain

Uczestnicy: klienci (osoba/firma), agenci (osoby), agencje (organizacje, hierarchia). Kontrakt nie
jest party — to rekord, do którego party się odnoszą.

**Poziom złożoności: 9.** Unified party (req. 2) + relational roles (req. 7) + hierarchia z rollupem
widoczności (req. 8) + temporal/historyczna rekonstrukcja (req. 3, 15, S5) + acting-on-behalf sesyjne
z rozdziałem actor/subject w audycie (req. 9, 20-21) + struktura agencji własność zewnętrzna Agency
Service (req. 13).

## Rozstrzygnięcia biznesowe (AskUserQuestion)

| Pytanie | Odpowiedź |
|---|---|
| Transytywność hierarchii agencji (req. 8) | Całe poddrzewo |
| Reorganizacja (req. 15, S5) | Kontrakty historyczne podążają za nową strukturą (live traversal) |
| Zakres sesji agenta (open question 3) | Dokładnie widok klienta, bez nadzbioru adnotacji |
| Audyt po odejściu agenta (open question 5) | PartyId trwały, w pełni przypisywalny przez okres retencji |

Nierozstrzygnięte celowo: czy sesję wolno otworzyć bez obecności klienta (open question 4) — to
reguła proceduralna compliance, nie fakt grafu party.

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|---|---|---|
| Klient (osoba) | Party (Person) | Bez konta możliwy (req. 19) |
| Klient (firma) | Party (Organization) | Te same warunki co osoba |
| Agent | Party (Person) + PartyRole na relacji zatrudnienia | NIE osobny PartyType — req. 18 |
| Agencja | Party (Organization) | Referencjonowana z Agency Service |
| Rodzic-dziecko agencji | Hierarchy, parent-of | Transitywna, całe poddrzewo |
| Agent w agencji | PartyRelationship employs (Agency→AGENT) | Temporalna |
| Kontrakt trzymany | PartyRole HOLDER | Kontrakt nie jest Party |
| Kontrakt sprzedany | PartyRole SELLER | Niezmienny fakt historyczny (req. 4) |
| Sesja obsługi | Authority, czasowa, actor≠subject | Poziom 8 |
| Numer agenta | PartyIdentifier, authority=Agency Service | Reużywalny, nie klucz łączący |
| Krajowy ID/paszport/nr rejestracyjny firmy | PartyIdentifier, authority=rejestr państwowy | Stabilny |
| Customer ID | PartyIdentifier, authority=ten serwis | Wewnętrzny |
| Agent=klient | Dwie role, jedna Party | Powód porażki `user.type` |

## Unmapped Concepts

- Status/ważność kontraktu (req. 3): maszyna stanów, poza modelem
- Produkt ubezpieczeniowy: katalog, poza zakresem
- `mayView` konkretnej sesji: warstwa polityki
- Otwarcie sesji bez klienta (open question 4): procedura compliance, nie struktura party

## Parties & Types

| Party | PartyType | Bez konta | Notes |
|---|---|---|---|
| Klient (osoba) | Person | Tak | Sprzedaż może poprzedzać rejestrację |
| Klient (firma) | Organization | Tak | Większość nigdy się nie rejestruje |
| Agent | Person | Nie | Zawsze konto |
| Agencja | Organization | Tak | Nigdy się nie loguje |

## Roles & Relationships

```
Agencja nadrzędna ──parent-of──> Agencja podrzędna ──employs(AGENT)──> Agent
      │ widoczność w dół (poddrzewo)   │ sold-by(SELLER)                │ acts-on-behalf-of
      └─────────────────────────────────┴──> Kontrakt <──────────────────┘ (sesja)
                                              │ held-by(HOLDER)
                                              v
                                        Klient (Person|Organization)
```

| Relationship | From | To | Cardinality | Temporal | Derives |
|---|---|---|---|---|---|
| employs | Agencja(EMPLOYER) | Agent(AGENT) | 1:N | Tak | Zasięg strukturalny |
| parent-of | Agencja(PARENT) | Agencja(CHILD) | 1:N | Tak | Rollup widoczności |
| sold-by | Kontrakt | Agencja(SELLER) | N:1 | Nie, stałe | Widoczność strukturalna |
| held-by | Kontrakt | Party(HOLDER) | N:1 | Nie | Widoczność własna |
| acts-on-behalf-of | Agent(ACTOR) | Party(SUBJECT) | N:M | Tak, sesyjna | Widoczność delegowana |

## Hierarchy & Traversal

| Hierarchy | Types | Transitive | Depth bound | Wielu rodziców | Cycle policy |
|---|---|---|---|---|---|
| Drzewo agencji | Organization | **(A)** tak, poddrzewo | Brak **(X)** | **(X)** nie założono | Odrzucany, Agency Service |

`descendantsOf(agencyId, asOf, maxDepth=null) → Set<AgencyId>` — `asOf` obecne, wymóg poziomu 7 (S5).

## Temporal Validity

| Relationship | Overlap | Backdating | Termination | Notes |
|---|---|---|---|---|
| employs | Odrzucany | **(X)** admin only | Zamknięcie `validTo` | Kontrakty zostają przy sprzedającej agencji, nie przy agencie (req. 12) |
| parent-of | Odrzucany | Nie dotyczy | Zamknięcie + nowa wersja | Cache z Agency Service |
| acts-on-behalf-of | Dozwolony między różnymi stronami | Nigdy | Koniec sesji/timeout | Krótkotrwała |

**Reorganizacja (A)**: widoczność **live** z aktualnej hierarchii. Sopot (S5) po przeniesieniu do
regionu Północnego "ciągnie" swoje historyczne kontrakty za sobą pod nowego rodzica.

## Visibility Rules

```
Kontrakt R widoczny dla V, gdy:
  R.holderPartyId == V
  OR R.sellingAgencyId ∈ descendantsOf(V.agencyId, asOf) ∪ {V.agencyId}
  OR ∃ aktywna sesja S: S.actor == V AND S.subject == R.holderPartyId
```

Sesja (A): agent widzi **dokładnie** to, co klient — bez nadzbioru adnotacji.

**Out of scope**: czy sesję *wolno* otworzyć bez klienta (compliance), kanał, zgoda, status
kontraktu — warstwa polityki nad tą trawersją.

## Identifiers & External Boundaries

| Identifier | Authority | Uniqueness | Stable | Join key |
|---|---|---|---|---|
| Customer ID | Ten serwis | Globalna | Tak | Tak, wewnętrznie |
| Numer agenta | Agency Service | Per authority | Nie, reużywany | Nie |
| Krajowy ID / paszport | Rejestr państwowy | Globalna | Tak | Nie |
| Nr rejestracyjny firmy | Rejestr państwowy | Globalna | Tak | Nie |

**Agency Service boundary**: referencja, nie kopia. Staleness tolerance **(X)** nie podana — SLA
Agency Service 99.5% vs cel serwisu 99.9% wymusza decyzję. Niedostępność: **fail closed**, bo
nieaktualne łącze rodzic-dziecko ujawnia cudze kontrakty.

## Implementation Notes

- Poziom 9: zewnętrzna własność struktury + delegacja sesyjna + rozdział actor/subject; osobno każde
  dałoby poziom 8.
- Agent = rola na relacji, nie PartyType — req. 18 czyni `user.type` niedziałającym od startu.
- Kontrakt nie jest Party — powiązany, nie kontrpartner.
- Transytywność=poddrzewo (A), reorganizacja=live (A), sesja=widok klienta bez nadzbioru (A),
  audyt PartyId trwały po odejściu (A) — rozstrzygają dokładnie open questions 1, 2, 3, 5 z sekcji 7
  dokumentu.
- Audyt: `actorPartyId`/`subjectPartyId` rozdzielone od dnia zero (req. 20) — niemożliwe do dorobienia
  po fakcie.
- **(X)** brak wielu rodziców — do potwierdzenia, struktury macierzowe nieobecne w wymaganiach.
- **(X)** backdating `employs` tylko admin — do potwierdzenia.
- **(X)** staleness tolerance cache Agency Service nie podana — musi być ustalona przed implementacją.
