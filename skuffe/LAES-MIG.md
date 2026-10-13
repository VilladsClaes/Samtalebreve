# Skuffen på dit eget webhotel

Skuffen er de breve, du har sendt videre. Normalt bor den kun i den browser, du
sidder ved. Lægger du de fire filer her i mappen op på et webhotel med PHP og en
database, følger skuffen med dig: du logger ind med én adgangskode, og både breve
og svar kan hentes på en hvilken som helst computer.

Det er kun dig, der kan se den. Der er ingen oprettelse af brugere, ingen e-mail
og ingen deling — serveren kender ét menneske: dig.

## Hvad der skal op (til `breve.villadsclaes.dk`)

Læg hele siden op, som den ligger — `index.html`, `app.js`, `style.css`,
`data.js` — og dertil denne mappe:

| fil | skal op | hvorfor |
| --- | --- | --- |
| `skuffe/api.php` | ja | selve lageret; det er den, siden taler med |
| `skuffe/.htaccess` | ja | lukker for at hente `config.php` direkte (virker kun på Apache) |
| `skuffe/opsaet.php` | ja, midlertidigt | bruges én gang til at sætte det hele op — **slet den bagefter** |
| `skuffe/skema.sql` | nej | kun hvis du hellere vil oprette tabellerne i phpMyAdmin |
| `skuffe/config.php.example` | nej | en skabelon; `opsaet.php` skriver selv `config.php` |

`skuffe/config.php` må **ikke** lægges nogen steder hen, hvor andre kan hente
den — den indeholder dit databasekodeord. Den står allerede i `.gitignore`, og
`opsaet.php` skriver den selv på serveren, så den behøver ikke være med i det, du
lægger op.

Klar-til-upload-pakken ligger som `breve-villadsclaes.dk.zip` i din
Downloads-mappe (og udpakket ved siden af): den indeholder præcis de filer, der
skal op, og intet andet.

## Sådan gør du

1. **Læg filerne op.** Brug webhotellets filhåndtering eller FTP. Siden skal
   ligge i samme mappe som `skuffe/`, ellers kan den ikke finde lageret. Er der
   en filhåndtering med »udpak arkiv«, kan zip-filen lægges ind i selve
   webmappen og pakkes ud der.
2. **Lav en database** i webhotellets kontrolpanel (MySQL). Notér navn,
   brugernavn, kodeord og vært — det plejer at stå samme sted.
3. **Åbn `skuffe/opsaet.php` i browseren**, altså
   `https://breve.villadsclaes.dk/skuffe/opsaet.php`. Den går tre trin igennem:
   - skriver forbindelsen (du indtaster oplysningerne fra trin 2),
   - opretter de tre tabeller,
   - og lader dig vælge en **adgangskode** på mindst otte tegn.
4. **Slet `opsaet.php` igen.** Den er brugt, og den skal ikke ligge fremme.
5. **Åbn `https://breve.villadsclaes.dk/`** og tryk på `▤ skuffen`. Der står nu en lille linje under
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

## Domænet

Brevene bygger deres links af den adresse, siden bliver åbnet på — så snart
siden ligger på `https://breve.villadsclaes.dk/`, peger nye breve derhen af sig
selv. Den gamle adresse på GitHub Pages bliver liggende som en kopi, og
`<link rel="canonical">` i `index.html` peger nu på det nye domæne.

## På Simply.com (hed tidligere UnoEuro)

Webhotellet ligger på `93.191.156.11` — Simply.coms servere. Deres vejledninger
siger:

1. **Siden skal stå til PHP.** Under **Website → Change to ASP/PHP** (eller
   *PHP Version*) vælges PHP, ikke ASP. Vælger man ASP, kører siden på Windows/IIS,
   hvor `.htaccess` ikke virker — og så skal `skuffe/.htaccess` blot slettes, for
   den behøves ikke. Vælg gerne PHP 8.0 eller nyere.
2. **Webmappen er `public_html`.** Den kan ikke ændres. Det er dér, `index.html`,
   `app.js`, `style.css`, `data.js` og mappen `skuffe/` skal ligge.
3. **Databasen oprettes under MySQL** i kontrolpanelet — ikke i phpMyAdmin.
   Vært, navn, brugernavn og adgangskode står i velkomstmailen eller samme sted.
   Værten er typisk `localhost`.
4. **Subdomænet `breve.villadsclaes.dk`** oprettes under **Website**. Tjek i
   panelet, hvilken mappe det peger på, og læg filerne der.
5. **Filen op.** Deres filhåndtering kan uploade, men det er ikke sikkert, den kan
   pakke et arkiv ud; FTP er den sikre vej (træk hele indholdet af mappen over i
   `public_html`). Findes der SSH på pakken, kan zip-filen også lægges op og
   pakkes ud med `unzip`.

Siden svarer i dag *(13. oktober 2026)* med en fejl fra serveren, fordi
subdomænet endnu ikke er bundet til en mappe — det er første trin i panelet.

## Krav

PHP 7.4 eller nyere med `pdo_mysql` (og `mbstring`, hvis den findes) samt en
MySQL-database. Vil du hellere slippe for at oprette noget i panelet, kan
`opsaet.php` sætte `driver` til `sqlite` i stedet — det bruges til at prøve det af
lokalt, men på et webhotel er MySQL det rigtige valg.
