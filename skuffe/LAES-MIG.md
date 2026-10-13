# Skuffen på dit eget webhotel

Skuffen er de breve, du har sendt videre. Normalt bor den kun i den browser, du
sidder ved. Lægger du de fire filer her i mappen op på et webhotel med PHP og en
database, følger skuffen med dig: du logger ind med én adgangskode, og både breve
og svar kan hentes på en hvilken som helst computer.

Det er kun dig, der kan se den. Der er ingen oprettelse af brugere, ingen e-mail
og ingen deling — serveren kender ét menneske: dig.

## Hvad der skal op

Læg hele siden op, som den ligger — `index.html`, `app.js`, `style.css`,
`data.js` — og dertil denne mappe:

| fil | skal op | hvorfor |
| --- | --- | --- |
| `skuffe/api.php` | ja | selve lageret; det er den, siden taler med |
| `skuffe/opsaet.php` | ja, midlertidigt | bruges én gang til at sætte det hele op — **slet den bagefter** |
| `skuffe/skema.sql` | nej | kun hvis du hellere vil oprette tabellerne i phpMyAdmin |
| `skuffe/config.php.example` | nej | en skabelon; `opsaet.php` skriver selv `config.php` |

`skuffe/config.php` må **ikke** lægges nogen steder hen, hvor andre kan hente
den — den indeholder dit databasekodeord. Den står allerede i `.gitignore`.

## Sådan gør du

1. **Læg filerne op.** Brug webhotellets filhåndtering eller FTP. Siden skal
   ligge i samme mappe som `skuffe/`, ellers kan den ikke finde lageret.
2. **Lav en database** i webhotellets kontrolpanel (MySQL). Notér navn,
   brugernavn, kodeord og vært — det plejer at stå samme sted.
3. **Åbn `skuffe/opsaet.php` i browseren** (fx
   `https://ditdomæne.dk/skuffe/opsaet.php`). Den går tre trin igennem:
   - skriver forbindelsen (du indtaster oplysningerne fra trin 2),
   - opretter de tre tabeller,
   - og lader dig vælge en **adgangskode** på mindst otte tegn.
4. **Slet `opsaet.php` igen.** Den er brugt, og den skal ikke ligge fremme.
5. **Åbn siden** og tryk på `▤ skuffen`. Der står nu en lille linje under
   overskriften: *tast adgangskoden, så følger skuffen med til dine andre
   maskiner*. Skriv koden — og skuffen hentes ned på maskinen og lægges op fra
   den.

Bagefter er der ingen forskel at se på brevene selv. Det er stadig kun linket,
modtageren fik, der rejser rundt — serveren gemmer kortene og de linjer, der stod
på dem, så de kan vises ordret også på en maskine, der aldrig har set brevet før.

## Hvordan det opfører sig

- **Adgangskoden** gemmes som et hash (`password_verify`), aldrig i klartekst.
  Glemmer du den, kan den ikke læses frem — men den kan sættes på ny ved at køre
  `opsaet.php` igen.
- **Ventning mod gætteri:** ti forkerte forsøg fra samme adresse inden for et
  kvarter, og der svares *for mange forsøg* i et stykke tid.
- **Fremmede sider** kan ikke skrive i skuffen: kun forespørgsler fra siden selv
  (samme vært) slippes igennem. Det gælder både at gemme og at logge ind.
- **To maskiner på én gang:** hver skuffe har et versionsnummer. Er der gemt
  noget imens, får den anden maskine indholdet tilbage i stedet for at skrive
  oveni — skuffen lægges sammen og prøver én gang til. Er de samme breve sendt
  fra begge steder, bliver det ikke to kort: kortet følger den tråd, der er
  længst.
- **Uden backend** (fx på GitHub Pages, der ikke kan køre PHP) findes indlogningen
  ikke. Skuffen virker som før — i denne browser — og filen `gem som fil` /
  `læs fil` er stadig vejen mellem maskiner.
- **Kun dig.** Alle svarene er private og må ikke lægges i cache; der er ingen
  delte skuffer og ingen andres breve.

## Hvis noget ikke virker

- *»skuffen er ikke sat op på serveren endnu«* — `opsaet.php` er ikke kørt, eller
  `config.php` ligger ikke ved siden af `api.php`.
- *»kunne ikke få fat i databasen«* — oplysningerne fra panelet passer ikke, eller
  databasen er ikke oprettet. Fejlen skrives i webhotellets fejllog.
- *»du er ikke logget ind længere«* — sessionen er udløbet (et halvt år). Tast
  koden igen; skuffen ligger stadig i browseren imens.
- Der kommer intet ned på den anden maskine — tjek at du faktisk er logget ind
  der; indlogningen er per browser, ikke per brev.

## Krav

PHP 7.4 eller nyere med `pdo_mysql` (og `mbstring`, hvis den findes) samt en
MySQL-database. Vil du hellere slippe for at oprette noget i panelet, kan
`opsaet.php` sætte `driver` til `sqlite` i stedet — det bruges til at prøve det af
lokalt, men på et webhotel er MySQL det rigtige valg.
