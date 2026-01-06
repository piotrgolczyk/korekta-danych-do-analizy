<?php

declare(strict_types=1);

function respond_json(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function data_dir(): string
{
    return dirname(__DIR__) . '/data-to-fix';
}

function list_json_files(): array
{
    $dir = data_dir();
    if (!is_dir($dir)) {
        return [];
    }

    $files = glob($dir . '/*.json');
    if ($files === false) {
        return [];
    }

    return array_values(array_filter($files, 'is_file'));
}

function extract_passwords_from_filename(string $filename): array
{
    $matches = [];
    preg_match_all('/_([^_]+)_/', $filename, $matches);

    return $matches[1] ?? [];
}

function find_file_by_password(string $password): array
{
    $password = trim($password);
    if ($password === '') {
        return [null, 'Wpisz hasło.'];
    }

    $matches = [];
    foreach (list_json_files() as $path) {
        $name = basename($path);
        foreach (extract_passwords_from_filename($name) as $candidate) {
            if (hash_equals($candidate, $password)) {
                $matches[] = $path;
            }
        }
    }

    if (count($matches) === 0) {
        return [null, 'Nieprawidłowe hasło. Skontaktuj się z administratorem.'];
    }

    if (count($matches) > 1) {
        return [null, 'Hasło pasuje do więcej niż jednego pliku. Skontaktuj się z administratorem.'];
    }

    return [$matches[0], null];
}

function read_json_file(string $path): array
{
    $raw = file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException('Nie można odczytać pliku danych.');
    }

    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

    if (!is_array($data)) {
        throw new RuntimeException('Nieprawidłowy format JSON.');
    }

    return $data;
}

function save_json_file(string $path, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        throw new RuntimeException('Nie można zakodować danych.');
    }

    if (file_put_contents($path, $json . PHP_EOL, LOCK_EX) === false) {
        throw new RuntimeException('Nie można zapisać pliku danych.');
    }
}

function history_path(string $dataPath): string
{
    $dir = dirname($dataPath);
    $base = pathinfo($dataPath, PATHINFO_FILENAME);

    return $dir . '/' . $base . '.changes.json';
}

function load_history(string $dataPath): array
{
    $path = history_path($dataPath);
    if (!file_exists($path)) {
        return [];
    }

    $raw = file_get_contents($path);
    if ($raw === false) {
        return [];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return [];
    }

    return $data;
}

function append_history_entry(string $dataPath, array $entry): array
{
    $history = load_history($dataPath);
    array_unshift($history, $entry);

    $json = json_encode($history, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        throw new RuntimeException('Nie można zapisać historii zmian.');
    }

    if (file_put_contents(history_path($dataPath), $json . PHP_EOL, LOCK_EX) === false) {
        throw new RuntimeException('Nie można zapisać historii zmian.');
    }

    return $history;
}

function require_session_file(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    $path = $_SESSION['data_file'] ?? '';
    if (!is_string($path) || $path === '' || !file_exists($path)) {
        respond_json(['ok' => false, 'message' => 'Brak aktywnej sesji. Zaloguj się ponownie.'], 401);
    }

    return $path;
}
