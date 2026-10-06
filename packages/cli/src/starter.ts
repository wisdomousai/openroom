/**
 * The starter session written by `openroom init`.
 *
 * SimpleSession (default dialect) — title + questions. The runtime expands this
 * to a full Session. Advanced Session YAML lives under examples/.
 */
export const STARTER_SESSION_YAML = `# OpenRoom SimpleSession (default)
# Validate:  openroom validate session.yaml
# Preview:   openroom preview session.yaml
# Agents:    docs/AGENT.md
#
# Full Session (peer instruction, ranking, pedagogy, …) is advanced —
# see examples/ after you have run a simple session.

title: My first session
questions:
  - prompt: How familiar are you with today's topic?
    options:
      - Completely new to me
      - I know the basics
      - I could explain it to someone
  - prompt: How is your energy right now?
    type: scale
    min: 1
    max: 5
    minLabel: Running low
    maxLabel: Fully charged
  - prompt: What is the one thing you want answered today?
    type: text
`;
