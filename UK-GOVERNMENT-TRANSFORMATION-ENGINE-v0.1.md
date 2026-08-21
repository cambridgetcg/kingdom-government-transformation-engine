# UK Government Transformation Engine v0.1

## What this is

This Phase-0 artifact is a static orientation instrument for asking better transformation questions against the six exact planes of the dated UK Government Engine. It does not advance a proposal through those planes. It exposes dependencies, distinctions, hypotheses, alternatives, holds and required human gates.

The three dossiers are synthetic exemplars, not official or adopted proposals. Each proposition is stored verbatim, cross-bound to its dossier and canonically receipted. The declared authorship is `codex-assisted-publication-under-recorded-human-direction`; human review remains incomplete.

## The two graphs

Each dossier has two graphs with different semantics.

### Authority and accountability dependencies

Every node names one of the six exact base planes and pins admitted Government Engine IDs. Edge direction is explicit:

- `prerequisite`: `fromId` is a question that must be resolved before `toId` can be supported;
- `parallel`: both inquiries remain separate and may proceed alongside each other;
- `alternative`: distinct hypothetical pathways, not substitutable authorities;
- `feedback`: observations at `fromId` can reopen questions at `toId` without answering them; and
- `does-not-imply`: evidence or orientation at `fromId` does not establish `toId`.

No edge selects, approves or automatically progresses anything.

### Causal-change hypotheses

The causal graph does not claim causal truth. Every dossier contains exactly one business-as-usual comparator and at least two alternatives. Each option points to its own hypothesised output. A BAU output cannot feed the desired intervention outcome; each alternative output must explicitly connect to an outcome hypothesis.

Direction is also fixed for the non-intervention edges:

- `desired-outcome → assumption` with `depends-on`;
- `negative-pathway → desired-outcome` with `may-undermine`; and
- `evaluation-need → desired-outcome` with `tests`.

The graph selects no preferred option. Evaluation needs are descriptions of future human work, not evaluation actions performed here.

## Status and gates

Plane statuses are restricted to:

- `not-assessed`
- `insufficient-evidence`
- `contested`
- `specialist-review-required`
- `orientation-supported`

There is no pass, approval, lawfulness, authorisation, funding, eligibility, readiness, ranking or scalar score. `orientation-supported` cannot coexist with a relevant incomplete gate, unresolved question, specialist-review requirement or non-supporting evidence. All shipped assessments retain unresolved questions, so none is `orientation-supported`.

Every dossier is held. Human review is required and incomplete; decision authority and adoption remain outside this system. Decision, implementation, operational, evaluation and redress action arrays are present and deny-all empty.

## Category distinctions

The engine enforces, among others:

- mandate does not imply legal power;
- a topic does not establish legislative or executive competence;
- guidance is not law;
- a forecast does not establish authority or appropriation;
- a plan is neither an Estimate nor an appropriation;
- an Estimate is not an appropriation;
- appropriation is distinct from credit and issue;
- issue is not outturn;
- a payment or settlement does not establish liability or spending power;
- a payment rail does not create authority;
- a service or API does not create decision authority;
- a complaint is not an appeal and may not protect a deadline;
- an external crosswalk is not official evidence; and
- freshness does not establish legal effect.

## Evidence contract

Every evidence atom pins an exact entity ID in the vendored Government Engine snapshot and repeats its immutable byte/canonical receipts and canonical public URL. Atoms are `orientation-only`, use official sources `link-only`, do not rely on generic official-host trust, were not exact-text human-reviewed, and support no legal, tax or authority conclusion.

The producer reads only the vendored file. It performs no runtime or build-time network fetch. The base public URL is a dereferenceable provenance link, not an input.

TaxSorted appears only transitively through four exact bindings already selected by the base snapshot. Each has `supportsClaimIds: []` and `external-context-only` taint. No TaxSorted text or graph is copied.

## Dossier holds

### Public-money information

Plans, forecasts, Estimates, appropriation, credit, issue, banking, GOV.UK Pay, RTGS/CHAPS and outturn remain distinct. None of those operational or planning concepts creates authority. The question of tracing a labelled pound is explicitly held as unestablished.

### Four-nation information

England, Scotland, Wales and Northern Ireland have four distinct branches. Topic resemblance is not a competence test, and asymmetric settlements cannot be collapsed into one UK route. A hard specialist competence-review gate stops progression.

### HMRC notice explanation

Complaint, statutory review, First-tier Tribunal appeal and judicial review are parallel orientations rather than a ladder. The dossier chooses no route and determines no deadline, eligibility, liability or legal effect. It stops at insufficient evidence.

## Freshness and publication lifecycle

The snapshot inherits the base review deadline of `2026-09-21`. `stateAtPublication` records only the publication-time state. Reader-time state is not embedded and there is no automatic runtime enforcement in these immutable bytes.

After the deadline, the immutable artifact remains reproducible and available as historical orientation only. The separate site release gate must replace the mutable publication with a newly reviewed snapshot or atomically retire the complete five-route family: human page, mutable alias, dated canonical JSON, schema and guide. Freshness never implies current legal effect.

## Trial Chamber

Trial Chamber compatibility is unavailable. There is no trial result and nothing in this artifact may be used as Trial Chamber authority.

## Technical boundaries

The producer is zero-dependency and offline. Strict JSON parsing rejects malformed UTF-8, duplicate keys, unsafe integers, oversized structures, excessive nesting and symlink inputs while preserving prototype-shaped names as inert data. The one Draft 2020-12 schema is closed and receipt-pinned. Builds use deterministic ASCII ordering and an atomic full-write loop to a single fixed target.

There is no form, free-text input, POST route, personal-data collection, identity or credential access, account access, LLM runtime, MCP exposure, network call, automated decision, filing, payment, procurement, spending, transaction, deployment or external effect.
