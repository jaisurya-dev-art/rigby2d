# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

> [!NOTE]
> Rigby2D has applied to the SignPath Foundation for free code signing, and the application is under
> review. Until it is accepted, release files are not signed yet: compare their SHA-256 checksums
> before running them (see [Installation](installation.md)).

Rigby2D's Windows release files (the MSI installer, the setup program and the portable editor) are
built from this repository's source by [GitHub Actions](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/.github/workflows/release.yml)
and signed through SignPath. Every signing request is approved by hand.

## Team roles

| Role | Members |
| --- | --- |
| Committers and reviewers | [jaisurya-dev-art](https://github.com/jaisurya-dev-art) |
| Approvers | [jaisurya-dev-art](https://github.com/jaisurya-dev-art) |

Contributions from outside the team arrive as pull requests and are reviewed by a team member
before they are merged. All team members use multi-factor authentication for GitHub and SignPath.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it. See the [privacy statement](privacy.md)
for the details, including the speech model that lip-sync transcription downloads when you ask for
it.

## Checking a download

Right-click the downloaded file, choose *Properties* and open *Digital Signatures*: the signer must
be **SignPath Foundation**. Windows may still warn about a new download for a while after a release,
until the file has built up a reputation. Each release also lists the SHA-256 checksum of every
file; see [Installation](installation.md).
