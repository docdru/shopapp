# Docs

Product documents for ShopApp, kept next to the code. That
way they're versioned with each change, and Claude in VSCodium can read them
offline.

| File | What | Living version |
| --- | --- | --- |
| [spec.md](spec.md) | Product spec: purpose, scope by phase, data model, screens and flows, recommendations, tech stack, open questions, sync log | [Spec doc](https://claude.ai/artifact/DPjmRyRE4V32geGviEx4hQ) |
| [prototype/index.html](prototype/index.html) | Clickable prototype (one self-contained HTML file with sample data; open it in a browser) | [Prototype](https://claude.ai/artifact/9QkWqMkrRvH2H3bqnyfAUK) |

## How they stay in sync

- The living spec and prototype on claude.ai are where they get edited and
  commented on. The files here are snapshots of them.
- Any PR that changes the spec or the prototype also refreshes the snapshot
  here, in the same PR. The spec's "Prototype sync log" says which version
  each snapshot matches.
- Behaviour in code follows the spec. If code and spec disagree, fix one of
  them in the same PR. Don't leave the disagreement in place.

To view the prototype locally:

```sh
xdg-open docs/prototype/index.html   # or open it in any browser
```

It loads its fonts from Google Fonts. Without a connection it falls back to
system fonts.
