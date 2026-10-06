---
name: prepare-a-language-outline
description: >-
  Prepare a 1:1 or small-group language tutoring outline for OpenRoom.
  Use when the tutor has a language, level, school material, or last
  session record and needs a live hour they can present like a deck.
---

# Prepare a language tutoring outline

Follow `prepare-a-tutoring-outline` for validation and the hard boundary:
original school documents stay in this agent. This skill adds the language hour
shape.

## Shape

Always author, in this order:

1. Recycle from the last Notes (errors, homework).
2. `term` steps with staged `reveal` — the word, then the meaning, then the
   example. Revealing a term at once removes the learner's chance to recall it.
3. One grammar `breakoutOf`, held in reserve for the learner who asks. Not a
   lecture.
4. Hidden-until-close checks, so nobody answers by copying the session.
5. `activity` + `timer` for speaking (video stays on the call).
6. `debrief`.

Defaults worth setting for a language hour:

```yaml
defaults:
  identityMode: identified
  resultVisibility: hidden-until-close
meta:
  language: French   # or Spanish, German, …
  locale: fr
  level: B1
```

On every `text` check set `match.locale` from `meta.locale`, and list the
accepted forms: a language answer has more than one right spelling, and the
tutor should not mark that by hand. Do not score with a model.

## Word lookup

The in-session dictionary reads the **space's** configured language pair, not the
outline's `meta.locale`. It refuses rather than guessing when the space has no
pair set or the pair has no verified source, so check the space is configured
before the hour.

Any participant in any live session can look a word up privately on their own
device; it is not gated on identified delivery. Only the tutor publishes a
meaning to the session.

## Live hour (tell the tutor)

- Next / Back move slides.
- Close shows their answers; Reveal shows the key.
- Insert a term or statement if they stall. Back returns.
- Circle a word, look it up, then Show the meaning.

Never add stuck / ready / raise-hand chrome. Never call a model on the live
path.
