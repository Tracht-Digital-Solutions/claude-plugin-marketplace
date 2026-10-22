# Tracht Digital Solutions Claude Code Plugins

Marktplatz für alle Claude-Code-Plugins von [Tracht Digital Solutions](https://github.com/Tracht-Digital-Solutions). Der Katalog wird automatisch per GitHub Actions aus den einzelnen Plugin-Repositories zusammengestellt.

## Installation

```text
/plugin marketplace add Tracht-Digital-Solutions/claude-plugin-marketplace
/plugin install <plugin>@claude-plugin-marketplace
```

Updates holen: `/plugin marketplace update claude-plugin-marketplace`

## Plugins

<!-- plugins:start -->
| Plugin | Beschreibung | Installation |
| --- | --- | --- |
| [`gitea`](https://github.com/Tracht-Digital-Solutions/gitea-claude-plugin/tree/stable/plugin) | Work with any Gitea instance: repositories, files, branches, issues, pull requests, reviews, organisations, Gitea Actions, releases and webhooks. | `/plugin install gitea@claude-plugin-marketplace` |
<!-- plugins:end -->

## So funktioniert die Pipeline

Der Workflow [`build-marketplace.yml`](.github/workflows/build-marketplace.yml) führt `scripts/build-marketplace.mjs` aus:

1. **Discovery:** Alle öffentlichen, nicht archivierten Repos von `Tracht-Digital-Solutions` mit dem Topic **`claude-code-plugin`** werden gefunden. Über [`sources.json`](sources.json) lassen sich zusätzliche Repos (`include`, optional mit `ref`) aufnehmen oder ausschließen (`exclude`).
2. **Einlesen:** Pro Repo wird `.claude-plugin/marketplace.json` gelesen und dessen Plugin-Einträge übernommen (relative Pfade werden zu `git-subdir`-Quellen umgeschrieben). Fehlt sie, wird `.claude-plugin/plugin.json` im Repo-Root als einzelnes Plugin aufgenommen.
3. **Zusammenführen:** Einträge werden nach Namen sortiert, doppelte Namen brechen den Build ab. `.claude-plugin/marketplace.json` und die Tabelle oben werden neu geschrieben.
4. **Validieren & Committen:** `claude plugin validate .` prüft das Ergebnis; nur bei Änderungen wird committet.

**Auslöser:** alle 6 Stunden, manuell (`workflow_dispatch`), bei Änderungen an `sources.json`/Skript auf `main` und per `repository_dispatch` (Typ `plugin-updated`) aus einem Plugin-Repo.

### Neues Plugin hinzufügen

1. Plugin-Repo öffentlich auf GitHub anlegen, mit `.claude-plugin/plugin.json` (oder `marketplace.json`).
2. Topic `claude-code-plugin` setzen: `gh repo edit Tracht-Digital-Solutions/<repo> --add-topic claude-code-plugin`
3. Fertig – beim nächsten Lauf erscheint es hier. Sofort: `gh workflow run build-marketplace.yml -R Tracht-Digital-Solutions/claude-plugin-marketplace`

### Sofort-Update aus einem Plugin-Repo (optional)

Im Plugin-Repo einen Secret `DISPATCH_TOKEN` hinterlegen (Fine-grained PAT mit *Contents: read & write* auf `Tracht-Digital-Solutions/claude-plugin-marketplace`) und nach dem Release ausführen:

```yaml
- name: Notify marketplace
  run: gh api repos/Tracht-Digital-Solutions/claude-plugin-marketplace/dispatches -f event_type=plugin-updated
  env:
    GH_TOKEN: ${{ secrets.DISPATCH_TOKEN }}
```

### Lokal bauen

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/build-marketplace.mjs
claude plugin validate .
```
