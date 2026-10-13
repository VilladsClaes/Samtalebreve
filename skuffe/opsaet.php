<?php
declare(strict_types=1);

/* ============================================================
   Skuffen — opsætning
   ------------------------------------------------------------
   Denne side gør tre ting, én gang: skriver forbindelsen til din
   database, opretter tabellerne og gemmer den adgangskode, du
   vælger. Bagefter skal filen slettes igen — den behøver ikke
   ligge på serveren, når den er brugt.
   ============================================================ */

ini_set('display_errors', '0');
ini_set('log_errors', '1');

$CONFIG = __DIR__ . '/config.php';
$besked = '';
$fejl = '';

function h(?string $t): string
{
    return htmlspecialchars((string)$t, ENT_QUOTES, 'UTF-8');
}

function sammefra(): bool
{
    $vaert = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($vaert === '') {
        return false;
    }
    $op = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($op === '') {
        $op = (string)($_SERVER['HTTP_REFERER'] ?? '');
    }
    if ($op === '') {
        return false;
    }
    $opvaert = (string)parse_url($op, PHP_URL_HOST);
    return $opvaert !== '' && strcasecmp($opvaert, (string)parse_url('http://' . $vaert, PHP_URL_HOST)) === 0;
}

function skriv_config(array $c): bool
{
    $tekst = "<?php\n"
        . "// skuffens database — din egen fil, som ikke skal deles eller lægges i git\n"
        . "return " . var_export($c, true) . ";\n";
    return @file_put_contents(__DIR__ . '/config.php', $tekst) !== false;
}

