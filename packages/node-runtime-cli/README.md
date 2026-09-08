# @forgeax/node-runtime-cli

`forgeax` — single CLI binary exposing every Layer 2 editing API as a
shell subcommand. Designed so AI agents drive node-programming plugins
through the same surface a human uses.

## Quick taste

```bash
# List pipelines (JSON output by default — pipe to jq)
forgeax pipeline list | jq '.[] | .id'

# Add a node, then connect it (NDJSON for streaming consumers)
forgeax --ndjson node create \
  --pipeline-id char_villager \
  --type wb-3d-lowpoly.humanoid-skeleton \
  --params '{"preset":"humanoid-standard-v1"}'

# Bulk update via grep + xargs
forgeax node list --type wb-2d-asset.brush \
  | jq -r '.[] | .id' \
  | xargs -I{} forgeax node update --node-id {} --params '{"size":2}'
```

## Status

🟡 Subcommand tree registered, bodies stubbed. Real implementations land in P5.
