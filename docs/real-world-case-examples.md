# Research basis for the realistic examples

The cases in `examples/cases/` are fictional teaching packages. They do not
recreate a victim, suspect, defendant, company, or unresolved investigation.
They borrow narrow investigative mechanics from public, authoritative sources
and combine them with invented people, places, timelines, evidence, and
outcomes.

This distinction matters for both ethics and engine design: the source tells us
which kinds of records investigators actually compare, while the authored YAML
remains a deterministic test fixture rather than a claim about a real person.

## Example matrix

| Example | Investigative mechanic | Engine pressure it exercises |
| --- | --- | --- |
| `archive-substitution` | A checked-out rare item is returned as a dummy; accession labels, physical construction, account aliases, and travel records expose the substitution. | Provenance chains, identity aliases, document/image assets, and an evidence-preservation route. |
| `diverted-invoice` | A lookalike email domain and changed payment instructions divert a legitimate invoice. | Structured email observations, exact searches, a wall-clock recovery deadline, and alternate outcomes. |
| `yard-switch` | Switch position, radio traffic, event-recorder times, and maintenance authority must be placed on one timeline after a rail-yard collision. | Multi-source temporal reasoning, operational logs, diagrams, and evidence overwrite. |
| `olive-oil-lot` | Label claims, laboratory classification, and batch ledgers disagree about the grade and source of an oil lot. | Numeric/report facts, lot traceability, laboratory and document assets, and chain-of-custody pressure. |
| `silent-stable` | The absence of an expected guard-dog alert implies that the visitor was familiar, while a meal receipt and stable plan separate opportunity from suspicion. | Explicit negative evidence, alternate suspects, and a public-domain story adapted into a compact regression case. |

## Primary sources

### Archive substitution

The United States Department of Justice described an alleged scheme in which
rare Chinese manuscripts were checked out and dummy manuscripts were returned.
The complaint described library asset tags, aliases/library cards, and travel
timing as parts of the investigation. The source itself stresses that a
criminal complaint is an allegation and that a defendant is presumed innocent.

- [DOJ: Alameda County man charged with stealing rare and historical Chinese manuscripts](https://www.justice.gov/usao-cdca/pr/alameda-county-man-charged-federal-complaint-stealing-rare-and-historical-chinese)

The example adapts only the substitution-and-provenance mechanics. Its archive,
documents, people, dates, and resolution are invented.

### Business email compromise

The FBI describes business email compromise as fraud that abuses ordinary
business email workflows, often by impersonating a trusted party and changing
payment instructions. Its field-office alert also describes lookalike domains
and fraudulent attachments carrying wire instructions.

- [FBI: Business Email Compromise](https://www.fbi.gov/how-we-can-help-you/scams-and-safety/common-frauds-and-scams/business-email-compromise)
- [FBI Denver: Business E-mail Compromise Fraud Alert](https://www.fbi.gov/contact-us/field-offices/denver/news/press-releases/business-e-mail-compromise-fraud-alert)

The example uses an invented supplier, domain, bank route, and recovery window.
It is designed to test message headers, invoices, exact searches, and deadlines.

### Rail-yard switch investigation

The National Transportation Safety Board's Railroad Investigation Report
RIR-24-12 covers an April 2023 Union Pacific collision after a train crossed a
main-track switch lined toward a yard track and hit parked equipment. NTSB rail
reports demonstrate the use of switch position, recorder data, operational
records, and timelines in a factual accident investigation.

- [NTSB Railroad Investigation Report RIR-24-12](https://www.ntsb.gov/investigations/AccidentReports/Reports/RIR2412.pdf)
- [NTSB railroad accident report catalog](https://www.ntsb.gov/investigations/AccidentReports/Pages/Reports.aspx?mode=Railroad)

The example's railway, crew, switch, maintenance work, causes, and findings are
fictional. It does not restate the NTSB's probable-cause finding.

### Olive-oil and food fraud

Europol's OPSON operation targets counterfeit and substandard food and drink.
Its olive-oil operation describes lower-grade oil being used to dilute product
sold under a more valuable label, with laboratory and supply-chain evidence
playing central roles.

- [Europol: Operation OPSON](https://www.europol.europa.eu/how-we-work/operations/operation-opson)
- [Europol: 11 olive-oil counterfeiters arrested following Operation OPSON](https://www.europol.europa.eu/media-press/newsroom/news/11-olive-oil-counterfeiters-arrested-following-operation-opson)
- [Europol: counterfeit and substandard food seized in OPSON XIII](https://www.europol.europa.eu/media-press/newsroom/news/eur-91-million-worth-of-counterfeit-and-substandard-food-seized-in-europe-wide-operation)

The example invents its cooperative, laboratory measurements, batch numbers,
and responsible party. It adapts only the label/lab/ledger comparison.

### A public-domain detective story

Arthur Conan Doyle's “Silver Blaze” is a public-domain example of negative
evidence: a guard dog's silence matters because it implies a familiar visitor.
The story also combines a missing horse, a drugged stable boy, and records that
reframe the timeline.

- [Project Gutenberg: The Memoirs of Sherlock Holmes, including “Silver Blaze”](https://www.gutenberg.org/ebooks/834)

`silent-stable` is not a retelling. It uses an invented modern training stable,
different people, evidence, motive, and outcome to test whether the engine can
represent an expected event that did **not** occur.

## Known capability pressure

These examples intentionally reveal where a generic engine needs more than an
author-provided conclusion:

- comparisons should be explicit proof predicates, not facts silently
  precomputed by a case author;
- negative evidence must distinguish “observed false” from “not observed”;
- timestamps from different devices need generic normalization and ordering;
- numeric ranges, set intersection, and lot/account joins belong in versioned
  capabilities rather than case-specific branches;
- media needs localized labels, alternative text, captions, and transcripts;
- preservation and chain of custody should eventually be first-class effects,
  not just flags.

Until a predicate or capability exists, a case may expose a signed analyst
finding as a structural observation (for example,
`classification: lower_grade`). The package README must say when it does so.
That keeps the current demo honest and gives future engine work a concrete
regression package to improve.
