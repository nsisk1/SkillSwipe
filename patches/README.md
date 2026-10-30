# Security patches

## deepmerge 4.3.1

`@expo/config` still uses deepmerge 4.3.1, and no patched upstream release is
available for GHSA-gcqx-w48m-w2h4. The tracked pnpm patch uses own data-property
definitions when copying or merging keys, rather than assignments that can invoke
the inherited `__proto__` setter. It covers writes from both the target and source.

The package keeps its upstream version, so version-only audits will continue to
report this advisory. It is not suppressed. Reassess and remove this patch when
Expo adopts a fixed release or replacement.

Run the regression checks against the copy Expo actually loads:

```sh
node --test scripts/tests/dependency-security.test.mjs
```