function forbind(?array $c, ?string &$fejl): ?PDO
{
    if (!is_array($c)) {
        $fejl = 'config.php findes ikke endnu';
        return null;
    }
    try {
        if (($c['driver'] ?? 'mysql') === 'sqlite') {
            $pdo = new PDO('sqlite:' . ($c['fil'] ?? (__DIR__ . '/skuffe.sqlite')));
        } else {
            $pdo = new PDO(
                'mysql:host=' . ($c['host'] ?? 'localhost') . ';dbname=' . ($c['navn'] ?? '') . ';charset=utf8mb4',
                (string)($c['bruger'] ?? ''),
                (string)($c['kode'] ?? '')
            );
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        return $pdo;
    } catch (Throwable $e) {
        $fejl = 'kunne ikke forbinde til databasen';
        error_log('skuffen/opsætning: ' . $e->getMessage());
        return null;
    }
}

function skema_findes(PDO $pdo): bool
{
    try {
        $pdo->query('SELECT 1 FROM skuffe LIMIT 1');
        $pdo->query('SELECT 1 FROM skuffe_indstillinger LIMIT 1');
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

function opret_skema(PDO $pdo): void
{
    // rettet er et tidsstempel i millisekunder — BIGINT, for en almindelig INT
    // i MySQL holder kun til omkring 2.1 milliarder
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe ('
        . ' id INTEGER PRIMARY KEY,'
        . ' version INTEGER NOT NULL DEFAULT 0,'
        . ' rettet BIGINT NOT NULL DEFAULT 0,'
        . ' data MEDIUMTEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe_indstillinger ('
        . ' navn VARCHAR(32) PRIMARY KEY,'
        . ' vaerdi MEDIUMTEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe_forsoeg ('
        . ' ip VARCHAR(45) PRIMARY KEY,'
        . ' antal INTEGER NOT NULL,'
        . ' sidst INTEGER NOT NULL)');
}

function indstilling(PDO $pdo, string $navn): ?string
{
    try {
        $s = $pdo->prepare('SELECT vaerdi FROM skuffe_indstillinger WHERE navn = ?');
        $s->execute(array($navn));
        $r = $s->fetch();
        return $r === false ? null : (string)$r['vaerdi'];
    } catch (Throwable $e) {
        return null;
    }
}

function gem_indstilling(PDO $pdo, string $navn, string $vaerdi): void
{
    $s = $pdo->prepare('SELECT 1 FROM skuffe_indstillinger WHERE navn = ?');
    $s->execute(array($navn));
    if ($s->fetch() === false) {
        $i = $pdo->prepare('INSERT INTO skuffe_indstillinger (navn, vaerdi) VALUES (?, ?)');
        $i->execute(array($navn, $vaerdi));
    } else {
        $u = $pdo->prepare('UPDATE skuffe_indstillinger SET vaerdi = ? WHERE navn = ?');
        $u->execute(array($vaerdi, $navn));
    }
}

/* ---------- hvad blev der trykket på ---------- */

$handling = (string)($_POST['handling'] ?? '');

if ($handling !== '') {
    if (!sammefra()) {
        $fejl = 'Forespørgslen kom ikke fra denne side. Åbn opsaet.php i browseren og prøv igen.';
    } elseif ($handling === 'gem-config') {
        $driver = ($_POST['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
        $ny = array('driver' => $driver);
        if ($driver === 'sqlite') {
            $ny['fil'] = __DIR__ . '/skuffe.sqlite';
        } else {
            $ny['host'] = trim((string)($_POST['host'] ?? 'localhost'));
            $ny['navn'] = trim((string)($_POST['navn'] ?? ''));
            $ny['bruger'] = trim((string)($_POST['bruger'] ?? ''));
            $ny['kode'] = (string)($_POST['kode'] ?? '');
            if ($ny['navn'] === '' || $ny['bruger'] === '') {
                $fejl = 'Udfyld både databasens navn og brugernavn.';
            }
        }
        if ($fejl === '') {
            $findes = is_file($CONFIG);
            if ($findes && ($_POST['laveom'] ?? '') !== '1') {
                $fejl = 'config.php findes allerede.';
            } elseif (!skriv_config($ny)) {
                $fejl = 'Kunne ikke skrive config.php — tjek at mappen kan skrives til.';
            } else {
                $t = null;
                $pdo = forbind($ny, $t);
                if ($pdo === null) {
                    $fejl = 'Filen blev skrevet, men forbindelsen virker ikke: ' . h($t)
                        . '. Ret oplysningerne nedenfor og gem igen.';
                } else {
                    $besked = 'Forbindelsen til databasen virker.';
                }
            }
        }
    } elseif ($handling === 'opret-tabeller') {
        $t = null;
        $pdo = forbind(is_file($CONFIG) ? require $CONFIG : null, $t);
        if ($pdo === null) {
            $fejl = $t;
        } else {
            try {
                opret_skema($pdo);
                $besked = 'Tabellerne er oprettet.';
            } catch (Throwable $e) {
                $fejl = 'Kunne ikke oprette tabellerne: ' . h($e->getMessage());
            }
        }
    } elseif ($handling === 'saet-kode' || $handling === 'skift-kode') {
        $t = null;
        $pdo = forbind(is_file($CONFIG) ? require $CONFIG : null, $t);
        $kode = (string)($_POST['kode'] ?? '');
        $gentag = (string)($_POST['gentag'] ?? '');
        if ($pdo === null) {
            $fejl = $t;
        } elseif (strlen($kode) < 8) {
            $fejl = 'Vælg en adgangskode på mindst 8 tegn.';
        } elseif ($kode !== $gentag) {
            $fejl = 'De to adgangskoder er ikke ens.';
        } else {
            $gammel = indstilling($pdo, 'kode_hash');
            if ($gammel !== null && $gammel !== '') {
                $nu = (string)($_POST['nuvaerende'] ?? '');
                if (!password_verify($nu, $gammel)) {
                    $fejl = 'Den nuværende adgangskode passer ikke.';
                }
            }
            if ($fejl === '') {
                gem_indstilling($pdo, 'kode_hash', password_hash($kode, PASSWORD_DEFAULT));
                $besked = 'Adgangskoden er gemt. Nu kan du logge ind i skuffen fra brevet.';
            }
        }
    }
}

/* ---------- hvordan ser det ud nu ---------- */

$findes_config = is_file($CONFIG);
$lave_om = (($_POST['handling'] ?? '') === 'gem-config' && ($_POST['laveom'] ?? '') === '1') || isset($_GET['laveom']);
$config = $findes_config ? @include $CONFIG : null;
$config = is_array($config) ? $config : null;
$pdo = null;
$t_fejl = null;

if ($config !== null && (!$findes_config || $lave_om === false)) {
    $pdo = forbind($config, $t_fejl);
}
$har_skema = $pdo !== null && skema_findes($pdo);
$har_kode = $har_skema ? (indstilling($pdo, 'kode_hash') !== null && indstilling($pdo, 'kode_hash') !== '') : false;
$status = array();
if ($har_skema) {
    try {
        $r = $pdo->query('SELECT version, rettet, data FROM skuffe WHERE id = 1')->fetch();
        if (is_array($r)) {
            $brev = json_decode((string)$r['data'], true);
            $status = array(
                'version' => (int)$r['version'],
                'antal' => is_array($brev) ? count($brev) : 0,
                'rettet' => (int)$r['rettet'],
            );
        }
    } catch (Throwable $e) {
    }
}

$adresse = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https://' : 'http://')
    . (string)($_SERVER['HTTP_HOST'] ?? '')
    . rtrim(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/../';
?>
<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skuffen — opsætning</title>
  <style>
    :root { --papir:#f5edd9; --blek:#241d15; --svag:#5d4b34; }
    * { box-sizing:border-box; }
    body { margin:0; padding:clamp(14px,4vw,40px); background:#140f0b; color:var(--blek);
      font-family:'Courier Prime','Courier New',ui-monospace,monospace; line-height:1.6; }
    .kort { max-width:760px; margin:0 auto; background:linear-gradient(178deg,#f8f2e3,#efe5cd);
      border-radius:2px; padding:clamp(16px,3vw,32px); box-shadow:0 30px 60px -20px rgba(0,0,0,.75); }
    h1 { font-family:'Special Elite','Courier Prime',monospace; font-size:1.5rem; margin:0 0 .2em; }
    h2 { font-size:1.05rem; margin:1.8em 0 .4em; }
    p, li { font-size:.92rem; }
    .loes { color:var(--svag); }
    .besked { background:#e3efd9; border-left:3px solid #4f7a35; padding:10px 12px; margin:1em 0; }
    .fejl { background:#f6ded7; border-left:3px solid #8d3b22; padding:10px 12px; margin:1em 0; }
    label { display:block; margin:.7em 0 0; font-size:.78rem; letter-spacing:.1em; text-transform:uppercase; color:var(--svag); }
    input, select { width:100%; font:inherit; font-size:.9rem; padding:7px 9px; background:#fffdf6;
      border:1px solid rgba(70,56,40,.35); border-radius:2px; }
    button { font:inherit; font-size:.86rem; padding:8px 14px; margin-top:1em; cursor:pointer;
      background:#2f2820; color:#f6ecd6; border:1px solid #2f2820; border-radius:2px; }
    button.let { background:rgba(255,255,255,.5); color:#3a2f22; border-color:rgba(70,56,40,.35); }
    .to { display:flex; gap:14px; } .to > div { flex:1; }
    .stor { font-size:1.05rem; }
    code { background:rgba(60,46,30,.1); padding:1px 4px; border-radius:2px; }
    ol { padding-left:1.2em; }
    .advarsel { border:1px dashed rgba(141,59,34,.5); padding:10px 12px; margin:1em 0; }
  </style>
</head>
<body>
<div class="kort">
  <h1>Skuffen — opsætning</h1>
  <p class="loes">Her forbindes skuffen til din database, og du vælger den adgangskode, der låser den.
     Brevene selv ligger stadig i linkene — det er skuffen og brevets tekst, der gemmes.</p>

  <?php if ($besked !== ''): ?><p class="besked"><?= h($besked) ?></p><?php endif; ?>
  <?php if ($fejl !== ''): ?><p class="fejl"><?= h($fejl) ?></p><?php endif; ?>

  <?php if (!$findes_config || $lave_om): ?>

    <h2>1. Forbindelsen til databasen</h2>
    <p class="loes">Oplysningerne står i dit webhotels kontrolpanel under databaser. Vælger du SQLite,
       klarer den sig med en fil i denne mappe — så skal du ikke oprette noget i panelet.</p>
    <form method="post">
      <input type="hidden" name="handling" value="gem-config">
      <?php if ($findes_config): ?><input type="hidden" name="laveom" value="1"><?php endif; ?>
      <label for="driver">Type</label>
      <select name="driver" id="driver">
        <option value="mysql" <?= ($config['driver'] ?? 'mysql') === 'mysql' ? 'selected' : '' ?>>MySQL (det almindelige på et webhotel)</option>
        <option value="sqlite" <?= ($config['driver'] ?? '') === 'sqlite' ? 'selected' : '' ?>>SQLite (en fil i mappen)</option>
      </select>
      <label for="host">Vært (host)</label>
      <input type="text" name="host" id="host" value="<?= h($config['host'] ?? 'localhost') ?>">
      <div class="to">
        <div>
          <label for="navn">Databasens navn</label>
          <input type="text" name="navn" id="navn" value="<?= h($config['navn'] ?? '') ?>">
        </div>
        <div>
          <label for="bruger">Brugernavn</label>
          <input type="text" name="bruger" id="bruger" value="<?= h($config['bruger'] ?? '') ?>">
        </div>
      </div>
      <label for="kode">Kodeord til databasen</label>
      <input type="password" name="kode" id="kode" value="">
      <button type="submit">Gem og prøv forbindelsen</button>
    </form>

  <?php else: ?>

    <h2>1. Forbindelsen</h2>
    <?php if ($pdo === null): ?>
      <p class="fejl">Filen <code>config.php</code> findes, men forbindelsen virker ikke: <?= h($t_fejl) ?></p>
      <p><a href="?laveom=1">Ret oplysningerne</a></p>
    <?php else: ?>
      <p class="besked">Der er forbindelse til databasen (<?= h($config['driver'] ?? 'mysql') ?>, PHP <?= h(PHP_VERSION) ?>).</p>
    <?php endif; ?>

    <?php if ($pdo !== null && !$har_skema): ?>
      <h2>2. Tabellerne</h2>
      <p class="loes">Der mangler tre små tabeller. De oprettes med ét tryk — der slettes intet.</p>
      <form method="post">
        <input type="hidden" name="handling" value="opret-tabeller">
        <button type="submit">Opret tabellerne</button>
      </form>
    <?php endif; ?>

    <?php if ($har_skema && !$har_kode): ?>
      <h2>2. Adgangskoden</h2>
      <p class="loes">Vælg en adgangskode på mindst 8 tegn. Den gemmes som et hash — også hvis nogen
         skulle se databasen, kan de ikke læse den ud af den. Du taster den én gang på hver maskine.</p>
      <form method="post">
        <input type="hidden" name="handling" value="saet-kode">
        <label for="kode2">Adgangskode</label>
        <input type="password" name="kode" id="kode2" autocomplete="new-password">
        <label for="gentag">Gentag adgangskoden</label>
        <input type="password" name="gentag" id="gentag" autocomplete="new-password">
        <button type="submit">Gem adgangskoden</button>
      </form>
    <?php endif; ?>

    <?php if ($har_skema && $har_kode): ?>
      <h2>2. Adgangskoden</h2>
      <p class="besked">Adgangskoden er sat, og skuffen kan bruges fra brevet.</p>
      <details>
        <summary class="loes">Skift adgangskode</summary>
        <form method="post">
          <input type="hidden" name="handling" value="skift-kode">
          <label for="nuvaerende">Nuværende adgangskode</label>
          <input type="password" name="nuvaerende" id="nuvaerende" autocomplete="current-password">
          <label for="kode3">Ny adgangskode</label>
          <input type="password" name="kode" id="kode3" autocomplete="new-password">
          <label for="gentag2">Gentag den nye</label>
          <input type="password" name="gentag" id="gentag2" autocomplete="new-password">
          <button type="submit">Skift adgangskode</button>
        </form>
      </details>
    <?php endif; ?>

    <?php if ($har_skema): ?>
      <h2>3. Sådan ser skuffen ud nu</h2>
      <p class="stor">
        <?= isset($status['antal']) ? (int)$status['antal'] : 0 ?> breve i skuffen ·
        version <?= isset($status['version']) ? (int)$status['version'] : 0 ?> ·
        sidst rettet <?= !empty($status['rettet']) ? h(date('d.m.Y H:i', (int)round($status['rettet'] / 1000))) : 'aldrig' ?>
      </p>
      <p class="loes">Adressen til brevene er <code><?= h($adresse) ?></code> — det er dér, nye links peger hen.</p>
    <?php endif; ?>

  <?php endif; ?>

  <h2 style="margin-top:2em">Til sidst</h2>
  <div class="advarsel">
    <p><strong>Slet denne fil (<code>opsaet.php</code>) når du er færdig.</strong> Den skal ikke ligge på
       serveren, når opsætningen er klaret.</p>
  </div>
  <ol class="loes">
    <li>Læg hele mappen — brevet og underskuffen <code>skuffe/</code> — på webhotellet.</li>
    <li>Åbn <code>skuffe/opsaet.php</code> i browseren og følg de tre trin.</li>
    <li>Slet <code>skuffe/opsaet.php</code> igen.</li>
    <li>Åbn brevet, tryk <em>skuffen</em> og tast adgangskoden på hver maskine, du vil bruge.</li>
  </ol>
</div>
</body>
</html>
