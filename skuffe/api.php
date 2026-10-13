<?php
declare(strict_types=1);

/* ============================================================
   Skuffen — et lille lager, så breve kan findes på flere maskiner
   ------------------------------------------------------------
   Her ligger ét menneskes skuffer: dine egne. Adgangen kræver en
   adgangskode, som sættes første gang på opsaet.php, og som gemmes
   som et hash — aldrig i klartekst. Alt svarer i JSON, og svarene
   er altid private og må ikke lægges i cache.

   Handlinger (i forespørgslens ?handling=…):
     hvem      GET   — er der sat op, og er man logget ind
     log-ind   POST  — {kode}
     log-ud    POST
     skuffe    GET   — {version, brev}
     skuffe    POST  — {version, brev} → gemmer, hvis versionen passer
   ============================================================ */

ini_set('display_errors', '0');
ini_set('log_errors', '1');

const SKUFFE_VERSION = 1;          // API'ets form; kan udvides senere
const SKUFFE_MAKS_BREVE = 40;
const SKUFFE_MAKS_KROP = 524288;   // 512 kB — en fuld skuffe fylder langt mindre
const SKUFFE_MAKS_URL = 2048;
const SKUFFE_MAKS_TEKST = 2000;
const SKUFFE_MAKS_FORSOEG = 10;    // pr. IP inden for vinduet
const SKUFFE_VINDUE = 900;         // 15 minutter

$CONFIG_FIL = __DIR__ . '/config.php';

/* ---------- svar ---------- */

