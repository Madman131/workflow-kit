# Manual acceptance exception — complete

This local record closes the Owner-approved eight-call manual exception for the
exact frozen candidate. It is not a machine aggregate and is not a release GO.

- Handoff: `PIL-GEMINI-HANDOFF-ac7ad6f4b86792724e89a965`
- Plan: `b1fdbb50e72d7f8cdc10dd06b648f6ffb9138f36f791f7183ed644c424c3008a`
- Rig: `manual-gemini-subscription-ui-v1-strict-handoff-v1`
- Model: `gemini-3.1-pro-high`, operator-attested by the selected Gemini
  subscription UI; the runner cannot cryptographically verify provider identity.
- Tuple: base `f78a52c44353719b20ef18252c91b50eca4f890d`; candidate
  `8cea40a59774c16b12d83fd7c9d401afcf274d46`; tree
  `399394946f65570e2d1b08abeeaa34228d8ccb9d`
- Result: focused adjudication `GO` plus original packets `0021`–`0027`
  `GO`; `8/8` complete, zero retries, no service or provider error.

The original terminal disposition remains untouched: the prior `coverage-001`
through `coverage-019` prefix is 19 GO records and original `coverage-020`
remains the terminal diff-bearing `NO_GO`. The focused adjudication refuted
that lock finding as reachable harm, consistent with the terminal disposition's
source analysis; the preserved `coverage-020` receipt is historical terminal
evidence, not unresolved code harm. No aggregate GO or release receipt was
created, and push/deploy authority was not granted.

## Focused adjudication receipt

- Reply SHA-256: `106ced1f6afe415afcf9ff26aab23fcd1e4658e8d5b340b3a65e2b42b31a0a8c`
- Completion marker: `PIL-DONE-LOCK-ADJUDICATION-8cea40a`

## Reply and scope receipts

| Packet | Reply SHA-256 | Inspected-scope SHA-256 | Completion marker |
| --- | --- | --- | --- |
| `0021.txt` | `86695c69ef7b392b8587ceb3fcf39c8e3215566cab87a4171a1b1febc20f5d78` | `6dba09be03807f35eeb66f22cc81a41a50f9f037ee99c8f7e7e21814a419c165` | `PIL-DONE-2b6c75635ab56522b8f6ac40` |
| `0022.txt` | `412275645a25655fedef95f1ee70abc97bb5d0e2e2e1d9faf5b50cc337b0435b` | `aa86484a12539cb05a2a273a537c7129ecb67a1baeb97a6624c831f7b41a224d` | `PIL-DONE-f15a871d399f6946fed6c1d7` |
| `0023.txt` | `252d91d77c749198717e75d1bf061f74200dfe42cf81c0a9d51d62e53754b70f` | `09962e72da549d8cf59234e8f70a8c797baaa27d95c5102acbd97b8948900252` | `PIL-DONE-22be64af019203af8701b736` |
| `0024.txt` | `3d412b68e2894a887cf50a1d8c1f68cfbe91db608a462f5ecb1879d52255ef1c` | `012f6dbfa510068eeb5700ec67b5f2cdf2681c559f2fbaaa27df939fef296bd2` | `PIL-DONE-5add7cf583bb2a91dee7f666` |
| `0025.txt` | `726a52a7e2f2410467f87ddea95c99d7bb80c786c34b0287861bb317ce1c7866` | `9c18b649b45e9127c4c235c2b1204cc43a3a4eb4888d68034b5ecb3f33c9287d` | `PIL-DONE-0ac006255867e1af9be1363c` |
| `0026.txt` | `f2ba7bc2d92c21c8808bd43486a7e8dbfed50a62ba9d20e1fca01a5a84572957` | `91558b81b37e80b437db74c7ca9c9f8cd15d99ad1a85a55ca8ce3dd2e0ac4367` | `PIL-DONE-494783174e3d8089aa5c2955` |
| `0027.txt` | `271fd2d4db880e15fef43f32f223ce4eba5a9dc58adf78141edeb34c73ae0855` | `1654e7ff9fc992d395b900bc017e7ace6f51db517d7ccdba71004b0afafda4a4` | `PIL-DONE-b9bf4dd12e3e5e01ba2c23a7` |

Each reply has exactly one `VERDICT: GO`, an exact tuple and material scope
binding, the three ordered ingestion markers, and the manifest completion
marker. Packet `0022` uses permitted newline formatting around the scope JSON;
its normalized scope hash matches the manifest.

## Operating note

The alternate supported Node browser runtime completed exact-file reads,
textbox fills, logical-DOM hash equality checks before each submit, and DOM
capture to file. No API call or provider error occurred in these seven calls.
The earlier native attachment failure consumed no call. The reviewed source
checkout remains frozen at the tuple above.
