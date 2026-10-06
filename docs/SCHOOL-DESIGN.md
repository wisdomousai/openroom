# School DESIGN.md

A school or space may keep a `DESIGN.md` next to the `.openroom` file (or in
the workspace the agent can read). It is **not** OpenRoom's own product
`DESIGN.md`. Agents restyle ported HTML/SVG to these tokens unless the tutor
says to ignore brand.

When the space has the `branding` entitlement, applying this file is the
default. Opt-out is an explicit tutor line.

## Shape

```yaml
# DESIGN.md — school brand for ported slides
paper: "#FFFFFF"
ink: "#242424"
accent: "#0F6CBD"
muted: "#616161"
displayFace: "Georgia, serif"
radius: "4px"
wordmark:
  url: "https://school.example/mark.svg"
  maySit: ["top-left", "bottom-right"]
  mustNotCover: "the question"
```

Rules the agent must keep:

- Two hues. Accent is action; do not invent a third meaning-colour.
- Stage contrast first. Body text ≥ 4.5:1 on paper.
- No gradients, blur, or glass in generated fragments.
- Wordmark only where `maySit` allows.

Wired slides (polls, timers, join) ignore this file's CSS. They use the
OpenRoom theme roles.
