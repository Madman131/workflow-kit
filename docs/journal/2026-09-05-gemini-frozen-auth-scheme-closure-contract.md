# Frozen Gemini authorization-scheme closure contract

## Parent and scope

This child succeeds the terminal R4 NO-GO candidate
`0e2ae2147559115cec41a5028a85074d956d3f10` (tree
`fdbb8521983453a1431a15c1edc6d5b928b5a606`) without changing that parent.
It changes only the Frozen Gemini final-material Authorization firewall.

## Required correction

Before any provider call, reject every non-placeholder `Authorization:
<HTTP-token auth-scheme> <nonempty credential>` occurrence in both current and
deleted complete review material. The scheme follows the complete HTTP `tchar`
token grammar, including legal punctuation; the credential has no minimum
length and may be unquoted. Explicit existing placeholders remain allowed.

No general credential-scanner expansion, fragment, transport, lock, cap,
version, architecture, or live-provider change is part of this successor.

## R1 admitted finding

Fragment coverage is validated per component in manifest execution order. A
later byte range cannot execute before an earlier range, even when the ranges
are otherwise contiguous; gap, overlap, duplicate, and complete-partition
checks remain required.
