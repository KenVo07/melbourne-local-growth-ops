# Phase 8 evidence — standalone artifact matrix

Date: 2026-08-17T13:03:17+10:00
Factory revision: 47d82fe6434aaa4eed14265a80616e9bd77ba3dc (+ uncommitted Phase 8 work)

## Artifacts generated
```
legacy-search-off          artifactId=98637d51529d61d16da1ceecde8e2138a19e7b668c5fcf5cf33b26e2a122b942
                           experience=(legacy)               authoredSourceFiles=0 inventory=114
legacy-search-on           artifactId=752a7a7cd4778a661741b01749ced9748ed336a36d66d6e10afcad46ab71906a
                           experience=(legacy)               authoredSourceFiles=0 inventory=135
v2-multiroute-no-motion    artifactId=503d2751301574d673ee23775aff34391f07cbfe37e0c41468ce8a0cdc3675dc
                           experience=neutral-functional     authoredSourceFiles=6 inventory=117
```

## Clean gate, outside the workspace

| artifact | install | verify(pre) | typecheck | build | test | verify(post) |
|---|---|---|---|---|---|---|
| legacy-search-off | OK | PASS | OK | OK | OK | PASS |
| legacy-search-on | OK | PASS | OK | OK | OK | PASS |
| v2-multiroute-no-motion | OK | PASS | OK | OK | OK | PASS |

## Isolation
```
legacy-search-off          private-workspace-refs=0  babel-parser-in-package=0
0
v2-multiroute-no-motion    private-workspace-refs=0  babel-parser-in-package=0
0
```

## Standalone serving (v2 artifact, port 3020)
```
/ /services /services/architectural-lighting /projects /projects/{3 details} /about /contact -> 200
/does-not-exist -> 404
```

## Malicious source refused before any artifact file is written
```
escapes the source root                PATH_ESCAPE                    artifact-files=0
imports a private workspace package    IMPORT_FORBIDDEN               artifact-files=0
reads the environment                  ENVIRONMENT_ACCESS_FORBIDDEN   artifact-files=0
declares a server action               EXECUTION_PRIMITIVE_FORBIDDEN  artifact-files=0
reaches the network                    NETWORK_ACCESS_FORBIDDEN       artifact-files=0
traverses out of an approved package   IMPORT_FORBIDDEN               artifact-files=0
renders a raw script element           UNSAFE_MARKUP_FORBIDDEN        artifact-files=0
```

## Notes

- Pagefind output is content-hash named per build, so it is verified by
  posture (enabled implies non-empty, disabled implies absent) rather than
  pinned by hash, which no honest rebuild could satisfy.
- The v2 no-motion artifact declares no public dependency and ships none.
