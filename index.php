<?php

declare(strict_types=1);

?><!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>System korekty danych organizacyjnych</title>
  <link rel="stylesheet" href="assets/css/styles.css" />
</head>
<body>
  <div class="app">
    <header>
      <h1 class="company" id="companyName">—</h1>
      <div class="title">System korekty danych organizacyjnych</div>
    </header>

    <section class="card" id="loginView">
      <div class="login-card">
        <h2>Wprowadź hasło</h2>
        <form id="loginForm">
          <div class="field">
            <label for="passwordInput">Hasło dostępu</label>
            <input type="password" id="passwordInput" autocomplete="current-password" required />
          </div>
          <div class="inline" style="margin-top: 12px;">
            <button class="btn primary" type="submit">Zaloguj</button>
          </div>
          <div id="loginError" class="alert hidden" role="alert"></div>
        </form>
      </div>
    </section>

    <section class="card hidden" id="loadingView">
      <div class="loading-screen">
        <strong>Witaj w systemie do poprawy danych organizacji</strong>
        <div>Trwa wczytywanie danych, proszę czekać...</div>
        <div class="progress" aria-label="Wczytywanie"></div>
      </div>
    </section>

    <section class="card hidden" id="appView">
      <div class="topbar">
        <div class="right-actions">
          <span class="pill">Liczba zmian: <strong id="changesCount">0</strong></span>
          <button class="btn primary" id="btnSave" disabled title="Najpierw wprowadź zmianę.">
            Zapisz zmiany
          </button>
        </div>

        <div class="right-actions">
          <div class="session-info">
            Sesja wygaśnie za <strong id="sessionCountdown">5:00</strong>
          </div>
          <button class="btn" id="btnLogout">Wyloguj</button>
        </div>
      </div>

      <div id="orgBlock" style="display: none;">
        <div class="small-grid">
          <div class="mini-card">
            <h3>Informacje</h3>
            <div class="metrics" id="metricsGrid"></div>
          </div>

          <div class="mini-card">
            <h3>Błędy</h3>
            <div class="errors" id="errorsGrid"></div>
          </div>
        </div>

        <div class="mini-card wide-card">
          <h3>Struktura organizacyjna</h3>
          <div class="org-chart-wrapper" id="orgChartWrapper">
            <div id="orgChart" class="org-chart" aria-label="Drzewo organizacji"></div>
            <div class="org-chart-controls">
              <button class="btn" type="button" id="orgChartZoomOut">−</button>
              <button class="btn" type="button" id="orgChartZoomIn">+</button>
              <button class="btn" type="button" id="orgChartReset">Reset</button>
              <button class="btn" type="button" id="orgChartFullscreen">⤢</button>
            </div>
          </div>
        </div>

        <div class="filters">
          <div class="field">
            <label>Dział (filtr)</label>
            <select id="filterDept"></select>
          </div>
          <div class="field">
            <label>Raportuje do (filtr)</label>
            <select id="filterManager"></select>
          </div>
          <div class="field">
            <label>Szukaj (imię/nazwisko)</label>
            <input type="text" id="filterSearch" placeholder="np. Kowalska" />
          </div>
          <div class="toggle">
            <input type="checkbox" id="filterMissingOnly" />
            <label for="filterMissingOnly" style="cursor: pointer;">Tylko braki</label>
          </div>
        </div>

        <div class="table-wrap" id="changesWrap" style="display: none;">
          <table id="changesTable">
            <thead>
              <tr>
                <th>Osoba</th>
                <th>Co zmieniono</th>
                <th>Było</th>
                <th>Jest</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="table-wrap">
          <table id="peopleTable">
            <thead>
              <tr>
                <th data-sort="missing">Braki <span class="sort" id="sortIcon-missing">↓</span></th>
                <th data-sort="first">Imię <span class="sort" id="sortIcon-first">↕</span></th>
                <th data-sort="last">Nazwisko <span class="sort" id="sortIcon-last">↕</span></th>
                <th data-sort="dept">Dział <span class="sort" id="sortIcon-dept">↕</span></th>
                <th data-sort="manager">Raportuje do <span class="sort" id="sortIcon-manager">↕</span></th>
                <th data-sort="date">Data dołączenia <span class="sort" id="sortIcon-date">↕</span></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="history">
          <h3>Historia zmian</h3>
          <div id="historyEmpty" class="empty hidden">Brak zapisanej historii zmian.</div>
          <ul id="historyList" class="history-list"></ul>
          <div id="historyToggle" class="history-toggle hidden">
            <div class="history-toggle-line">
              <span id="historyToggleLabel">Pokaż więcej zmian</span>
              <button id="historyToggleBtn" type="button">⬇</button>
            </div>
          </div>
        </div>
      </div>

      <div id="emptyState" class="empty">Brak danych do wyświetlenia.</div>
    </section>
  </div>

  <script type="module" src="assets/js/app.js"></script>
</body>
</html>
