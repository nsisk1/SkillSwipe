---
name: Recovery alert privacy
description: Why recovery notifications use minimal private operator reminders and remain independent of persistence.
---

Recovery notifications must not send learner correspondence, identity, evidence,
deck topics or recovery codes. Use only a request reference, timestamp and fixed
instruction to inspect the private inbox. An alert never approves recovery.

**Why:** The inbox contains sensitive recovery correspondence, and a notification
receiver may forward messages or have a broader audience than the database.

**How to apply:** Keep transport payloads explicitly allowlisted. Treat a new
receiver or onward channel as a privacy decision requiring operator confirmation;
HTTPS and a token do not establish who can read a destination. Keep saving and
retrying requests independent of external alert delivery.

The initial channel is an operator-owned authenticated HTTPS receiver, not an
automatically provisioned third-party messaging account.

**Why:** No notification provider was connected, and selecting an audience or
creating external correspondence without operator configuration would be unsafe.

**How to apply:** Support provider adapters only when their audience and private
configuration are explicit. Do not infer a shared chat channel is appropriate or
make a newly connected notification provider mandatory for saving requests.

Keep recovery-audit outage monitoring separate from recovery-request arrival
notifications. Do not automatically send outage reports to the request receiver.

**Why:** The user explicitly scoped audit failure reporting separately from
request notifications; configuring a receiver for one purpose does not establish
an appropriate audience for the other.

**How to apply:** Treat any future external delivery of audit outage signals as
a separate operator configuration decision, not an extension of inbox delivery.
