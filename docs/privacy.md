# Privacy

Rigby2D is built to keep your work on your computer.

## The desktop app

The Rigby2D desktop app (Windows, macOS and Linux) never sends anything about you or your work. What it
reads from the network is listed here:

- Your projects, images and sounds are read and written only where you choose.
- There is no account, telemetry, usage analytics or crash reporting.
- **Updates**: at startup and every few hours the app reads the latest release's version file from
  GitHub (`github.com/jaisurya-dev-art/rigby2d/releases`), and downloads an update only when you
  install it. Turn this off in *Edit ▸ Preferences ▸ Check for updates*; *Help ▸ Check for updates*
  still works on request.
- **What's new** on the welcome screen reads the list of recent devlog posts from
  `rigby2d.com/news.json`, and *Help ▸ Support Rigby2D* reads `rigby2d.com/supporters.json` when you
  open it. Both are plain files on GitHub Pages; nothing about you or your projects is sent.
- **Lip-sync transcription** downloads Whisper, a speech recognition model, from
  [Hugging Face](https://huggingface.co/onnx-community/whisper-base_timestamped) the first time you
  press *Transcribe* or *Generate lip-sync* with automatic transcription. Your audio is transcribed
  on your computer and never uploaded. Hugging Face's
  [privacy policy](https://huggingface.co/privacy) applies to that download.
- **Demo projects** (*File ▸ Open demo*) download from the Rigby2D website (GitHub Pages) when you
  open one.
- Links you click (the website, the documentation, GitHub) open in your browser.

## The AI assistant extension and MCP server

The MCP server reads and writes only inside the folders you allow, on your computer. It does not
contact any network service itself. What your AI assistant does with the results is governed by
that assistant's own privacy terms.

## The website and the browser editor

[rigby2d.com](https://rigby2d.com/) is hosted on
GitHub Pages; [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
applies to serving it. Visits to the website, its documentation and its browser editor are counted
anonymously with [GoatCounter](https://www.goatcounter.com): no cookies, no personal data, and no
tracking across sites. Projects you open in the browser editor stay in your browser; nothing is
uploaded.

Devlog posts show how many times they have been read. A post counts a read once it has been
visible for five seconds, at most once per reader, per post, per day. To tell repeat visits apart,
our server (a Cloudflare Worker on rigby2d.com) makes a one-way hash of your IP address, browser
name, the post and the date with a secret value, keeps only that hash, and deletes it after the
day. What is stored is the number of reads per post per day; no IP address, cookie or anything
that identifies you.

Likes and comments on devlog posts are provided by [giscus](https://giscus.app), which keeps each
post's thread as a GitHub Discussion in the Rigby2D repository. The comments frame loads from
giscus.app only when you scroll to it, and sets no cookies while you only read. To like or comment you
sign in with GitHub; what you post is public on GitHub under your account, and
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
and [giscus's privacy policy](https://github.com/giscus/giscus/blob/main/PRIVACY-POLICY.md) apply.
You can edit or delete your comments on GitHub at any time.

The [Rigby2D Cloud waitlist](https://rigby2d.com/cloud/) is the one place the website asks for
personal data. The email address you enter is stored with the date in a database in our Cloudflare
account and used only to tell you when Rigby2D Cloud opens. It is never shared or sold. To be removed
from the list, email [hello@rigby2d.com](mailto:hello@rigby2d.com) or reply to that email, and the address is deleted.

## Contact

Questions about privacy: email [hello@rigby2d.com](mailto:hello@rigby2d.com).
