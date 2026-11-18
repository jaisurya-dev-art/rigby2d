# Splash animations

Community animations shown on the desktop splash screen (Preferences ▸ General ▸ Splash animation).
One is picked at random at each launch. With no folder here, the splash shows the logo only.

Each piece is a folder:

```
src/splash/art/<id>/
  piece.json      the credit and how to show it
  <name>.json     the skeleton (exported from Rigby2D, JSON 4.3)
  <name>.atlas    its atlas
  <name>.png      the atlas page(s)
```

`piece.json`:

```json
{
  "title": "Hello there",
  "artist": "Artist Name",
  "licence": "CC BY 4.0",
  "skeleton": "hello.json",
  "atlas": "hello.atlas",
  "animation": "wave",
  "frame": { "x": 0.6, "y": 0.5, "height": 0.86 }
}
```

- `animation` loops; leave it out to play the first one. `skin` picks a skin.
- `frame` places the setup pose: its centre at `x` and `y` of the window (0 to 1) and its height
  `height` of the window's. The lockup sits top left, the credit bottom left and the Start button
  bottom right, so keep the art clear of those corners.
- Only hand-made art, licensed CC BY 4.0, with the artist's agreement to be shown here. Keep the
  atlas small (one page, 1024 px or less): the splash is shown while the editor loads.
