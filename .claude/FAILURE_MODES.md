# FAILURE MODES — this lane's build mistakes (newest first)

## FM-KO17-03 · A commit message asserted a sweep it had not verified
**What happened.** The round-5 commit said the last "authorized close" occurrence was replaced. A
cold seat found one still there and said so, naming the false claim as a finding of its own.
**Root cause.** The sweep was written from the lines a reviewer had cited, then the commit message
generalised to "the last occurrence" without a confirming grep.
**Consequence.** A reviewer spent a round re-finding a known defect, and the commit record is wrong
in a repo whose commit bodies are read as evidence.
**Prevention.** A commit body may only claim a sweep the working tree can prove: run the grep, paste
its empty result, and if it is non-empty, do not write the sentence. Claims about ABSENCE need the
same receipt as claims about behavior.

## FM-KO17-02 · Truncated a failing log and lost the evidence
**What happened.** The acceptance harness failed once during round-1 remediation. The command
piping its output kept ~2 lines, so the assertion text was gone before it could be read. Four
subsequent full runs were green and the direct harness run passed.
**Root cause.** `npm test | grep -A18` on a run that might fail — the standing rule is to capture
every gate run WHOLE before summarising, and it was applied to the runs that passed, not to the one
that mattered.
**Consequence.** The single failure can only be reported as "consistent with the documented ~1-in-3
cage-probe flake", never as proven. That is a weaker report than the evidence could have supported.
**Prevention.** Redirect to a file FIRST, then grep the file. Never let a pipeline be the only copy
of a run that can fail.

## FM-KO17-01 · Fixed spellings for four rounds instead of the source
**What happened.** Four consecutive review rounds returned the same finding class — a surface
describing the repair close as stronger than the mechanism ("Owner-authorized", "Owner authority",
"attributable to the Owner", "does not get to release it"). Each round fixed the cited lines; the
next round found the next spelling.
**Root cause.** The defect was one concept with many spellings, and enumeration cannot close a
paraphrase space. The kit's own doctrine already says a surface either STATES a rule or POINTS and
carries no component of it — it was not applied to the surfaces this chip was adding.
**Consequence.** Three extra review rounds, and a wording convergence loop that ran well past the
cadence's three-harm-bearing-round bound before the pattern was read as a recurrence.
**Prevention.** On the SECOND same-class finding, stop patching and ask what the class is. For
wording, that means: define the term once, make every other surface point at it, and sweep by
CONCEPT (grep the idea, not the phrase the reviewer quoted).
