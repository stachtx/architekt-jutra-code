# Wynik: fit-negative.md — Contract Renewal Service

## Archetype Fit Assessment: ❌ Does Not Fit

Party archetype modeluje encje, których role i uprawnienia wynikają z relacji. Ten domain to
**maszyna stanów + accounting ledger**, bo:

- Rdzeń logiki biznesowej to dozwolone przejścia między nazwanymi stanami
  (NOT_DUE → DUE → OFFER_ISSUED → …), req. 1-3 — sygnał ❌ "hard part is which transitions between
  named states are legal".
- Outstanding balance z booking/drawdown/write-off historią (req. 7-12) — sygnał ❌ "quantity
  accumulates, is drawn down, and must be audited" = accounting-archetype-mapper.
- Role są globalne, płaskie, przypisane raz przy tworzeniu konta, niezależne od kontraktu/agencji
  (req. 13) — sygnał ❌ "closed global list fixed at account creation" = RBAC, nie ten archetyp.
- Hierarchia agencji istnieje, ale req. 19 wprost mówi: "No renewal rule depends on the agency, its
  parent, or the agent" — drzewo służy tylko do dropdowna i raportów, nic z niego nie jest derived.
  Sygnał ⚠️ "hierarchy only renders a tree in the UI" → zero.
- Widoczność UNDER_LEGAL_REVIEW (req. 16) to filtr po fladze rekordu + globalnej roli, nie trawersja
  grafu relacji.

Naturalne pytanie to "**w jakim stanie jest ten kontrakt**" i "**ile wynosi saldo**", nie "kto jest
powiązany z kim i co z tego wynika". Party jest tu peryferyjny (customerId/agencyId to skopiowane
referencje przy rejestracji, req. 18) — nie rdzeń problemu.

## Wynik kalibracji skilla

Oba fixture'y zachowały się zgodnie z `expected:` z frontmatter:

| Fixture | Expected | Wynik |
|---|---|---|
| fit-positive.md | fit test passes | ✅ Pass |
| fit-negative.md | fit test rejects | ❌ Reject |

Granica fit testu w SKILL.md (sygnał tabela, sekcja "When NOT to Use") nie wymaga korekty — poprawnie
odróżnia domenę party (Contract Service) od maszyny stanów + ledgera (Contract Renewal Service).
