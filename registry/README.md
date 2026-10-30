# Add-on registry

The list of add-ons on [rigby2d.com/addons](https://rigby2d.com/addons/) and in the editor's
add-on gallery. How to publish: [docs/addons.md#publishing](../docs/addons.md#publishing).

- `addons/<id>.json`: one entry per add-on: its GitHub `repo` (or `path` for the official add-ons in
  this repository), `publisher`, `tags` and the date it was `added`.
- `index.json`: every version found and checked, written by `sync.mjs`. Don't edit it by hand.
- `sync.mjs`: reads each add-on's releases (or default branch), checks new versions, updates the
  index. `--check` checks without writing; `--only <id>` updates one add-on.
- `submit.mjs`: checks an issue-form submission and, once approved, adds the entry.
- `registry.mjs`: the shared GitHub and checking code. The checks themselves are in
  `src/editor/registry.js`.

`.github/workflows/addon-registry.yml` runs the submission checks on new issues, adds an add-on
when a maintainer labels its issue `approved`, and runs `sync.mjs` every six hours. A changed index
redeploys the website, which mirrors each add-on's newest good version as
`addons/files/<id>-<version>.zip` after checking its files against the digest in the index.
