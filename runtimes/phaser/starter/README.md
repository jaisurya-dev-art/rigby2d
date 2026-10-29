# Rigby2D Phaser starter

A small Phaser 3 game with NILA, made with [Rigby2D](https://rigby2d.com):

- **← →** move her (she turns around with `flipX`)
- **Space** waves once, then goes back to idle (the `complete` event)
- **1-9** switch her mood with a 0.25 s crossfade
- A ball follows her head bone (`boneWorld('head')`)

## Run it

Browsers don't load modules from `file://`, so serve the folder:

```bash
npx serve .
```

Then open the address it prints. Or use any local server, such as the Live Server extension in
VS Code or `python -m http.server`.

## Make it yours

1. In Rigby2D, export your character: *File ▸ Export ▸ Binary .skel + atlas* (or JSON).
2. Put the `.skel`, `.atlas` and `.png` files in `assets/`.
3. In `main.js`, change `'assets/nila.skel'` and `'assets/nila.atlas'`, and the animation names.

`rigby2d-phaser.mjs` is the Rigby2D runtime for Phaser. See the
[Phaser guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/phaser/README.md)
for everything a `RigbySkeleton` can do.

## License

The code (`main.js`, `index.html`, `rigby2d-phaser.mjs`) is MIT OR Apache-2.0: use it in your games.
NILA (everything in `assets/`) is Rigby2D demo content under `assets/LICENSE.md`: learn from her
and try the runtime, but don't ship her in your own games or products.
