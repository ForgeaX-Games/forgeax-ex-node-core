# @forgeax/batteries-common

Shared batteries loaded by downstream workbench plugins.

The scan root is `batteries/`; each top-level folder under it becomes a palette
category. The current shared pack is `common/`, with subfolders such as
`number`, `list`, `datatree`, `input`, and `preview`.

Battery `meta.json` ids are kept stable so existing graphs continue to resolve
the same op ids after moving batteries out of downstream repositories.
