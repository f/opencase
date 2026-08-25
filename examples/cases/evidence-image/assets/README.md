# Asset used by this example

`locker-note.png` was generated with OpenAI ImageGen as a fictional evidence
photograph. `case.yml` declares its kind, MIME type, public visibility, and
exact SHA-256 digest. The evidence card references the asset ID rather than its
path.

The authoritative clue remains the structured `note_scan.text` value in
`case.yml`; the pixels are presentation, not game logic. At runtime, the player
receives only this safe handle:

```json
{"id":"locker-note","kind":"image","mimeType":"image/png"}
```

The host resolves and serves verified bytes; the browser never receives the
authored `assets/locker-note.png` locator.