function svar(int $kode, array $data): void
{
    http_response_code($kode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    $ud = json_encode($data, JSON_UNESCAPED_UNICODE);
    echo $ud === false ? '{"fejl":"kunne ikke svare"}' : $ud;
    exit;
}

/* ---------- database ---------- */

function forbindelse(): PDO
{
    global $CONFIG_FIL;
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    if (!is_file($CONFIG_FIL)) {
        svar(500, array('fejl' => 'skuffen er ikke sat op endnu', 'opsaet' => 'opsaet.php'));
    }
    $c = require $CONFIG_FIL;
    if (!is_array($c)) {
        svar(500, array('fejl' => 'config.php læses ikke rigtigt'));
    }
    try {
        if (($c['driver'] ?? 'mysql') === 'sqlite') {
            $sti = $c['fil'] ?? (__DIR__ . '/skuffe.sqlite');
            $pdo = new PDO('sqlite:' . $sti);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 5000');
        } else {
            $dsn = 'mysql:host=' . ($c['host'] ?? 'localhost') .
                   ';dbname=' . ($c['navn'] ?? '') . ';charset=utf8mb4';
            $pdo = new PDO($dsn, (string)($c['bruger'] ?? ''), (string)($c['kode'] ?? ''));
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('skuffen: kunne ikke forbinde — ' . $e->getMessage());
        svar(500, array('fejl' => 'kunne ikke få fat i databasen', 'opsaet' => 'opsaet.php'));
    }
    return $pdo;
}

function driver(): string
{
    global $CONFIG_FIL;
    static $driv = null;
    if ($driv === null) {
        $c = is_file($CONFIG_FIL) ? require $CONFIG_FIL : array();
        $driv = is_array($c) && ($c['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    }
    return $driv;
}

function lav_skema(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe ('
        . ' id INTEGER PRIMARY KEY,'
        . ' version INTEGER NOT NULL DEFAULT 0,'
        . ' rettet INTEGER NOT NULL DEFAULT 0,'
        . ' data MEDIUMTEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe_indstillinger ('
        . ' navn VARCHAR(32) PRIMARY KEY,'
        . ' vaerdi MEDIUMTEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS skuffe_forsoeg ('
        . ' ip VARCHAR(45) PRIMARY KEY,'
        . ' antal INTEGER NOT NULL,'
        . ' sidst INTEGER NOT NULL)');
}

function findes_skema(PDO $pdo): bool
{
    try {
        $pdo->query('SELECT 1 FROM skuffe WHERE id = 1');
        $pdo->query('SELECT 1 FROM skuffe_indstillinger');
        return true;
    } catch (Throwable $e) {
        return false;
    }
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

/* ---------- småting ---------- */

// skær en tekst til uden at knække et flerbytet tegn midt over
function klip(string $t, int $n): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($t, 0, $n, 'UTF-8');
    }
    if (strlen($t) <= $n) {
        return $t;
    }
    $t = substr($t, 0, $n);
    while ($t !== '' && (ord($t[strlen($t) - 1]) & 0xC0) === 0x80) {
        $t = substr($t, 0, -1);
    }
    return $t;
}

function ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

// en skrivehandling skal komme fra siden selv — ikke fra en fremmed side
function er_samme_oprindelse(): bool
{
    $vaert = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($vaert === '') {
        return false;
    }
    $op = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($op !== '') {
        return strcasecmp((string)parse_url($op, PHP_URL_HOST), (string)parse_url('http://' . $vaert, PHP_URL_HOST)) === 0;
    }
    $ref = (string)($_SERVER['HTTP_REFERER'] ?? '');
    if ($ref === '') {
        return false;
    }
    return strcasecmp((string)parse_url($ref, PHP_URL_HOST), (string)parse_url('http://' . $vaert, PHP_URL_HOST)) === 0;
}

function krop(): array
{
    $raa = file_get_contents('php://input');
    if ($raa === false) {
        svar(400, array('fejl' => 'kunne ikke læse forespørgslen'));
    }
    if (strlen($raa) > SKUFFE_MAKS_KROP) {
        svar(413, array('fejl' => 'det er for meget at gemme på én gang'));
    }
    $data = json_decode($raa, true);
    if (!is_array($data)) {
        svar(400, array('fejl' => 'forespørgslen er ikke JSON'));
    }
    return $data;
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $sti = (string)parse_url((string)($_SERVER['SCRIPT_NAME'] ?? '/'), PHP_URL_PATH);
    session_set_cookie_params(array(
        'lifetime' => 60 * 60 * 24 * 180,
        'path' => rtrim(dirname($sti), '/') . '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    ));
    session_name('skuffen');
    session_start();
}

function indlogget(): bool
{
    return !empty($_SESSION['indlogget']);
}

/* ---------- for mange forsøg ---------- */

function forsoeg_antal(PDO $pdo, string $ip): int
{
    try {
        $s = $pdo->prepare('SELECT antal, sidst FROM skuffe_forsoeg WHERE ip = ?');
        $s->execute(array($ip));
        $r = $s->fetch();
        if ($r === false) {
            return 0;
        }
        if ((int)$r['sidst'] < time() - SKUFFE_VINDUE) {
            return 0;
        }
        return (int)$r['antal'];
    } catch (Throwable $e) {
        return 0;
    }
}

function noter_forsoeg(PDO $pdo, string $ip, bool $ok): void
{
    try {
        if ($ok) {
            $d = $pdo->prepare('DELETE FROM skuffe_forsoeg WHERE ip = ?');
            $d->execute(array($ip));
            return;
        }
        $s = $pdo->prepare('SELECT antal, sidst FROM skuffe_forsoeg WHERE ip = ?');
        $s->execute(array($ip));
        $r = $s->fetch();
        $antal = ($r === false || (int)$r['sidst'] < time() - SKUFFE_VINDUE) ? 0 : (int)$r['antal'];
        $antal++;
        if ($r === false) {
            $i = $pdo->prepare('INSERT INTO skuffe_forsoeg (ip, antal, sidst) VALUES (?, ?, ?)');
            $i->execute(array($ip, $antal, time()));
        } else {
            $u = $pdo->prepare('UPDATE skuffe_forsoeg SET antal = ?, sidst = ? WHERE ip = ?');
            $u->execute(array($antal, time(), $ip));
        }
    } catch (Throwable $e) {
        // en tæller der ikke kan skrives, må ikke spærre for at logge ind
    }
}

/* ---------- skuffens indhold ---------- */

function rense_brev(array $b): ?array
{
    $url = isset($b['url']) && is_string($b['url']) ? $b['url'] : '';
    if ($url === '' || strlen($url) > SKUFFE_MAKS_URL) {
        return null;
    }
    parse_str((string)parse_url($url, PHP_URL_QUERY), $q);
    if (empty($q['c']) && empty($q['q'])) {
        return null;                     // ikke et brev-link
    }
    $kort = array(
        'url' => $url,
        'at' => isset($b['at']) ? (int)$b['at'] : 0,
    );
    if (isset($b['linje']) && is_string($b['linje'])) {
        $kort['linje'] = klip($b['linje'], 400);
    }
    if (isset($b['spoergsmaal']) && is_string($b['spoergsmaal'])) {
        $kort['spoergsmaal'] = klip($b['spoergsmaal'], 400);
    }
    if (isset($b['svar']) && is_array($b['svar'])) {
        $svar = array();
        foreach ($b['svar'] as $s) {
            if (is_string($s) && trim($s) !== '') {
                $svar[] = klip($s, SKUFFE_MAKS_TEKST);
            }
            if (count($svar) >= SKUFFE_MAKS_BREVE) {
                break;
            }
        }
        if ($svar) {
            $kort['svar'] = $svar;
        }
    }
    return $kort;
}

function rense_breve($breve): array
{
    if (!is_array($breve)) {
        return array();
    }
    $ud = array();
    foreach ($breve as $b) {
        if (!is_array($b)) {
            continue;
        }
        $kort = rense_brev($b);
        if ($kort === null) {
            continue;
        }
        $ud[] = $kort;
        if (count($ud) >= SKUFFE_MAKS_BREVE) {
            break;
        }
    }
    return $ud;
}

function hent_skuffe(PDO $pdo): array
{
    $s = $pdo->query('SELECT version, rettet, data FROM skuffe WHERE id = 1');
    $r = $s->fetch();
    if ($r === false) {
        $i = $pdo->prepare('INSERT INTO skuffe (id, version, rettet, data) VALUES (1, 0, 0, ?)');
        $i->execute(array('[]'));
        return array('version' => 0, 'rettet' => 0, 'brev' => array());
    }
    $brev = json_decode((string)$r['data'], true);
    return array(
        'version' => (int)$r['version'],
        'rettet' => (int)$r['rettet'],
        'brev' => is_array($brev) ? $brev : array(),
    );
}

/* ---------- hvad bliver der spurgt om ---------- */

$handling = (string)($_GET['handling'] ?? '');
$metode = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$pdo = null;

switch ($handling) {
    case 'hvem':
        if (!is_file($CONFIG_FIL)) {
            svar(200, array('sat_op' => false, 'indlogget' => false, 'version' => SKUFFE_VERSION));
        }
        $pdo = forbindelse();
        if (!findes_skema($pdo)) {
            svar(200, array('sat_op' => false, 'indlogget' => false, 'version' => SKUFFE_VERSION));
        }
        start_session();
        $kode = indstilling($pdo, 'kode_hash');
        $har_kode = $kode !== null && $kode !== '';
        svar(200, array(
            'sat_op' => $har_kode,
            'indlogget' => indlogget() && $har_kode,
            'version' => SKUFFE_VERSION,
        ));
        break;

    case 'log-ind':
        if ($metode !== 'POST') {
            svar(405, array('fejl' => 'brug POST'));
        }
        if (!er_samme_oprindelse()) {
            svar(403, array('fejl' => 'forespørgslen kom ikke fra siden selv'));
        }
        $pdo = forbindelse();
        if (!findes_skema($pdo)) {
            svar(500, array('fejl' => 'skuffen er ikke sat op endnu', 'opsaet' => 'opsaet.php'));
        }
        $hash = indstilling($pdo, 'kode_hash');
        if ($hash === null || $hash === '') {
            svar(500, array('fejl' => 'der er ingen adgangskode sat endnu', 'opsaet' => 'opsaet.php'));
        }
        if (forsoeg_antal($pdo, ip()) >= SKUFFE_MAKS_FORSOEG) {
            svar(429, array('fejl' => 'for mange forsøg — prøv igen om et kvarter'));
        }
        $data = krop();
        $kode = isset($data['kode']) && is_string($data['kode']) ? $data['kode'] : '';
        if ($kode === '' || !password_verify($kode, $hash)) {
            noter_forsoeg($pdo, ip(), false);
            usleep(350000);               // gør det langsommere at gætte
            svar(401, array('fejl' => 'forkert adgangskode'));
        }
        noter_forsoeg($pdo, ip(), true);
        start_session();
        session_regenerate_id(true);
        $_SESSION['indlogget'] = true;
        svar(200, array('indlogget' => true));
        break;

    case 'log-ud':
        if ($metode !== 'POST') {
            svar(405, array('fejl' => 'brug POST'));
        }
        if (!er_samme_oprindelse()) {
            svar(403, array('fejl' => 'forespørgslen kom ikke fra siden selv'));
        }
        start_session();
        $_SESSION = array();
        session_destroy();
        svar(200, array('indlogget' => false));
        break;

    case 'skuffe':
        $pdo = forbindelse();
        if (!findes_skema($pdo)) {
            svar(500, array('fejl' => 'skuffen er ikke sat op endnu', 'opsaet' => 'opsaet.php'));
        }
        start_session();
        if (!indlogget()) {
            svar(401, array('fejl' => 'ikke logget ind'));
        }

        if ($metode === 'GET') {
            svar(200, hent_skuffe($pdo));
        }
        if ($metode !== 'POST') {
            svar(405, array('fejl' => 'brug GET eller POST'));
        }
        if (!er_samme_oprindelse()) {
            svar(403, array('fejl' => 'forespørgslen kom ikke fra siden selv'));
        }

        $data = krop();
        $brev = rense_breve($data['breve'] ?? null);
        $vil_version = isset($data['version']) ? (int)$data['version'] : 0;
        $driv = driver();

        try {
            $pdo->beginTransaction();
            $laas = $driv === 'mysql' ? ' FOR UPDATE' : '';
            $s = $pdo->query('SELECT version FROM skuffe WHERE id = 1' . $laas);
            $r = $s->fetch();
            if ($r === false) {
                $i = $pdo->prepare('INSERT INTO skuffe (id, version, rettet, data) VALUES (1, 0, 0, ?)');
                $i->execute(array('[]'));
                $nu = 0;
            } else {
                $nu = (int)$r['version'];
            }
            if ($nu !== $vil_version) {
                // nogen (eller en anden maskine) kom først — send det der ligger,
                // så siden kan lægge sammen og prøve én gang til
                $pdo->rollBack();
                $ligger = hent_skuffe($pdo);
                $ligger['stale'] = true;
                svar(200, $ligger);
            }
            $u = $pdo->prepare('UPDATE skuffe SET version = ?, rettet = ?, data = ? WHERE id = 1');
            $u->execute(array($nu + 1, (int)round(microtime(true) * 1000),
                json_encode($brev, JSON_UNESCAPED_UNICODE)));
            $pdo->commit();
            svar(200, array('version' => $nu + 1, 'brev' => $brev));
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('skuffen: kunne ikke gemme — ' . $e->getMessage());
            svar(500, array('fejl' => 'kunne ikke gemme lige nu'));
        }
        break;

    default:
        svar(400, array('fejl' => 'ukendt handling'));
}
