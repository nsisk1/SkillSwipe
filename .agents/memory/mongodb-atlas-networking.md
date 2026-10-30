---
name: MongoDB Atlas networking
description: Replit outbound networking constraints relevant to MongoDB Atlas connection failures.
---

Replit apps can connect outbound to MongoDB Atlas over TLS, but Replit outbound IP addresses are not fixed. An Atlas IP allowlist may reject a valid URI from a Replit runtime when the active egress address is not permitted.

**Why:** During SkillSwipe persistence work, the URI hostname resolved but the Atlas nodes rejected TLS before authentication. Replit documentation confirmed outbound access is supported but egress IPs are dynamic.

**How to apply:** When MongoDB Atlas requests from a Replit app fail before authentication, verify the cluster is active and its network access policy supports the app's changing egress addresses. Do not expose connection strings or recommend broad network access without explaining its security impact.
