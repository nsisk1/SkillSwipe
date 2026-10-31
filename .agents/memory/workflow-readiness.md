---
name: Workflow readiness after reconciliation
description: Post-merge success can precede actual service readiness.
---

A successful post-merge reconciliation result is not proof that every restarted
service is ready on its assigned port.

**Why:** Reconciliation has reported success while older service processes still
held ports. New API/video processes failed, Expo waited at a port-selection
prompt, and Vite moved to an unrouted port.

**How to apply:** After reconciliation, inspect startup output and assigned-port
readiness. If a port is occupied, identify its owning process before taking
action; do not change artifact ports or add duplicate workflows to bypass it.
