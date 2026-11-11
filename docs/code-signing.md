# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

The Windows editor (the setup program, the Windows Installer package and the portable editor) is
signed so that Windows can confirm it comes from the Rigby2D project and was not changed after it
was built.

## What is signed

Only files built from this repository's source by its
[release workflow](https://github.com/jaisurya-dev-art/rigby2d/blob/main/.github/workflows/release.yml)
on GitHub Actions are signed. Nothing built on a personal computer is ever signed. Each release's
files and their SHA-256 checksums are listed on its
[release page](https://github.com/jaisurya-dev-art/rigby2d/releases).

Each signing request is approved by hand before it is signed.

## Team roles

| Role | Who |
| --- | --- |
| Committers and reviewers | [Jaisurya](https://github.com/jaisurya-dev-art) |
| Approvers | [Jaisurya](https://github.com/jaisurya-dev-art) |

Contributions from outside the team come in through pull requests, which a committer reviews before
they are merged.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it. The editor checks GitHub for a
newer release (which can be turned off in *Edit ▸ Preferences*), and downloads the speech model or
a demo project only when you ask for one. The [privacy page](privacy.md) lists everything.
